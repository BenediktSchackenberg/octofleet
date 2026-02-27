from fastapi import APIRouter, Depends, HTTPException
import asyncpg
from typing import Optional, List, Dict, Any
from dependencies import get_db, verify_api_key

router = APIRouter(
    prefix="/api/v1/alerts",
    tags=["alerting"],
    dependencies=[Depends(verify_api_key)]
)

@router.get("")
async def list_alerts_legacy():
    """Legacy: Redirects to new alert-history endpoint"""
    return {"message": "Use /api/v1/alert-history instead"}

@router.get("/stats")
async def get_alert_stats_legacy():
    """Legacy: Alert statistics placeholder"""
    return {"message": "Use new E19 alert system"}

@router.get("/test-legacy")
async def test_legacy_endpoint():
    """Placeholder to maintain route prefix"""
    return {"message": "Use /api/v1/alert-channels and /api/v1/alert-rules instead"}
