from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from typing import Optional, List, Dict, Any
import json
from uuid import UUID
from datetime import datetime
from dependencies import get_db, verify_api_key, not_found

router = APIRouter(
    prefix="/api/v1/inventory",
    tags=["inventory"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("/hardware/fleet")
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
            if row['cpu']:
                cpu = json.loads(row['cpu'])
                name = cpu.get('name', 'Unknown')
                cpu_types[name] = cpu_types.get(name, 0) + 1
            
            if row['ram']:
                ram = json.loads(row['ram'])
                total_gb = ram.get('totalGB', 0)
                if total_gb >= 64: ram_distribution["64GB+"] += 1
                elif total_gb >= 32: ram_distribution["32GB"] += 1
                elif total_gb >= 16: ram_distribution["16GB"] += 1
                else: ram_distribution["8GB"] += 1
            
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
        
        return {
            "nodeCount": len(rows),
            "cpuTypes": [{"name": name, "count": count} for name, count in sorted(cpu_types.items(), key=lambda x: x[1], reverse=True)[:10]],
            "ramDistribution": ram_distribution,
            "storage": {
                "totalTB": round(total_storage_tb, 2), "freeTB": round(total_free_storage_tb, 2),
                "usedTB": round(total_storage_tb - total_free_storage_tb, 2),
                "usedPercent": round((total_storage_tb - total_free_storage_tb) / total_storage_tb * 100, 1) if total_storage_tb > 0 else 0
            },
            "diskHealth": disk_health, "physicalDiskHealth": physical_disk_health, "diskTypes": disk_types,
            "busTypes": [{"name": name, "count": count} for name, count in sorted(bus_types.items(), key=lambda x: x[1], reverse=True)],
            "physicalDisks": physical_disks[:50], "issues": nodes_with_issues[:20]
        }

@router.get("/software/{node_id}")
async def get_software(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        rows = await conn.fetch("SELECT name, version, publisher, install_date, install_path FROM software_current WHERE node_id::uuid = $1::uuid ORDER BY name", node['id'])
        return {"data": {"installedPrograms": [dict(r) for r in rows]}}

@router.get("/hotfixes/{node_id}")
async def get_hotfixes(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        hotfix_rows = await conn.fetch('SELECT kb_id as "hotfixId", description, installed_on as "installedOn", installed_by as "installedBy" FROM hotfixes_current WHERE node_id::uuid = $1::uuid ORDER BY installed_on DESC', node['id'])
        update_rows = await conn.fetch('SELECT update_id as "updateId", kb_id as "kbId", title, description, installed_on as "installedOn", operation, result_code as "resultCode", support_url as "supportUrl", categories FROM update_history WHERE node_id::uuid = $1::uuid ORDER BY installed_on DESC', node['id'])
        
        update_history = []
        for row in update_rows:
            entry = dict(row)
            if entry.get('categories'): entry['categories'] = json.loads(entry['categories'])
            update_history.append(entry)
            
        return {"data": {"hotfixes": [dict(r) for r in hotfix_rows], "updateHistory": update_history, "hotfixCount": len(hotfix_rows), "updateHistoryCount": len(update_history)}}

@router.get("/system/{node_id}")
async def get_system(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id, os_name, os_version, os_build FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT users, services, startup_items, scheduled_tasks, computer_name, domain, workgroup, domain_role, is_domain_joined, uptime_hours, uptime_formatted, last_boot_time, updated_at FROM system_current WHERE node_id::uuid = $1::uuid", node['id'])
        return {"data": {
            "osName": node['os_name'], "osVersion": node['os_version'], "osBuild": node['os_build'],
            "computerName": row['computer_name'] if row else None, "domain": row['domain'] if row else None,
            "workgroup": row['workgroup'] if row else None, "domainRole": row['domain_role'] if row else None,
            "isDomainJoined": row['is_domain_joined'] if row else None, "uptimeHours": row['uptime_hours'] if row else None,
            "uptimeFormatted": row['uptime_formatted'] if row else None, "lastBootTime": row['last_boot_time'].isoformat() if row and row['last_boot_time'] else None,
            "users": json.loads(row['users']) if row and row['users'] else [], "services": json.loads(row['services']) if row and row['services'] else [],
            "startupItems": json.loads(row['startup_items']) if row and row['startup_items'] else [], "scheduledTasks": json.loads(row['scheduled_tasks']) if row and row['scheduled_tasks'] else []
        }}

@router.get("/security/{node_id}")
async def get_security(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT defender, firewall, tpm, uac, bitlocker, local_admins, updated_at FROM security_current WHERE node_id::uuid = $1::uuid", node['id'])
        if not row: return {"data": None}
        return {"data": {
            "defender": json.loads(row['defender']) if row['defender'] else {}, "firewall": json.loads(row['firewall']) if row['firewall'] else [],
            "tpm": json.loads(row['tpm']) if row['tpm'] else {}, "uac": json.loads(row['uac']) if row['uac'] else {},
            "bitlocker": json.loads(row['bitlocker']) if row['bitlocker'] else [], "localAdmins": json.loads(row['local_admins']) if row['local_admins'] else {}
        }}

@router.get("/network/{node_id}")
async def get_network(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT adapters, connections, listening_ports, updated_at FROM network_current WHERE node_id::uuid = $1::uuid", node['id'])
        if not row: return {"data": None}
        return {"data": {
            "adapters": json.loads(row['adapters']) if row['adapters'] else [], "connections": json.loads(row['connections']) if row['connections'] else [],
            "listeningPorts": json.loads(row['listening_ports']) if row['listening_ports'] else []
        }}

@router.get("/linux/{node_id}")
async def get_linux_data(node_id: str, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        node = await conn.fetchrow("SELECT id FROM nodes WHERE node_id = $1 OR id::text = $1", node_id)
        if not node: raise not_found("Node", node_id)
        row = await conn.fetchrow("SELECT performance, services, updates, disk_health, updated_at FROM linux_data_current WHERE node_id::uuid = $1::uuid", node['id'])
        if not row: return {"data": None}
        return {"data": {
            "performance": json.loads(row['performance']) if row['performance'] else None, "services": json.loads(row['services']) if row['services'] else None,
            "updates": json.loads(row['updates']) if row['updates'] else None, "diskHealth": json.loads(row['disk_health']) if row['disk_health'] else None,
            "updatedAt": row['updated_at'].isoformat() if row['updated_at'] else None
        }}
