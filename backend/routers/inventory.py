import json
from datetime import datetime
from typing import Any, Dict

import asyncpg
from fastapi import APIRouter, Depends

from alerting import update_node_health
from app.db.nodes import update_dynamic_device_groupships, upsert_node
from dependencies import get_db, not_found, parse_datetime, sanitize_for_postgres, verify_api_key

router = APIRouter(
    prefix="/api/v1/inventory",
    tags=["inventory"],
)

# Read-only endpoints require auth
_auth = [Depends(verify_api_key)]

@router.get("/hardware/fleet", dependencies=_auth)
async def get_hardware_fleet(db: asyncpg.Pool = Depends(get_db)):
    """Get aggregated hardware stats across all nodes"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT n.node_id, n.hostname, h.cpu, h.ram, h.disks, h.updated_at
            FROM nodes n
            JOIN hardware_current h ON n.id = h.node_id
        """)
        
        cpu_types = {}
        ram_distribution = {"8GB": 0, "16GB": 0, "32GB": 0, "64GB+": 0}
        total_storage_tb = 0
        total_free_storage_tb = 0
        disk_health = {"healthy": 0, "warning": 0, "critical": 0}
        physical_disk_health = {"healthy": 0, "warning": 0, "unhealthy": 0, "unknown": 0}
        disk_types = {"ssd": 0, "hdd": 0, "unknown": 0}
        bus_types = {}
        nodes_with_issues = []
        physical_disks = []
        
        for row in rows:
            # CPU aggregation
            if row['cpu']:
                cpu = json.loads(row['cpu'])
                name = cpu.get('name', 'Unknown')
                cpu_types[name] = cpu_types.get(name, 0) + 1
            
            # RAM aggregation
            if row['ram']:
                ram = json.loads(row['ram'])
                total_gb = ram.get('totalGB', 0)
                if total_gb >= 64:
                    ram_distribution["64GB+"] += 1
                elif total_gb >= 32:
                    ram_distribution["32GB"] += 1
                elif total_gb >= 16:
                    ram_distribution["16GB"] += 1
                else:
                    ram_distribution["8GB"] += 1
            
            # Storage aggregation
            if row['disks']:
                disks = json.loads(row['disks'])
                volumes = []
                physical = []
                if isinstance(disks, dict):
                    volumes = disks.get('volumes', [])
                    physical = disks.get('physical', [])
                elif isinstance(disks, list):
                    volumes = disks
                
                for pdisk in physical:
                    if not isinstance(pdisk, dict): continue
                    health = (pdisk.get('healthStatus') or 'unknown').lower()
                    if health == 'healthy': physical_disk_health['healthy'] += 1
                    elif health == 'warning':
                        physical_disk_health['warning'] += 1
                        nodes_with_issues.append({"nodeId": row['node_id'], "hostname": row['hostname'], "issue": f"Disk {pdisk.get('model', '?')} health warning", "severity": "warning"})
                    elif health == 'unhealthy':
                        physical_disk_health['unhealthy'] += 1
                        nodes_with_issues.append({"nodeId": row['node_id'], "hostname": row['hostname'], "issue": f"Disk {pdisk.get('model', '?')} UNHEALTHY!", "severity": "critical"})
                    else: physical_disk_health['unknown'] += 1
                    
                    is_ssd = pdisk.get('isSsd')
                    if is_ssd is True: disk_types['ssd'] += 1
                    elif is_ssd is False: disk_types['hdd'] += 1
                    else: disk_types['unknown'] += 1
                    
                    bus = pdisk.get('busType', 'Unknown')
                    bus_types[bus] = bus_types.get(bus, 0) + 1
                    
                    physical_disks.append({
                        "nodeId": row['node_id'], "hostname": row['hostname'], "model": pdisk.get('model'),
                        "sizeGB": pdisk.get('sizeGB', 0), "busType": bus, "isSsd": is_ssd,
                        "healthStatus": pdisk.get('healthStatus', 'Unknown'), "temperature": pdisk.get('temperature'), "wearLevel": pdisk.get('wearLevel')
                    })
                
                for vol in volumes:
                    if not isinstance(vol, dict): continue
                    size_gb = vol.get('sizeGB', 0)
                    free_gb = vol.get('freeGB', 0)
                    total_storage_tb += size_gb / 1024
                    total_free_storage_tb += free_gb / 1024
                    
                    used_percent = vol.get('usedPercent', 0)
                    if used_percent > 95:
                        disk_health["critical"] += 1
                        nodes_with_issues.append({"nodeId": row['node_id'], "hostname": row['hostname'], "issue": f"Disk {vol.get('driveLetter', '?')} at {used_percent:.0f}% full", "severity": "critical"})
                    elif used_percent > 85:
                        disk_health["warning"] += 1
                        nodes_with_issues.append({"nodeId": row['node_id'], "hostname": row['hostname'], "issue": f"Disk {vol.get('driveLetter', '?')} at {used_percent:.0f}% full", "severity": "warning"})
                    else: disk_health["healthy"] += 1
        
        top_cpus = sorted(cpu_types.items(), key=lambda x: x[1], reverse=True)[:10]
        top_bus_types = sorted(bus_types.items(), key=lambda x: x[1], reverse=True)
        physical_disks.sort(key=lambda d: (0 if d['healthStatus'] == 'Unhealthy' else 1 if d['healthStatus'] == 'Warning' else 2, d['hostname']))
        
        return {
            "nodeCount": len(rows),
            "cpuTypes": [{"name": name, "count": count} for name, count in top_cpus],
            "ramDistribution": ram_distribution,
            "storage": {
                "totalTB": round(total_storage_tb, 2), "freeTB": round(total_free_storage_tb, 2),
                "usedTB": round(total_storage_tb - total_free_storage_tb, 2),
                "usedPercent": round((total_storage_tb - total_free_storage_tb) / total_storage_tb * 100, 1) if total_storage_tb > 0 else 0
            },
            "diskHealth": disk_health, "physicalDiskHealth": physical_disk_health, "diskTypes": disk_types,
            "busTypes": [{"name": name, "count": count} for name, count in top_bus_types],
            "physicalDisks": physical_disks[:50], "issues": nodes_with_issues[:20]
        }

@router.get("/hardware/{node_id}", dependencies=_auth)
async def get_hardware(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get hardware data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT cpu, ram, disks, mainboard, bios, gpu, nics, virtualization, updated_at FROM hardware_current WHERE node_id = $1", node['id'])
        if not row: return {"data": None}
        return {"data": {
            "cpu": json.loads(row['cpu']) if row['cpu'] else {},
            "ram": json.loads(row['ram']) if row['ram'] else {},
            "disks": json.loads(row['disks']) if row['disks'] else {},
            "mainboard": json.loads(row['mainboard']) if row['mainboard'] else {},
            "bios": json.loads(row['bios']) if row['bios'] else {},
            "gpu": json.loads(row['gpu']) if row['gpu'] else [],
            "nics": json.loads(row['nics']) if row['nics'] else [],
            "virtualization": json.loads(row['virtualization']) if row['virtualization'] else None,
            "updatedAt": row['updated_at'].isoformat() if row['updated_at'] else None
        }}

@router.get("/software/{node_id}", dependencies=_auth)
async def get_software(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get software data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        rows = await conn.fetch("SELECT name, version, publisher, install_date, install_path FROM software_current WHERE node_id = $1 ORDER BY name", node['id'])
        return {"data": {"installedPrograms": [dict(r) for r in rows]}}

@router.get("/hotfixes/{node_id}", dependencies=_auth)
async def get_hotfixes(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get hotfix data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        hotfix_rows = await conn.fetch('SELECT kb_id as "hotfixId", description, installed_on as "installedOn", installed_by as "installedBy" FROM hotfixes_current WHERE node_id = $1 ORDER BY installed_on DESC', node['id'])
        update_rows = await conn.fetch('SELECT update_id as "updateId", kb_id as "kbId", title, description, installed_on as "installedOn", operation, result_code as "resultCode", support_url as "supportUrl", categories FROM update_history WHERE node_id = $1 ORDER BY installed_on DESC', node['id'])
        
        update_history = []
        for row in update_rows:
            entry = dict(row)
            if entry.get('categories'): entry['categories'] = json.loads(entry['categories'])
            update_history.append(entry)
            
        return {"data": {"hotfixes": [dict(r) for r in hotfix_rows], "updateHistory": update_history, "hotfixCount": len(hotfix_rows), "updateHistoryCount": len(update_history)}}

@router.get("/system/{node_id}", dependencies=_auth)
async def get_system(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get system data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id, os_name, os_version, os_build FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT users, services, startup_items, scheduled_tasks, computer_name, domain, workgroup, domain_role, is_domain_joined, uptime_hours, uptime_formatted, last_boot_time, updated_at FROM system_current WHERE node_id = $1", node['id'])
        return {"data": {
            "osName": node['os_name'], "osVersion": node['os_version'], "osBuild": node['os_build'],
            "computerName": row['computer_name'] if row else None, "domain": row['domain'] if row else None,
            "workgroup": row['workgroup'] if row else None, "domainRole": row['domain_role'] if row else None,
            "isDomainJoined": row['is_domain_joined'] if row else None, "uptimeHours": row['uptime_hours'] if row else None,
            "uptimeFormatted": row['uptime_formatted'] if row else None, "lastBootTime": row['last_boot_time'].isoformat() if row and row['last_boot_time'] else None,
            "users": json.loads(row['users']) if row and row['users'] else [], "services": json.loads(row['services']) if row and row['services'] else [],
            "startupItems": json.loads(row['startup_items']) if row and row['startup_items'] else [], "scheduledTasks": json.loads(row['scheduled_tasks']) if row and row['scheduled_tasks'] else []
        }}

@router.get("/security/{node_id}", dependencies=_auth)
async def get_security(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get security data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT defender, firewall, tpm, uac, bitlocker, local_admins, updated_at FROM security_current WHERE node_id = $1", node['id'])
        if not row: return {"data": None}
        return {"data": {
            "defender": json.loads(row['defender']) if row['defender'] else {}, "firewall": json.loads(row['firewall']) if row['firewall'] else [],
            "tpm": json.loads(row['tpm']) if row['tpm'] else {}, "uac": json.loads(row['uac']) if row['uac'] else {},
            "bitlocker": json.loads(row['bitlocker']) if row['bitlocker'] else [], "localAdmins": json.loads(row['local_admins']) if row['local_admins'] else {}
        }}

@router.get("/network/{node_id}", dependencies=_auth)
async def get_network(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get network data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT adapters, connections, listening_ports, updated_at FROM network_current WHERE node_id = $1", node['id'])
        if not row: return {"data": None}
        return {"data": {
            "adapters": json.loads(row['adapters']) if row['adapters'] else [], "connections": json.loads(row['connections']) if row['connections'] else [],
            "listeningPorts": json.loads(row['listening_ports']) if row['listening_ports'] else []
        }}

@router.get("/linux/{node_id}", dependencies=_auth)
async def get_linux_data(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get Linux-specific data for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT performance, services, updates, disk_health, updated_at FROM linux_data_current WHERE node_id = $1", str(node['id']))
        if not row: return {"data": None}
        return {"data": {
            "performance": json.loads(row['performance']) if row['performance'] else None, "services": json.loads(row['services']) if row['services'] else None,
            "updates": json.loads(row['updates']) if row['updates'] else None, "diskHealth": json.loads(row['disk_health']) if row['disk_health'] else None,
            "updatedAt": row['updated_at'].isoformat() if row['updated_at'] else None
        }}

@router.get("/browser/{node_id}", dependencies=_auth)
async def get_browser_inventory(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get browser inventory for a node"""
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        rows = await conn.fetch("SELECT browser, profile, username, history_count, bookmark_count, cookies_count, logins_count, extensions, updated_at FROM browser_current WHERE node_id = $1", node['id'])
        return {"browsers": [dict(r) for r in rows]}

@router.post("/hardware")
async def submit_hardware(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit hardware inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    uuid = await upsert_node(db, node_id_str, hostname)
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO hardware_current (node_id, cpu, ram, disks, mainboard, bios, gpu, nics, virtualization, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (node_id) DO UPDATE SET
                cpu = $2, ram = $3, disks = $4, mainboard = $5, bios = $6, gpu = $7, nics = $8, virtualization = $9, updated_at = NOW()
        """, uuid, json.dumps(data.get("cpu", {})), json.dumps(data.get("ram") or data.get("memory", {})), json.dumps(data.get("disks", {})), json.dumps(data.get("mainboard", {})), json.dumps(data.get("bios", {})), json.dumps(data.get("gpu") or data.get("gpus", [])), json.dumps(data.get("nics") or data.get("networkAdapters", [])), json.dumps(data.get("virtualization")) if data.get("virtualization") else None)
    return {"status": "ok", "node_id": str(uuid), "type": "hardware"}

@router.post("/software")
async def submit_software(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit software inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    programs = data.get("programs", [])
    uuid = await upsert_node(db, node_id_str, hostname)
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM software_current WHERE node_id = $1", uuid)
        for prog in programs:
            await conn.execute("""
                INSERT INTO software_current (node_id, name, version, publisher, install_date, install_path, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
            """, uuid, prog.get("name", "Unknown")[:500], prog.get("version", "")[:100] if prog.get("version") else None, prog.get("publisher", "")[:255] if prog.get("publisher") else None, None, prog.get("installLocation"))
    return {"status": "ok", "node_id": str(uuid), "type": "software", "count": len(programs)}

@router.post("/hotfixes")
async def submit_hotfixes(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit hotfix inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    hotfixes = data.get("hotfixes", [])
    update_history = data.get("updateHistory", [])
    uuid = await upsert_node(db, node_id_str, hostname)
    async with db.acquire() as conn:
        await conn.execute("DELETE FROM hotfixes_current WHERE node_id = $1", uuid)
        for hf in hotfixes:
            if isinstance(hf, dict):
                kb_id = hf.get("kbId") or hf.get("hotfixId") or ""
                if not kb_id: continue
                await conn.execute("INSERT INTO hotfixes_current (node_id, kb_id, description, installed_on, installed_by, updated_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (node_id, kb_id) DO UPDATE SET description = EXCLUDED.description, installed_on = EXCLUDED.installed_on, installed_by = EXCLUDED.installed_by, updated_at = NOW()", uuid, kb_id, hf.get("description"), parse_datetime(hf.get("installedOn")), hf.get("installedBy"))
            elif isinstance(hf, str) and hf:
                await conn.execute("INSERT INTO hotfixes_current (node_id, kb_id, description, installed_on, installed_by, updated_at) VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (node_id, kb_id) DO UPDATE SET updated_at = NOW()", uuid, hf, None, None, None)
        await conn.execute("DELETE FROM update_history WHERE node_id = $1", uuid)
        for upd in update_history:
            update_id = upd.get("updateId") or upd.get("title", "")[:100]
            if not update_id: continue
            await conn.execute("INSERT INTO update_history (node_id, update_id, kb_id, title, description, installed_on, operation, result_code, support_url, categories, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) ON CONFLICT (node_id, update_id) DO UPDATE SET kb_id = EXCLUDED.kb_id, title = EXCLUDED.title, description = EXCLUDED.description, installed_on = EXCLUDED.installed_on, operation = EXCLUDED.operation, result_code = EXCLUDED.result_code, support_url = EXCLUDED.support_url, categories = EXCLUDED.categories, updated_at = NOW()", uuid, update_id, upd.get("kbId"), upd.get("title", "Unknown Update")[:500], upd.get("description"), parse_datetime(upd.get("installedOn")), upd.get("operation"), upd.get("resultCode"), upd.get("supportUrl"), json.dumps(upd.get("categories", [])))
    return {"status": "ok", "node_id": str(uuid), "type": "hotfixes", "hotfixCount": len(hotfixes), "updateHistoryCount": len(update_history)}

@router.post("/system")
async def submit_system(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit system inventory"""
    hostname = data.get("hostname", "unknown")
    node_id_str = data.get("nodeId", hostname)
    os_info = data.get("os", {})
    uuid = await upsert_node(db, node_id_str, hostname, os_name=os_info.get("name"), os_version=os_info.get("version"), os_build=os_info.get("build"))
    last_boot_time = None
    if os_info.get("lastBootTime"):
        try: last_boot_time = datetime.fromisoformat(os_info.get("lastBootTime").replace("Z", "+00:00"))
        except: pass
    async with db.acquire() as conn:
        agent_version = os_info.get("agentVersion")
        await conn.execute("""
            INSERT INTO system_current (node_id, users, services, startup_items, scheduled_tasks, os_name, os_version, os_build, computer_name, domain, workgroup, domain_role, is_domain_joined, uptime_hours, uptime_formatted, last_boot_time, agent_version, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
            ON CONFLICT (node_id) DO UPDATE SET users = $2, services = $3, startup_items = $4, scheduled_tasks = $5, os_name = $6, os_version = $7, os_build = $8, computer_name = $9, domain = $10, workgroup = $11, domain_role = $12, is_domain_joined = $13, uptime_hours = $14, uptime_formatted = $15, last_boot_time = $16, agent_version = $17, updated_at = NOW()
        """, uuid, json.dumps(data.get("users", [])), json.dumps(data.get("services", [])), json.dumps(data.get("startupItems", [])), json.dumps(data.get("scheduledTasks", [])), os_info.get("name"), os_info.get("version"), os_info.get("build"), os_info.get("computerName"), os_info.get("domain"), os_info.get("workgroup"), os_info.get("domainRole"), os_info.get("isDomainJoined"), os_info.get("uptimeHours"), os_info.get("uptimeFormatted"), last_boot_time, agent_version)
        if agent_version: await conn.execute("UPDATE nodes SET agent_version = $1 WHERE id = $2", agent_version, uuid)
    await update_dynamic_device_groupships(db, uuid, {"hostname": hostname, "os_name": os_info.get("name", ""), "os_version": os_info.get("version", ""), "os_build": os_info.get("build", ""), "agent_version": agent_version or "", "domain": os_info.get("domain", ""), "is_domain_joined": os_info.get("isDomainJoined", False)})
    return {"status": "ok", "node_id": str(uuid), "type": "system"}

@router.post("/full")
async def submit_full(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Submit full inventory (all types at once)"""
    data = sanitize_for_postgres(data)
    hostname = data.get("hostname", "unknown")
    results = {"hostname": hostname, "submitted": []}
    hw_data = data.get("hardware", {})
    if hw_data.get("cpu") or hw_data.get("ram"):
        await submit_hardware({"hostname": hostname, "nodeId": data.get("nodeId", hostname), **hw_data}, db)
        results["submitted"].append("hardware")
    sw_obj = data.get("software", {})
    sw_data = sw_obj.get("software", []) if isinstance(sw_obj, dict) else sw_obj
    if sw_data:
        await submit_software({"hostname": hostname, "nodeId": data.get("nodeId", hostname), "programs": sw_data}, db)
        results["submitted"].append("software")
    hf_obj = data.get("hotfixes", {})
    hf_data = hf_obj.get("hotfixes", []) if isinstance(hf_obj, dict) else hf_obj
    update_history_data = hf_obj.get("updateHistory", []) if isinstance(hf_obj, dict) else []
    if hf_data or update_history_data:
        await submit_hotfixes({"hostname": hostname, "nodeId": data.get("nodeId", hostname), "hotfixes": hf_data, "updateHistory": update_history_data}, db)
        results["submitted"].append("hotfixes")
    sys_data = data.get("system", {})
    if sys_data.get("os") or sys_data.get("services"):
        await submit_system({"hostname": hostname, "nodeId": data.get("nodeId", hostname), **sys_data}, db)
        results["submitted"].append("system")
    try: await update_node_health(db, data.get("nodeId", hostname))
    except: pass
    return {"status": "ok", **results}
