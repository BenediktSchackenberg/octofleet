
from fastapi import APIRouter, Depends

from auth import require_user_permission
from dependencies import verify_api_key

router = APIRouter(
    prefix="/api/v1/alerts",
    tags=["alerting"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("", dependencies=[Depends(require_user_permission("alerts:read"))])
async def list_alerts_legacy():
    """Legacy: Redirects to new alert-history endpoint"""
    return {"message": "Use /api/v1/alert-history instead"}

@router.get("/stats", dependencies=[Depends(require_user_permission("alerts:read"))])
async def get_alert_stats_legacy():
    """Legacy: Alert statistics placeholder"""
    return {"message": "Use new E19 alert system"}
