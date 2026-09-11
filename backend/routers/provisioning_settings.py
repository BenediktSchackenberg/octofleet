"""Persist provisioning configuration; only administrators can change it."""

from fastapi import APIRouter, Depends

from auth import require_permission
from provisioning_config import SETTINGS_KEY, ProvisioningConfig, export_environment, export_winpe, load_config
from routers.provisioning import get_db

router = APIRouter(prefix="/api/v1/provisioning/config", tags=["provisioning-settings"])


@router.get("")
async def read_config(user=Depends(require_permission("settings:read")), conn=Depends(get_db)):
    return await load_config(conn)


@router.put("")
async def write_config(config: ProvisioningConfig,
                       user=Depends(require_permission("settings:write")), conn=Depends(get_db)):
    await conn.execute("""
        INSERT INTO system_settings (key, value, updated_at, updated_by)
        VALUES ($1, $2, NOW(), $3)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
            updated_at = NOW(), updated_by = EXCLUDED.updated_by
    """, SETTINGS_KEY, config.model_dump_json(), user.username)
    return config


@router.get("/export")
async def export_config(user=Depends(require_permission("settings:write")), conn=Depends(get_db)):
    config = await load_config(conn)
    return {"filename": "pxe.env", "content": export_environment(config)}


@router.get("/export/winpe")
async def export_winpe_config(user=Depends(require_permission("settings:write")), conn=Depends(get_db)):
    config = await load_config(conn)
    return {"filename": "octofleet-config.cmd", "content": export_winpe(config)}
