"""
Octofleet API - Baselines Routes
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from dependencies import db_pool, get_db, verify_api_key
from app.core.cis_templates import CIS_TEMPLATES, CHOCO_PACKAGES
import asyncpg
from typing import Optional, Dict, List, Any
import uuid
import json

router = APIRouter(tags=["Baselines"])


@router.post("/api/v1/software-baselines")
async def create_software_baseline(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a software baseline (package collection)"""
    async with db.acquire() as conn:
        baseline_id = str(uuid.uuid4())
        
        await conn.execute("""
            INSERT INTO software_baselines (id, name, description, packages)
            VALUES ($1::uuid, $2, $3, $4)
        """, baseline_id, data.get("name"), data.get("description"), data.get("packages", []))
        
        return {
            "id": baseline_id,
            "name": data.get("name"),
            "packages": data.get("packages", [])
        }


@router.get("/api/v1/software-baselines")
async def list_software_baselines(db: asyncpg.Pool = Depends(get_db)):
    """List all software baselines"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, name, description, packages, created_at
            FROM software_baselines
            ORDER BY created_at DESC
        """)
        
        baselines = [{
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "packages": row["packages"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        } for row in rows]
        
        return {"baselines": baselines}


@router.get("/api/v1/software-baselines/{baseline_id}")
async def get_software_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a specific baseline with its assignments"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM software_baselines WHERE id = $1::uuid
        """, baseline_id)
        
        if not row:
            raise HTTPException(status_code=404, detail="Baseline not found")
        
        # Get assignments
        assignments = await conn.fetch("""
            SELECT ba.id, ba.group_id, ba.enabled, g.name as group_name
            FROM software_baseline_assignments ba
            JOIN groups g ON g.id = ba.group_id
            WHERE ba.baseline_id = $1::uuid
        """, baseline_id)
        
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "packages": row["packages"],
            "assignments": [{
                "id": str(a["id"]),
                "groupId": str(a["group_id"]),
                "groupName": a["group_name"],
                "enabled": a["enabled"]
            } for a in assignments]
        }


@router.delete("/api/v1/software-baselines/{baseline_id}")
async def delete_software_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a software baseline"""
    async with db.acquire() as conn:
        result = await conn.execute("""
            DELETE FROM software_baselines WHERE id = $1::uuid
        """, baseline_id)
        
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Baseline not found")
        
        return {"status": "deleted", "id": baseline_id}


@router.post("/api/v1/software-baselines/{baseline_id}/assign")
async def assign_baseline_to_group(baseline_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Assign a software baseline to a group"""
    group_id = data.get("groupId")
    if not group_id:
        raise HTTPException(status_code=400, detail="groupId is required")
    
    async with db.acquire() as conn:
        # Verify baseline and group exist
        baseline = await conn.fetchrow("SELECT name FROM software_baselines WHERE id = $1::uuid", baseline_id)
        if not baseline:
            raise HTTPException(status_code=404, detail="Baseline not found")
        
        group = await conn.fetchrow("SELECT name FROM groups WHERE id = $1::uuid", group_id)
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        
        try:
            assignment_id = str(uuid.uuid4())
            await conn.execute("""
                INSERT INTO software_baseline_assignments (id, baseline_id, group_id)
                VALUES ($1::uuid, $2::uuid, $3::uuid)
            """, assignment_id, baseline_id, group_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail="Baseline already assigned to this group")
        
        return {
            "id": assignment_id,
            "baselineId": baseline_id,
            "baselineName": baseline["name"],
            "groupId": group_id,
            "groupName": group["name"]
        }


@router.post("/api/v1/software-baselines/reconcile")
async def reconcile_all_baselines(db: asyncpg.Pool = Depends(get_db)):
    """
    Reconcile all baseline assignments.
    Installs missing packages on nodes in assigned groups.
    """
    async with db.acquire() as conn:
        # Get all enabled assignments
        assignments = await conn.fetch("""
            SELECT ba.id, ba.baseline_id, ba.group_id, 
                   b.name as baseline_name, b.packages,
                   g.name as group_name
            FROM software_baseline_assignments ba
            JOIN software_baselines b ON b.id = ba.baseline_id
            JOIN groups g ON g.id = ba.group_id
            WHERE ba.enabled = true
        """)
        
        results = []
        
        for assignment in assignments:
            # Get nodes in group that haven't completed this baseline
            nodes_needing_install = await conn.fetch("""
                SELECT n.id, n.node_id, n.hostname
                FROM device_groups dg
                JOIN nodes n ON n.id = dg.node_id
                LEFT JOIN software_baseline_status sbs 
                    ON sbs.node_id = n.node_id AND sbs.baseline_id = $1::uuid
                WHERE dg.group_id = $2::uuid
                  AND n.is_online = true
                  AND (sbs.status IS NULL OR sbs.status = 'failed')
            """, assignment["baseline_id"], assignment["group_id"])
            
            if not nodes_needing_install:
                continue
            
            # Build installation script
            packages = assignment["packages"]
            if not packages:
                continue
            
            # Create jobs for each node
            for node in nodes_needing_install:
                # Build choco install script
                choco_packages = []
                for pkg in packages:
                    choco_name = CHOCO_PACKAGES.get(pkg.lower(), pkg)
                    choco_packages.append(choco_name)
                
                install_script = f'''
# Software Baseline: {assignment["baseline_name"]}
$ErrorActionPreference = "Stop"

# Ensure Chocolatey is installed
if (!(Get-Command choco -ErrorAction SilentlyContinue)) {{
    Write-Host "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}}

# Install packages
$packages = @({", ".join([f'"{p}"' for p in choco_packages])})
foreach ($pkg in $packages) {{
    Write-Host "Installing $pkg..."
    choco install $pkg -y --no-progress
    if ($LASTEXITCODE -ne 0) {{
        Write-Warning "Failed to install $pkg"
    }}
}}

Write-Host "Baseline installation complete!"
'''
                
                job_id = str(uuid.uuid4())
                await conn.execute("""
                    INSERT INTO jobs (id, name, description, target_type, target_id,
                                     command_type, command_data, timeout_seconds, created_by)
                    VALUES ($1::uuid, $2, $3, 'device', $4::uuid, 'run', $5::jsonb, $6, 'baseline-reconciler')
                """, job_id,
                    f"[Baseline] {assignment['baseline_name']} - {node['hostname']}",
                    f"Install baseline packages: {', '.join(packages)}",
                    str(node["id"]),
                    json.dumps({"command": install_script}),
                    1800  # 30 min timeout
                )
                
                await conn.execute("""
                    INSERT INTO job_instances (job_id, node_id, status)
                    VALUES ($1::uuid, $2, 'pending')
                """, job_id, node["node_id"])
                
                # Track baseline status
                await conn.execute("""
                    INSERT INTO software_baseline_status (node_id, baseline_id, assignment_id, status, job_id)
                    VALUES ($1, $2::uuid, $3::uuid, 'pending', $4::uuid)
                    ON CONFLICT (node_id, baseline_id) DO UPDATE SET
                        status = 'pending', job_id = $4::uuid, error_message = NULL
                """, node["node_id"], assignment["baseline_id"], assignment["id"], job_id)
                
                results.append({
                    "nodeId": node["node_id"],
                    "hostname": node["hostname"],
                    "baselineName": assignment["baseline_name"],
                    "jobId": job_id
                })
        
        return {
            "reconciled": len(results),
            "results": results
        }


@router.get("/api/v1/compliance/summary", dependencies=[Depends(verify_api_key)])
async def get_compliance_summary(db: asyncpg.Pool = Depends(get_db)):
    """Get security compliance summary across all nodes"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                n.id as node_id,
                n.hostname,
                s.defender,
                s.firewall,
                s.bitlocker,
                s.antivirus
            FROM nodes n
            LEFT JOIN security_current s ON n.id = s.node_id
        """)
        
        compliance = {
            "totalNodes": len(rows),
            "defender": {"enabled": 0, "disabled": 0, "unknown": 0},
            "firewall": {"enabled": 0, "disabled": 0, "unknown": 0},
            "bitlocker": {"encrypted": 0, "unencrypted": 0, "unknown": 0},
            "realTimeProtection": {"enabled": 0, "disabled": 0, "unknown": 0},
            "nodes": []
        }
        
        for row in rows:
            defender = row["defender"] or row["antivirus"] or {}
            firewall_data = row["firewall"] or {}
            bitlocker_data = row["bitlocker"] or {}
            
            # Ensure we have dicts, not lists
            if isinstance(defender, str):
                import json
                defender = json.loads(defender)
            if isinstance(defender, list):
                defender = {}
            if isinstance(firewall_data, str):
                firewall_data = json.loads(firewall_data)
            if isinstance(firewall_data, list):
                firewall_data = {}
            if isinstance(bitlocker_data, str):
                bitlocker_data = json.loads(bitlocker_data)
            if isinstance(bitlocker_data, list):
                bitlocker_data = {"volumes": bitlocker_data}  # assume it's volumes list
            
            # Defender status
            av_enabled = defender.get("antivirusEnabled") or defender.get("enabled")
            if av_enabled is True:
                compliance["defender"]["enabled"] += 1
            elif av_enabled is False:
                compliance["defender"]["disabled"] += 1
            else:
                compliance["defender"]["unknown"] += 1
            
            # Real-time protection
            rtp = defender.get("realTimeProtection") or defender.get("realTimeProtectionEnabled")
            if rtp is True:
                compliance["realTimeProtection"]["enabled"] += 1
            elif rtp is False:
                compliance["realTimeProtection"]["disabled"] += 1
            else:
                compliance["realTimeProtection"]["unknown"] += 1
            
            # Firewall
            profiles = firewall_data.get("profiles", [])
            fw_enabled = None
            if profiles:
                if isinstance(profiles, list):
                    fw_enabled = any(p.get("enabled") for p in profiles if isinstance(p, dict))
                elif isinstance(profiles, dict):
                    fw_enabled = any(p.get("enabled") for p in profiles.values() if isinstance(p, dict))
            
            if fw_enabled is True:
                compliance["firewall"]["enabled"] += 1
            elif fw_enabled is False:
                compliance["firewall"]["disabled"] += 1
            else:
                compliance["firewall"]["unknown"] += 1
            
            # BitLocker
            volumes = bitlocker_data.get("volumes", [])
            bl_encrypted = None
            if volumes and isinstance(volumes, list):
                # protectionStatus: "1" = On, "0" = Off (can be string or int)
                bl_encrypted = any(
                    str(v.get("protectionStatus", "0")) == "1" or 
                    v.get("encrypted") is True or
                    v.get("protectionStatus") == "On"
                    for v in volumes if isinstance(v, dict)
                )
            
            if bl_encrypted is True:
                compliance["bitlocker"]["encrypted"] += 1
            elif bl_encrypted is False:
                compliance["bitlocker"]["unencrypted"] += 1
            else:
                compliance["bitlocker"]["unknown"] += 1
            
            compliance["nodes"].append({
                "nodeId": str(row["node_id"]),
                "hostname": row["hostname"],
                "defender": av_enabled,
                "realTimeProtection": rtp,
                "firewall": fw_enabled,
                "bitlocker": bl_encrypted
            })
        
        return compliance


@router.get("/api/v1/baselines")
async def list_config_baselines(db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT b.*,
                (SELECT COUNT(*) FROM config_baseline_rules WHERE baseline_id = b.id) as rule_count,
                (SELECT COUNT(*) FROM config_baseline_assignments WHERE baseline_id = b.id) as assignment_count
            FROM config_baselines b ORDER BY b.created_at DESC
        """)
        return [dict(r) for r in rows]


@router.post("/api/v1/baselines")
async def create_config_baseline(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    import json as _json
    rules = data.get("rules", [])
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow("""
                INSERT INTO config_baselines (name, description, baseline_type, rules)
                VALUES ($1, $2, $3, $4::jsonb)
                RETURNING *
            """, data["name"], data.get("description", ""), data.get("baseline_type", "software"),
                _json.dumps(rules))
            baseline_id = row["id"]
            for r in rules:
                await conn.execute("""
                    INSERT INTO config_baseline_rules (baseline_id, rule_type, rule_name, expected_value, severity, enabled, remediation_action)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
                """, baseline_id, r.get("rule_type", data.get("baseline_type", "software")),
                    r["rule_name"], _json.dumps(r.get("expected_value", {})),
                    r.get("severity", "medium"), r.get("enabled", True),
                    _json.dumps(r.get("remediation_action")) if r.get("remediation_action") else None)
            return dict(row)


@router.get("/api/v1/baselines/evaluations/{eval_id}")
async def get_evaluation_detail(eval_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM config_baseline_evaluations WHERE id=$1::uuid", eval_id)
        if not row:
            raise not_found("Evaluation not found")
        return dict(row)


@router.get("/api/v1/baselines/drift")
async def list_drift_events(status: str = None, severity: str = None, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        query = "SELECT d.*, r.rule_name, b.name as baseline_name FROM config_drift_events d LEFT JOIN config_baseline_rules r ON r.id=d.rule_id LEFT JOIN config_baseline_evaluations e ON e.id=d.evaluation_id LEFT JOIN config_baselines b ON b.id=e.baseline_id WHERE 1=1"
        params = []
        i = 1
        if status:
            query += f" AND d.status=${i}"
            params.append(status)
            i += 1
        if severity:
            query += f" AND d.severity=${i}"
            params.append(severity)
            i += 1
        query += " ORDER BY d.detected_at DESC LIMIT 200"
        rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]


@router.get("/api/v1/baselines/drift/summary")
async def drift_summary(db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        total_baselines = await conn.fetchval("SELECT COUNT(*) FROM config_baselines")
        total_evals = await conn.fetchval("SELECT COUNT(*) FROM config_baseline_evaluations")
        compliant_evals = await conn.fetchval("SELECT COUNT(*) FROM config_baseline_evaluations WHERE compliant=true")
        compliance_pct = round((compliant_evals / total_evals * 100) if total_evals > 0 else 0, 1)
        open_drifts = await conn.fetch("""
            SELECT severity, COUNT(*) as count FROM config_drift_events WHERE status='open' GROUP BY severity
        """)
        total_open = sum(r["count"] for r in open_drifts)
        top_nodes = await conn.fetch("""
            SELECT node_id, COUNT(*) as drift_count FROM config_drift_events WHERE status='open'
            GROUP BY node_id ORDER BY drift_count DESC LIMIT 5
        """)
        last_eval = await conn.fetchval("SELECT MAX(evaluated_at) FROM config_baseline_evaluations")
        return {
            "total_baselines": total_baselines,
            "compliance_pct": compliance_pct,
            "total_open_drifts": total_open,
            "drifts_by_severity": {r["severity"]: r["count"] for r in open_drifts},
            "top_noncompliant_nodes": [{"node_id": str(r["node_id"]), "drift_count": r["drift_count"]} for r in top_nodes],
            "last_evaluation": last_eval.isoformat() if last_eval else None
        }


@router.post("/api/v1/baselines/drift/{drift_id}/acknowledge")
async def acknowledge_drift(drift_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE config_drift_events SET status='acknowledged' WHERE id=$1::uuid RETURNING id", drift_id)
        if not row:
            raise not_found("Drift event not found")
        return {"status": "acknowledged"}


@router.post("/api/v1/baselines/drift/{drift_id}/waive")
async def waive_drift(drift_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE config_drift_events SET status='waived', waive_reason=$2 WHERE id=$1::uuid RETURNING id",
            drift_id, data.get("reason", ""))
        if not row:
            raise not_found("Drift event not found")
        return {"status": "waived"}


@router.get("/api/v1/baselines/compliance/trends", dependencies=[Depends(verify_api_key)])
async def compliance_trends(db: asyncpg.Pool = Depends(get_db)):
    """Get compliance % over time for the last 30 days."""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT DATE(evaluated_at) as day,
                   COUNT(*) as total,
                   COUNT(*) FILTER (WHERE compliant = true) as compliant_count
            FROM config_baseline_evaluations
            WHERE evaluated_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(evaluated_at)
            ORDER BY day
        """)
        return [
            {"date": str(r["day"]), "total": r["total"], "compliant": r["compliant_count"],
             "pct": round(r["compliant_count"] / r["total"] * 100, 1) if r["total"] > 0 else 0}
            for r in rows
        ]


@router.get("/api/v1/baselines/compliance/{node_id}")
async def node_compliance(node_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        evals = await conn.fetch("""
            SELECT e.*, b.name as baseline_name FROM config_baseline_evaluations e
            JOIN config_baselines b ON b.id=e.baseline_id
            WHERE e.node_id=$1::uuid ORDER BY e.evaluated_at DESC
        """, node_id)
        drifts = await conn.fetch("""
            SELECT d.*, r.rule_name FROM config_drift_events d
            LEFT JOIN config_baseline_rules r ON r.id=d.rule_id
            WHERE d.node_id=$1::uuid AND d.status='open' ORDER BY d.detected_at DESC
        """, node_id)
        return {
            "node_id": node_id,
            "evaluations": [dict(r) for r in evals],
            "open_drifts": [dict(r) for r in drifts]
        }


@router.get("/api/v1/baselines/templates", dependencies=[Depends(verify_api_key)])
async def list_baseline_templates():
    """List available CIS benchmark templates."""
    return [
        {"id": t["id"], "name": t["name"], "description": t["description"],
         "baseline_type": t["baseline_type"], "rule_count": len(t["rules"])}
        for t in CIS_TEMPLATES.values()
    ]


@router.post("/api/v1/baselines/templates/{template_id}/import", dependencies=[Depends(verify_api_key)])
async def import_baseline_template(template_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Import a CIS benchmark template as a new baseline with all its rules."""
    template = CIS_TEMPLATES.get(template_id)
    if not template:
        raise not_found("Template not found")
    import json as _json
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO config_baselines (name, description, baseline_type, rules)
            VALUES ($1, $2, $3, $4::jsonb) RETURNING *
        """, template["name"], template["description"], template["baseline_type"], _json.dumps(template["rules"]))

        for rule in template["rules"]:
            await conn.execute("""
                INSERT INTO config_baseline_rules (baseline_id, rule_type, rule_name, expected_value, severity, enabled, remediation_action)
                VALUES ($1, $2, $3, $4::jsonb, $5, true, $6::jsonb)
            """, row["id"], rule["rule_type"], rule["rule_name"],
                _json.dumps(rule["expected_value"]), rule.get("severity", "medium"),
                _json.dumps(rule.get("remediation_action")) if rule.get("remediation_action") else None)

        return {"id": str(row["id"]), "name": row["name"], "status": "imported", "rules_created": len(template["rules"])}


@router.post("/api/v1/baselines/drift/{drift_id}/remediate", dependencies=[Depends(verify_api_key)])
async def remediate_drift(drift_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Trigger auto-remediation for a specific drift event."""
    import json as _json
    async with db.acquire() as conn:
        drift = await conn.fetchrow("""
            SELECT d.*, r.rule_type, r.rule_name, r.expected_value, r.remediation_action
            FROM config_drift_events d
            LEFT JOIN config_baseline_rules r ON r.id = d.rule_id
            WHERE d.id = $1::uuid AND d.status IN ('open', 'acknowledged')
        """, drift_id)
        if not drift:
            raise not_found("Drift event not found or not remediable")

        remediation = drift["remediation_action"]
        if isinstance(remediation, str):
            remediation = _json.loads(remediation)
        if not remediation or remediation.get("type") == "none":
            raise HTTPException(status_code=400, detail="No remediation action configured for this rule")

        # Look up node's text node_id
        node = await conn.fetchrow("SELECT node_id FROM nodes WHERE id = $1", drift["node_id"])
        if not node:
            raise not_found("Node not found")
        node_text_id = node["node_id"]

        # Create job based on remediation type
        job_id = str(uuid.uuid4())
        rem_type = remediation["type"]

        if rem_type == "install_package":
            command_type = "install_package"
            command_data = {"packageName": remediation["package"], "method": "winget"}
            job_name = f"Remediate: Install {remediation['package']}"
        elif rem_type == "start_service":
            command_type = "script"
            svc = remediation["service"]
            command_data = {"command": f"Start-Service '{svc}'; Set-Service '{svc}' -StartupType Automatic"}
            job_name = f"Remediate: Start service {svc}"
        elif rem_type == "run_command":
            command_type = "script"
            command_data = {"command": remediation["command"]}
            job_name = f"Remediate: {drift['rule_name'] or 'Custom command'}"
        else:
            raise HTTPException(status_code=400, detail=f"Unknown remediation type: {rem_type}")

        await conn.execute("""
            INSERT INTO jobs (id, name, description, target_type, target_id,
                             command_type, command_data, priority, created_by, timeout_seconds)
            VALUES ($1::uuid, $2, $3, 'device', $4::uuid, $5, $6::jsonb, 7, 'auto-remediation', 300)
        """, job_id, job_name, f"Auto-remediation for drift {drift_id}",
             str(drift["node_id"]), command_type, _json.dumps(command_data))

        await conn.execute("""
            INSERT INTO job_instances (job_id, node_id, status)
            VALUES ($1::uuid, $2, 'pending')
        """, job_id, node_text_id)

        await conn.execute(
            "UPDATE config_drift_events SET status='remediating' WHERE id=$1::uuid", drift_id)

        return {"status": "remediating", "drift_id": drift_id, "job_id": job_id, "action": remediation}


@router.post("/api/v1/baselines/{baseline_id}/remediate-all", dependencies=[Depends(verify_api_key)])
async def remediate_all_drifts(baseline_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Remediate all open drifts for a baseline."""
    import json as _json
    async with db.acquire() as conn:
        drifts = await conn.fetch("""
            SELECT d.id FROM config_drift_events d
            JOIN config_baseline_evaluations e ON e.id = d.evaluation_id
            JOIN config_baseline_rules r ON r.id = d.rule_id
            WHERE e.baseline_id = $1::uuid AND d.status IN ('open', 'acknowledged')
            AND r.remediation_action IS NOT NULL
            AND r.remediation_action::text != '{"type": "none"}'
        """, baseline_id)

        results = []
        for drift in drifts:
            try:
                result = await remediate_drift(str(drift["id"]), db)
                results.append({"drift_id": str(drift["id"]), "status": "triggered"})
            except Exception as e:
                results.append({"drift_id": str(drift["id"]), "status": "error", "error": str(e)})

        return {"baseline_id": baseline_id, "total": len(drifts), "results": results}


@router.get("/api/v1/baselines/{baseline_id}")
async def get_config_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM config_baselines WHERE id = $1::uuid", baseline_id)
        if not row:
            raise not_found("Baseline not found")
        result = dict(row)
        result["rules"] = [dict(r) for r in await conn.fetch(
            "SELECT * FROM config_baseline_rules WHERE baseline_id = $1::uuid ORDER BY created_at", baseline_id)]
        result["assignments"] = [dict(r) for r in await conn.fetch(
            "SELECT * FROM config_baseline_assignments WHERE baseline_id = $1::uuid", baseline_id)]
        return result


@router.put("/api/v1/baselines/{baseline_id}")
async def update_config_baseline(baseline_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    import json as _json
    async with db.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow("SELECT id FROM config_baselines WHERE id = $1::uuid", baseline_id)
            if not existing:
                raise not_found("Baseline not found")
            await conn.execute("""
                UPDATE config_baselines SET name=COALESCE($2, name), description=COALESCE($3, description),
                baseline_type=COALESCE($4, baseline_type), updated_at=NOW(), version=version+1
                WHERE id = $1::uuid
            """, baseline_id, data.get("name"), data.get("description"), data.get("baseline_type"))
            if "rules" in data:
                await conn.execute("DELETE FROM config_baseline_rules WHERE baseline_id = $1::uuid", baseline_id)
                for r in data["rules"]:
                    await conn.execute("""
                        INSERT INTO config_baseline_rules (baseline_id, rule_type, rule_name, expected_value, severity, enabled, remediation_action)
                        VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
                    """, baseline_id, r.get("rule_type", "software"),
                        r["rule_name"], _json.dumps(r.get("expected_value", {})),
                        r.get("severity", "medium"), r.get("enabled", True),
                        _json.dumps(r.get("remediation_action")) if r.get("remediation_action") else None)
            return {"status": "updated"}


@router.delete("/api/v1/baselines/{baseline_id}")
async def delete_config_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        deleted = await conn.fetchrow("DELETE FROM config_baselines WHERE id = $1::uuid RETURNING id", baseline_id)
        if not deleted:
            raise not_found("Baseline not found")
        return {"status": "deleted"}


@router.get("/api/v1/baselines/{baseline_id}/rules")
async def list_baseline_rules(baseline_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM config_baseline_rules WHERE baseline_id = $1::uuid ORDER BY created_at", baseline_id)
        return [dict(r) for r in rows]


@router.post("/api/v1/baselines/{baseline_id}/rules")
async def add_baseline_rule(baseline_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    import json as _json
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO config_baseline_rules (baseline_id, rule_type, rule_name, expected_value, severity, enabled, remediation_action)
            VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7::jsonb) RETURNING *
        """, baseline_id, data.get("rule_type", "software"), data["rule_name"],
            _json.dumps(data.get("expected_value", {})), data.get("severity", "medium"), data.get("enabled", True),
            _json.dumps(data.get("remediation_action")) if data.get("remediation_action") else None)
        return dict(row)


@router.put("/api/v1/baselines/rules/{rule_id}")
async def update_baseline_rule(rule_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    import json as _json
    async with db.acquire() as conn:
        sets = []
        vals = [rule_id]
        i = 2
        for field in ["rule_type", "rule_name", "severity", "enabled"]:
            if field in data:
                sets.append(f"{field}=${i}")
                vals.append(data[field])
                i += 1
        if "expected_value" in data:
            sets.append(f"expected_value=${i}::jsonb")
            vals.append(_json.dumps(data["expected_value"]))
            i += 1
        if not sets:
            return {"status": "no changes"}
        row = await conn.fetchrow(f"UPDATE config_baseline_rules SET {', '.join(sets)} WHERE id=$1::uuid RETURNING *", *vals)
        if not row:
            raise not_found("Rule not found")
        return dict(row)


@router.delete("/api/v1/baselines/rules/{rule_id}")
async def delete_baseline_rule(rule_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        deleted = await conn.fetchrow("DELETE FROM config_baseline_rules WHERE id=$1::uuid RETURNING id", rule_id)
        if not deleted:
            raise not_found("Rule not found")
        return {"status": "deleted"}


@router.get("/api/v1/baselines/{baseline_id}/assignments")
async def list_baseline_assignments(baseline_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM config_baseline_assignments WHERE baseline_id=$1::uuid", baseline_id)
        return [dict(r) for r in rows]


@router.post("/api/v1/baselines/{baseline_id}/assign")
async def assign_baseline(baseline_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO config_baseline_assignments (baseline_id, target_type, target_id)
            VALUES ($1::uuid, $2, $3::uuid) RETURNING *
        """, baseline_id, data["target_type"], data["target_id"])
        return dict(row)


@router.delete("/api/v1/baselines/{baseline_id}/assignments/{assignment_id}")
async def remove_baseline_assignment(baseline_id: str, assignment_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        deleted = await conn.fetchrow(
            "DELETE FROM config_baseline_assignments WHERE id=$1::uuid AND baseline_id=$2::uuid RETURNING id",
            assignment_id, baseline_id)
        if not deleted:
            raise not_found("Assignment not found")
        return {"status": "deleted"}


@router.post("/api/v1/baselines/{baseline_id}/evaluate")
async def evaluate_baseline(baseline_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    """Evaluate baseline against all assigned nodes using inventory data."""
    import json as _json
    async with db.acquire() as conn:
        baseline = await conn.fetchrow("SELECT * FROM config_baselines WHERE id=$1::uuid", baseline_id)
        if not baseline:
            raise not_found("Baseline not found")
        rules = await conn.fetch("SELECT * FROM config_baseline_rules WHERE baseline_id=$1::uuid AND enabled=true", baseline_id)
        if not rules:
            return {"status": "no rules", "evaluations": []}

        # Collect assigned node IDs
        assignments = await conn.fetch("SELECT * FROM config_baseline_assignments WHERE baseline_id=$1::uuid", baseline_id)
        node_ids = set()
        for a in assignments:
            if a["target_type"] == "node":
                node_ids.add(a["target_id"])
            elif a["target_type"] == "group":
                members = await conn.fetch("SELECT node_id FROM device_groups WHERE group_id=$1", a["target_id"])
                for m in members:
                    node_ids.add(m["node_id"])

        if not node_ids:
            return {"status": "no assigned nodes", "evaluations": []}

        evaluations = []
        for node_id in node_ids:
            total = len(rules)
            passed = 0
            failed = 0
            skipped = 0
            details = []

            for rule in rules:
                rule_result = {"rule_id": str(rule["id"]), "rule_name": rule["rule_name"],
                              "rule_type": rule["rule_type"], "status": "skipped", "expected": None, "actual": None}
                ev = rule["expected_value"] if isinstance(rule["expected_value"], dict) else _json.loads(rule["expected_value"]) if rule["expected_value"] else {}
                rule_result["expected"] = ev

                if rule["rule_type"] == "software":
                    pkg_name = ev.get("package", "")
                    operator = ev.get("operator", "installed")
                    sw = await conn.fetchrow(
                        "SELECT name, version FROM software_current WHERE node_id=$1 AND LOWER(name) LIKE LOWER($2) LIMIT 1",
                        node_id, f"%{pkg_name}%")
                    if operator == "installed":
                        if sw:
                            rule_result["status"] = "passed"
                            rule_result["actual"] = {"installed": True, "version": sw["version"]}
                            passed += 1
                        else:
                            rule_result["status"] = "failed"
                            rule_result["actual"] = {"installed": False}
                            failed += 1
                    elif operator == "not_installed":
                        if not sw:
                            rule_result["status"] = "passed"
                            rule_result["actual"] = {"installed": False}
                            passed += 1
                        else:
                            rule_result["status"] = "failed"
                            rule_result["actual"] = {"installed": True, "version": sw["version"]}
                            failed += 1
                    elif operator == "version_eq":
                        if sw and sw["version"] == ev.get("version", ""):
                            rule_result["status"] = "passed"
                            rule_result["actual"] = {"version": sw["version"]}
                            passed += 1
                        else:
                            rule_result["status"] = "failed"
                            rule_result["actual"] = {"version": sw["version"] if sw else None}
                            failed += 1
                    elif operator == "version_gte":
                        if sw and sw["version"] and sw["version"] >= ev.get("version", ""):
                            rule_result["status"] = "passed"
                            rule_result["actual"] = {"version": sw["version"]}
                            passed += 1
                        else:
                            rule_result["status"] = "failed"
                            rule_result["actual"] = {"version": sw["version"] if sw else None}
                            failed += 1
                    else:
                        skipped += 1

                elif rule["rule_type"] == "service":
                    svc_name = ev.get("service", "")
                    expected_state = ev.get("state", "running").lower()
                    # Services are stored in system_current.services->'services' JSONB array
                    svc_row = await conn.fetchrow(
                        "SELECT services FROM system_current WHERE node_id=$1",
                        node_id)
                    svc_found = None
                    if svc_row and svc_row["services"]:
                        svc_data = svc_row["services"] if isinstance(svc_row["services"], dict) else _json.loads(svc_row["services"])
                        svc_list = svc_data.get("services", [])
                        for s in svc_list:
                            if s.get("name","").lower() == svc_name.lower() or s.get("displayName","").lower() == svc_name.lower():
                                svc_found = s
                                break
                    if svc_found:
                        actual_state = (svc_found.get("state") or "").lower()
                        if actual_state == expected_state:
                            rule_result["status"] = "passed"
                            passed += 1
                        else:
                            rule_result["status"] = "failed"
                            failed += 1
                        rule_result["actual"] = {"service": svc_found.get("name"), "state": actual_state, "startMode": svc_found.get("startMode")}
                    else:
                        rule_result["status"] = "failed"
                        rule_result["actual"] = {"service": svc_name, "state": "not_found"}
                        failed += 1

                elif rule["rule_type"] in ("registry", "firewall"):
                    # Skip if no inventory data available for these types
                    skipped += 1
                    rule_result["status"] = "skipped"
                    rule_result["actual"] = {"reason": f"No {rule['rule_type']} inventory data available"}

                else:
                    skipped += 1

                details.append(rule_result)

            compliant = (failed == 0 and total > 0)
            eval_row = await conn.fetchrow("""
                INSERT INTO config_baseline_evaluations
                (baseline_id, node_id, compliant, total_rules, passed, failed, skipped, details)
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *
            """, baseline_id, node_id, compliant, total, passed, failed, skipped, _json.dumps(details))

            # Create drift events for failed rules
            for d in details:
                if d["status"] == "failed":
                    rule_uuid = d.get("rule_id")
                    await conn.execute("""
                        INSERT INTO config_drift_events (evaluation_id, rule_id, node_id, expected, actual, severity, status)
                        VALUES ($1, $2::uuid, $3, $4::jsonb, $5::jsonb, $6, 'open')
                    """, eval_row["id"], rule_uuid, node_id,
                        _json.dumps(d.get("expected", {})), _json.dumps(d.get("actual", {})),
                        next((r["severity"] for r in rules if str(r["id"]) == rule_uuid), "medium"))

            evaluations.append(dict(eval_row))

        return {"status": "evaluated", "evaluations": evaluations}


@router.get("/api/v1/baselines/{baseline_id}/evaluations")
async def list_baseline_evaluations(baseline_id: str, db: asyncpg.Pool = Depends(get_db), _=Depends(verify_api_key)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM config_baseline_evaluations WHERE baseline_id=$1::uuid ORDER BY evaluated_at DESC LIMIT 100
        """, baseline_id)
        return [dict(r) for r in rows]
