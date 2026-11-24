"""What a job result from an agent changes besides its job instance (POST /jobs/instances/{id}/result).

- "Create VM: ..." jobs (provisioning_vm.py): the VM's MAC address from the output activates the
  provisioning task linked to the job.
- patch_install jobs of a patch deployment (command_data has deployment_id and patches, the
  patch catalog IDs): the deployment's per-node results and patch_catalog_nodes, and the
  deployment is completed once no result is pending. Fleet updates (Windows kb_ids, Linux
  packages) carry no deployment and are read from job_instances directly.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# stdout and stderr are cut to this many characters
MAX_OUTPUT = 50000

_MAC = re.compile(r'"macAddress"\s*:\s*"([0-9A-Fa-f:]{17})"')


def vm_mac_address(stdout: Optional[str]) -> Optional[str]:
    """The MAC address a VM creation script prints ({"macAddress": "00:15:5D:..."}), upper case."""
    match = _MAC.search(stdout or "")
    return match.group(1).upper() if match else None


def patch_install_output(stdout: Optional[str]) -> Dict[str, Any]:
    """The Windows agent's patch_install output: {"installed": [KB...], "failed": [...], "reboot_required": bool}."""
    try:
        output = json.loads(stdout) if stdout else {}
    except ValueError:
        return {}
    return output if isinstance(output, dict) else {}


def patch_statuses(patch_ids: List[str], installed_ids: set, success: bool) -> Dict[str, str]:
    """installed or failed per patch catalog ID: installed when the agent names it or the job succeeded."""
    return {p: "installed" if p in installed_ids or success else "failed" for p in patch_ids}


async def apply_vm_creation(conn, job_id, stdout: Optional[str]) -> None:
    mac = vm_mac_address(stdout)
    if not mac:
        return
    task = await conn.fetchrow("""
        SELECT id, hostname FROM provisioning_tasks WHERE network_config::jsonb->>'vm_job_id' = $1
    """, str(job_id))
    if task:
        await conn.execute("""
            UPDATE provisioning_tasks
            SET mac_address = $1, status = 'pending', status_message = 'VM created, waiting for PXE boot',
                updated_at = NOW()
            WHERE id = $2
        """, mac, task["id"])
        logger.info("VM created: %s - MAC %s", task["hostname"], mac)


async def apply_patch_install(conn, command_data, node_id: str, success: bool, stdout: Optional[str]) -> None:
    if isinstance(command_data, str):
        command_data = json.loads(command_data)
    if not isinstance(command_data, dict):
        return
    deployment_id = command_data.get("deployment_id")
    patch_ids = command_data.get("patches") or []
    if not patch_ids and not deployment_id:
        return

    installed_kbs = patch_install_output(stdout).get("installed") or []
    installed_ids = set()
    if installed_kbs:
        rows = await conn.fetch("SELECT id::text FROM patch_catalog WHERE kb_id = ANY($1::text[])", installed_kbs)
        installed_ids = {r["id"] for r in rows}

    for patch_id, status in patch_statuses(patch_ids, installed_ids, success).items():
        if deployment_id:
            await conn.execute("""
                UPDATE patch_deployment_results
                SET status = $1, completed_at = NOW()
                WHERE deployment_id = $2::uuid AND node_id = $3 AND patch_id = $4::uuid
            """, status, deployment_id, node_id, patch_id)
        # patch_catalog_nodes holds the node's UUID or its text node ID (as routers/patches.py)
        await conn.execute("""
            UPDATE patch_catalog_nodes SET status = $1,
                installed_at = CASE WHEN $1 = 'installed' THEN NOW() ELSE NULL END
            WHERE patch_id = $2::uuid
              AND node_id IN ((SELECT n.id::text FROM nodes n WHERE n.node_id = $3 OR n.id::text = $3), $3)
        """, status, patch_id, node_id)

    if deployment_id:
        remaining = await conn.fetchval("""
            SELECT COUNT(*) FROM patch_deployment_results WHERE deployment_id = $1::uuid AND status = 'pending'
        """, deployment_id)
        if remaining == 0:
            await conn.execute("""
                UPDATE patch_deployments SET status = 'completed', completed_at = NOW()
                WHERE id = $1::uuid AND status IN ('pending', 'in_progress')
            """, deployment_id)
