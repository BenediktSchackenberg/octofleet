"""
Octofleet API - Hardware Routes
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from dependencies import db_pool, get_db, verify_api_key
import asyncpg
from typing import Optional, Dict, List, Any
import json
import io
import csv
import re

router = APIRouter(tags=["Hardware"])


@router.get("/api/v1/hardware/fleet")
async def get_hardware_fleet(db: asyncpg.Pool = Depends(get_db)):
    """Hardware fleet overview for the Hardware dashboard page"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT h.node_id, n.hostname, h.cpu, h.ram, h.disks, h.gpu, h.mainboard, h.bios, h.updated_at
            FROM hardware_current h
            JOIN nodes n ON n.id = h.node_id
        """)
        
        node_count = len(rows)
        total_size_gb = 0
        used_size_gb = 0
        cpu_map = {}
        physical_disks = []
        issues = []
        disk_types = {"ssd": 0, "hdd": 0, "unknown": 0}
        health = {"healthy": 0, "warning": 0, "unhealthy": 0, "unknown": 0}
        
        for r in rows:
            hostname = r["hostname"] or "unknown"
            node_id = str(r["node_id"])
            
            # CPU stats
            cpu = r["cpu"] or {}
            if isinstance(cpu, str):
                try: cpu = json.loads(cpu)
                except: cpu = {}
            cpu_name = cpu.get("name", "Unknown CPU") if isinstance(cpu, dict) else "Unknown CPU"
            cpu_map[cpu_name] = cpu_map.get(cpu_name, 0) + 1
            
            # Disk stats
            disks = r["disks"] or {}
            if isinstance(disks, str):
                try: disks = json.loads(disks)
                except: disks = {}
            if isinstance(disks, dict):
                for vol in disks.get("volumes", []):
                    size = vol.get("sizeGB", 0) or 0
                    free = vol.get("freeGB", 0) or 0
                    total_size_gb += size
                    used_size_gb += (size - free)
                    
                    used_pct = vol.get("usedPercent", 0) or 0
                    if used_pct > 90:
                        issues.append({
                            "nodeId": node_id,
                            "hostname": hostname,
                            "issue": f"Laufwerk {vol.get('driveLetter', '?')} zu {used_pct:.0f}% belegt",
                            "severity": "critical" if used_pct > 95 else "warning"
                        })
                
                for pd in disks.get("physical", []):
                    is_ssd = pd.get("isSsd")
                    if is_ssd is True:
                        disk_types["ssd"] += 1
                    elif is_ssd is False:
                        disk_types["hdd"] += 1
                    else:
                        disk_types["unknown"] += 1
                    
                    hs = (pd.get("healthStatus") or "Unknown").lower()
                    if hs == "healthy":
                        health["healthy"] += 1
                    elif hs in ("warning", "degraded"):
                        health["warning"] += 1
                        issues.append({
                            "nodeId": node_id,
                            "hostname": hostname,
                            "issue": f"Disk {pd.get('model', '?')} Status: {pd.get('healthStatus')}",
                            "severity": "warning"
                        })
                    elif hs in ("unhealthy", "failed"):
                        health["unhealthy"] += 1
                        issues.append({
                            "nodeId": node_id,
                            "hostname": hostname,
                            "issue": f"Disk {pd.get('model', '?')} Status: {pd.get('healthStatus')}",
                            "severity": "critical"
                        })
                    else:
                        health["unknown"] += 1
                    
                    physical_disks.append({
                        "nodeId": node_id,
                        "hostname": hostname,
                        "model": pd.get("model", "Unknown"),
                        "sizeGB": pd.get("sizeGB", 0),
                        "isSsd": pd.get("isSsd"),
                        "healthStatus": pd.get("healthStatus", "Unknown"),
                        "busType": pd.get("busType"),
                        "temperature": pd.get("temperature"),
                        "wearLevel": pd.get("wearLevel"),
                        "powerOnHours": pd.get("powerOnHours"),
                    })
        
        total_tb = total_size_gb / 1024
        used_tb = used_size_gb / 1024
        used_pct = (used_size_gb / total_size_gb * 100) if total_size_gb > 0 else 0
        
        cpu_types = [{"name": k, "count": v} for k, v in sorted(cpu_map.items(), key=lambda x: -x[1])]
        
        return {
            "nodeCount": node_count,
            "storage": {"totalTB": round(total_tb, 2), "usedTB": round(used_tb, 2), "usedPercent": round(used_pct, 1)},
            "physicalDiskHealth": health,
            "diskTypes": disk_types,
            "cpuTypes": cpu_types,
            "physicalDisks": physical_disks,
            "issues": issues,
        }


@router.get("/api/v1/hardware/export")
async def export_fleet_hardware(
    format: str = "json",
    _: str = Depends(verify_api_key),
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Export fleet hardware data as JSON or CSV.
    
    Query params:
    - format: json (default) or csv
    """
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT 
                n.node_id,
                n.hostname,
                n.os_name,
                n.is_online,
                h.cpu->>'name' as cpu_name,
                (h.cpu->>'cores')::int as cpu_cores,
                (h.ram->>'totalGb')::numeric as ram_gb,
                jsonb_array_length(COALESCE(h.disks->'physical', '[]'::jsonb)) as disk_count,
                h.updated_at
            FROM nodes n
            LEFT JOIN hardware_current h ON n.id = h.node_id
            ORDER BY n.hostname
        """)
        
        if format.lower() == "csv":
            import io
            import csv
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(['node_id', 'hostname', 'os_name', 'is_online', 'cpu_name', 'cpu_cores', 'ram_gb', 'disk_count', 'updated_at'])
            for r in rows:
                writer.writerow([
                    r['node_id'], r['hostname'], r['os_name'], r['is_online'],
                    r['cpu_name'], r['cpu_cores'], float(r['ram_gb']) if r['ram_gb'] else None,
                    r['disk_count'], r['updated_at'].isoformat() if r['updated_at'] else None
                ])
            from fastapi.responses import Response
            return Response(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=fleet-hardware.csv"}
            )
        
        # JSON format
        return {
            "exportedAt": dt.utcnow().isoformat(),
            "nodeCount": len(rows),
            "nodes": [
                {
                    "nodeId": r['node_id'],
                    "hostname": r['hostname'],
                    "osName": r['os_name'],
                    "isOnline": r['is_online'],
                    "cpu": {"name": r['cpu_name'], "cores": r['cpu_cores']},
                    "ramGb": float(r['ram_gb']) if r['ram_gb'] else None,
                    "diskCount": r['disk_count'],
                    "updatedAt": r['updated_at'].isoformat() if r['updated_at'] else None
                }
                for r in rows
            ]
        }


@router.get("/api/v1/nodes/{node_id}/hardware/export", dependencies=[Depends(verify_api_key)])
async def export_node_hardware(
    node_id: str,
    format: str = "json",
    _: str = Depends(verify_api_key),
    db: asyncpg.Pool = Depends(get_db)
):
    """
    Export single node hardware data as JSON or CSV.
    """
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id, hostname FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node:
            raise not_found("Node", node_id)
        
        hw = await conn.fetchrow("""
            SELECT cpu, ram, disks, mainboard, bios, gpu, nics, updated_at
            FROM hardware_current WHERE node_id = $1
        """, node['id'])
        
        if not hw:
            raise HTTPException(status_code=404, detail="No hardware data")
        
        data = {
            "nodeId": node_id,
            "hostname": node['hostname'],
            "exportedAt": dt.utcnow().isoformat(),
            "cpu": json.loads(hw['cpu']) if hw['cpu'] else {},
            "ram": json.loads(hw['ram']) if hw['ram'] else {},
            "disks": json.loads(hw['disks']) if hw['disks'] else {},
            "mainboard": json.loads(hw['mainboard']) if hw['mainboard'] else {},
            "bios": json.loads(hw['bios']) if hw['bios'] else {},
            "gpu": json.loads(hw['gpu']) if hw['gpu'] else [],
            "nics": json.loads(hw['nics']) if hw['nics'] else [],
            "updatedAt": hw['updated_at'].isoformat() if hw['updated_at'] else None
        }
        
        if format.lower() == "csv":
            # Flatten for CSV
            import io
            import csv
            output = io.StringIO()
            writer = csv.writer(output)
            
            # CPU row
            cpu = data.get('cpu', {})
            writer.writerow(['Component', 'Property', 'Value'])
            writer.writerow(['CPU', 'Name', cpu.get('name', '')])
            writer.writerow(['CPU', 'Cores', cpu.get('cores', '')])
            writer.writerow(['CPU', 'Threads', cpu.get('logicalProcessors', '')])
            
            # RAM
            ram = data.get('ram', {})
            writer.writerow(['RAM', 'Total GB', ram.get('totalGb', '')])
            
            # Disks
            for i, disk in enumerate(data.get('disks', {}).get('physical', [])):
                writer.writerow([f'Disk {i+1}', 'Model', disk.get('model', '')])
                writer.writerow([f'Disk {i+1}', 'Size GB', disk.get('sizeGB', '')])
            
            from fastapi.responses import Response
            return Response(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={node_id}-hardware.csv"}
            )
        
        return data
