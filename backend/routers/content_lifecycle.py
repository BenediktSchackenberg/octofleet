"""
E33: Content Repository & Lifecycle Management — MVP
"""
import json
from datetime import datetime, timezone
from uuid import UUID
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
import asyncpg
from dependencies import get_db, verify_api_key

router = APIRouter(prefix="/api/v1/content", tags=["Content Lifecycle"])
_auth = [Depends(verify_api_key)]


def _repo_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "name": r["name"],
        "description": r["description"],
        "repoType": r["repo_type"],
        "upstreamUrl": r["upstream_url"],
        "syncEnabled": r["sync_enabled"],
        "syncIntervalHours": r["sync_interval_hours"],
        "lastSyncedAt": r["last_synced_at"].isoformat() if r["last_synced_at"] else None,
        "gpgKey": r["gpg_key"],
        "authConfig": json.loads(r["auth_config"]) if isinstance(r["auth_config"], str) else r["auth_config"],
        "metadata": json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
        "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
    }


def _item_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "repositoryId": str(r["repository_id"]),
        "name": r["name"],
        "version": r["version"],
        "architecture": r["architecture"],
        "description": r["description"],
        "fileSize": r["file_size"],
        "sha256Hash": r["sha256_hash"],
        "storagePath": r["storage_path"],
        "sourceUrl": r["source_url"],
        "metadata": json.loads(r["metadata"]) if isinstance(r["metadata"], str) else r["metadata"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


def _snap_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "repositoryId": str(r["repository_id"]),
        "name": r["name"],
        "description": r["description"],
        "snapshotType": r["snapshot_type"],
        "itemCount": r["item_count"],
        "totalSize": r["total_size"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
        "createdBy": r["created_by"],
    }


def _env_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "name": r["name"],
        "description": r["description"],
        "sortOrder": r["sort_order"],
        "color": r["color"],
        "activeSnapshotId": str(r["active_snapshot_id"]) if r["active_snapshot_id"] else None,
        "promotedAt": r["promoted_at"].isoformat() if r["promoted_at"] else None,
        "promotedBy": r["promoted_by"],
        "priorSnapshotId": str(r["prior_snapshot_id"]) if r["prior_snapshot_id"] else None,
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


# ── Repositories ──────────────────────────────────────────────

@router.get("/repositories", dependencies=_auth)
async def list_repositories(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT r.*, COALESCE(c.cnt, 0) AS item_count
            FROM content_repositories r
            LEFT JOIN (SELECT repository_id, COUNT(*) AS cnt FROM content_items GROUP BY repository_id) c
              ON c.repository_id = r.id
            ORDER BY r.name
        """)
    return [
        {**_repo_row(r), "itemCount": r["item_count"]} for r in rows
    ]


@router.post("/repositories", dependencies=_auth, status_code=201)
async def create_repository(body: dict, db: asyncpg.Pool = Depends(get_db)):
    name = body.get("name")
    repo_type = body.get("repoType") or body.get("repo_type")
    if not name or not repo_type:
        raise HTTPException(400, "name and repoType are required")
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO content_repositories (name, description, repo_type, upstream_url, sync_enabled, sync_interval_hours, gpg_key, auth_config, metadata)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *
            """, name, body.get("description"), repo_type, body.get("upstreamUrl"),
                body.get("syncEnabled", False), body.get("syncIntervalHours", 24),
                body.get("gpgKey"), json.dumps(body.get("authConfig", {})), json.dumps(body.get("metadata", {})))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"Repository '{name}' already exists")
    return _repo_row(row)


@router.get("/repositories/{repo_id}", dependencies=_auth)
async def get_repository(repo_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM content_repositories WHERE id=$1", repo_id)
        if not row:
            raise HTTPException(404, "Repository not found")
        items = await conn.fetch(
            "SELECT * FROM content_items WHERE repository_id=$1 ORDER BY created_at DESC LIMIT 20", repo_id)
    return {**_repo_row(row), "recentItems": [_item_row(i) for i in items]}


@router.put("/repositories/{repo_id}", dependencies=_auth)
async def update_repository(repo_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM content_repositories WHERE id=$1", repo_id)
        if not existing:
            raise HTTPException(404, "Repository not found")
        row = await conn.fetchrow("""
            UPDATE content_repositories SET
                name=COALESCE($2, name), description=COALESCE($3, description),
                repo_type=COALESCE($4, repo_type), upstream_url=COALESCE($5, upstream_url),
                sync_enabled=COALESCE($6, sync_enabled), sync_interval_hours=COALESCE($7, sync_interval_hours),
                gpg_key=COALESCE($8, gpg_key), updated_at=now()
            WHERE id=$1 RETURNING *
        """, repo_id, body.get("name"), body.get("description"),
            body.get("repoType") or body.get("repo_type"), body.get("upstreamUrl"),
            body.get("syncEnabled"), body.get("syncIntervalHours"), body.get("gpgKey"))
    return _repo_row(row)


@router.delete("/repositories/{repo_id}", dependencies=_auth)
async def delete_repository(repo_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM content_repositories WHERE id=$1", repo_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Repository not found")
    return {"ok": True}


@router.post("/repositories/{repo_id}/sync", dependencies=_auth)
async def sync_repository(repo_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT id, upstream_url FROM content_repositories WHERE id=$1", repo_id)
        if not row:
            raise HTTPException(404, "Repository not found")
        await conn.execute(
            "UPDATE content_repositories SET last_synced_at=now(), updated_at=now() WHERE id=$1", repo_id)
    return {"ok": True, "message": "Sync triggered (marked as synced)", "upstreamUrl": row["upstream_url"]}


@router.get("/repositories/{repo_id}/items", dependencies=_auth)
async def list_repository_items(
    repo_id: UUID,
    search: Optional[str] = None,
    architecture: Optional[str] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: asyncpg.Pool = Depends(get_db),
):
    async with db.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM content_repositories WHERE id=$1", repo_id)
        if not exists:
            raise HTTPException(404, "Repository not found")
        conditions = ["repository_id=$1"]
        params: list = [repo_id]
        idx = 2
        if search:
            conditions.append(f"(name ILIKE ${idx} OR description ILIKE ${idx})")
            params.append(f"%{search}%")
            idx += 1
        if architecture:
            conditions.append(f"architecture=${idx}")
            params.append(architecture)
            idx += 1
        where = " AND ".join(conditions)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM content_items WHERE {where}", *params)
        rows = await conn.fetch(
            f"SELECT * FROM content_items WHERE {where} ORDER BY name, version OFFSET ${idx} LIMIT ${idx+1}",
            *params, offset, limit)
    return {"items": [_item_row(r) for r in rows], "total": total, "offset": offset, "limit": limit}


# ── Content Items ─────────────────────────────────────────────

@router.post("/repositories/{repo_id}/items", dependencies=_auth, status_code=201)
async def add_item(repo_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM content_repositories WHERE id=$1", repo_id)
        if not exists:
            raise HTTPException(404, "Repository not found")
        try:
            row = await conn.fetchrow("""
                INSERT INTO content_items (repository_id, name, version, architecture, description, file_size, sha256_hash, storage_path, source_url, metadata)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *
            """, repo_id, body["name"], body["version"], body.get("architecture"),
                body.get("description"), body.get("fileSize"), body.get("sha256Hash"),
                body.get("storagePath"), body.get("sourceUrl"), json.dumps(body.get("metadata", {})))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "Item with same name/version/arch already exists in this repo")
        except KeyError as e:
            raise HTTPException(400, f"Missing required field: {e}")
    return _item_row(row)


@router.get("/items/{item_id}", dependencies=_auth)
async def get_item(item_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM content_items WHERE id=$1", item_id)
    if not row:
        raise HTTPException(404, "Item not found")
    return _item_row(row)


@router.delete("/items/{item_id}", dependencies=_auth)
async def delete_item(item_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM content_items WHERE id=$1", item_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Item not found")
    return {"ok": True}


# ── Snapshots ─────────────────────────────────────────────────

@router.get("/snapshots", dependencies=_auth)
async def list_snapshots(
    repository_id: Optional[UUID] = None,
    db: asyncpg.Pool = Depends(get_db),
):
    async with db.acquire() as conn:
        if repository_id:
            rows = await conn.fetch(
                "SELECT * FROM content_snapshots WHERE repository_id=$1 ORDER BY created_at DESC", repository_id)
        else:
            rows = await conn.fetch("SELECT * FROM content_snapshots ORDER BY created_at DESC")
    return [_snap_row(r) for r in rows]


@router.post("/repositories/{repo_id}/snapshots", dependencies=_auth, status_code=201)
async def create_snapshot(repo_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    name = body.get("name")
    if not name:
        raise HTTPException(400, "name is required")
    async with db.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM content_repositories WHERE id=$1", repo_id)
        if not exists:
            raise HTTPException(404, "Repository not found")
        # Get current items
        items = await conn.fetch("SELECT id, file_size FROM content_items WHERE repository_id=$1", repo_id)
        item_count = len(items)
        total_size = sum(i["file_size"] or 0 for i in items)
        try:
            snap = await conn.fetchrow("""
                INSERT INTO content_snapshots (repository_id, name, description, snapshot_type, item_count, total_size, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
            """, repo_id, name, body.get("description"), body.get("snapshotType", "manual"),
                item_count, total_size, body.get("createdBy"))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"Snapshot '{name}' already exists in this repo")
        # Link items
        if items:
            await conn.executemany(
                "INSERT INTO content_snapshot_items (snapshot_id, item_id) VALUES ($1, $2)",
                [(snap["id"], i["id"]) for i in items])
    return _snap_row(snap)


@router.get("/snapshots/{snap_id}", dependencies=_auth)
async def get_snapshot(snap_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM content_snapshots WHERE id=$1", snap_id)
        if not row:
            raise HTTPException(404, "Snapshot not found")
        items = await conn.fetch("""
            SELECT ci.* FROM content_items ci
            JOIN content_snapshot_items csi ON csi.item_id = ci.id
            WHERE csi.snapshot_id=$1 ORDER BY ci.name
        """, snap_id)
    return {**_snap_row(row), "items": [_item_row(i) for i in items]}


@router.delete("/snapshots/{snap_id}", dependencies=_auth)
async def delete_snapshot(snap_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM content_snapshots WHERE id=$1", snap_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Snapshot not found")
    return {"ok": True}


@router.get("/snapshots/{snap_id}/diff/{other_id}", dependencies=_auth)
async def diff_snapshots(snap_id: UUID, other_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        for sid in (snap_id, other_id):
            if not await conn.fetchval("SELECT 1 FROM content_snapshots WHERE id=$1", sid):
                raise HTTPException(404, f"Snapshot {sid} not found")
        a_items = await conn.fetch(
            "SELECT ci.* FROM content_items ci JOIN content_snapshot_items csi ON csi.item_id=ci.id WHERE csi.snapshot_id=$1", snap_id)
        b_items = await conn.fetch(
            "SELECT ci.* FROM content_items ci JOIN content_snapshot_items csi ON csi.item_id=ci.id WHERE csi.snapshot_id=$1", other_id)
    a_ids = {r["id"] for r in a_items}
    b_ids = {r["id"] for r in b_items}
    a_map = {r["id"]: r for r in a_items}
    b_map = {r["id"]: r for r in b_items}
    return {
        "added": [_item_row(b_map[i]) for i in b_ids - a_ids],
        "removed": [_item_row(a_map[i]) for i in a_ids - b_ids],
        "unchanged": len(a_ids & b_ids),
    }


# ── Environments ──────────────────────────────────────────────

@router.get("/environments", dependencies=_auth)
async def list_environments(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT e.*, s.name AS snapshot_name, s.item_count AS snapshot_item_count
            FROM content_environments e
            LEFT JOIN content_snapshots s ON s.id = e.active_snapshot_id
            ORDER BY e.sort_order
        """)
    return [{
        **_env_row(r),
        "snapshotName": r["snapshot_name"],
        "snapshotItemCount": r["snapshot_item_count"],
    } for r in rows]


@router.put("/environments/{env_id}", dependencies=_auth)
async def update_environment(env_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM content_environments WHERE id=$1", env_id)
        if not existing:
            raise HTTPException(404, "Environment not found")
        row = await conn.fetchrow("""
            UPDATE content_environments SET
                name=COALESCE($2, name), description=COALESCE($3, description),
                color=COALESCE($4, color), sort_order=COALESCE($5, sort_order)
            WHERE id=$1 RETURNING *
        """, env_id, body.get("name"), body.get("description"), body.get("color"), body.get("sortOrder"))
    return _env_row(row)


@router.post("/environments/{env_id}/promote", dependencies=_auth)
async def promote_to_environment(env_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    snapshot_id = body.get("snapshotId") or body.get("snapshot_id")
    if not snapshot_id:
        raise HTTPException(400, "snapshotId is required")
    async with db.acquire() as conn:
        env = await conn.fetchrow("SELECT * FROM content_environments WHERE id=$1", env_id)
        if not env:
            raise HTTPException(404, "Environment not found")
        # Phase 2: check approval rules
        rule = await conn.fetchrow(
            "SELECT * FROM content_approval_rules WHERE environment_id=$1", env_id)
        if rule and rule["required_approvals"] > 0:
            raise HTTPException(409, "This environment requires approval. Use /request-promotion instead.")
        snap = await conn.fetchval("SELECT id FROM content_snapshots WHERE id=$1", snapshot_id)
        if not snap:
            raise HTTPException(404, "Snapshot not found")
        row = await conn.fetchrow("""
            UPDATE content_environments SET
                prior_snapshot_id=active_snapshot_id,
                active_snapshot_id=$2, promoted_at=now(), promoted_by=$3
            WHERE id=$1 RETURNING *
        """, env_id, snapshot_id, body.get("promotedBy", "api"))
        await conn.execute("""
            INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
            VALUES ($1, $2, 'promoted', $3, '{}')
        """, env_id, UUID(snapshot_id) if isinstance(snapshot_id, str) else snapshot_id,
            body.get("promotedBy", "api"))
    return _env_row(row)


@router.get("/environments/{env_id}/history", dependencies=_auth)
async def environment_history(env_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    """Returns current and prior snapshot for the environment."""
    async with db.acquire() as conn:
        env = await conn.fetchrow("SELECT * FROM content_environments WHERE id=$1", env_id)
        if not env:
            raise HTTPException(404, "Environment not found")
        result = _env_row(env)
        snapshots = []
        for sid in [env["active_snapshot_id"], env["prior_snapshot_id"]]:
            if sid:
                s = await conn.fetchrow("SELECT * FROM content_snapshots WHERE id=$1", sid)
                if s:
                    snapshots.append({**_snap_row(s), "status": "active" if sid == env["active_snapshot_id"] else "prior"})
        result["snapshots"] = snapshots
    return result


@router.post("/environments/{env_id}/rollback", dependencies=_auth)
async def rollback_environment(env_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        env = await conn.fetchrow("SELECT * FROM content_environments WHERE id=$1", env_id)
        if not env:
            raise HTTPException(404, "Environment not found")
        if not env["prior_snapshot_id"]:
            raise HTTPException(400, "No prior snapshot to rollback to")
        row = await conn.fetchrow("""
            UPDATE content_environments SET
                active_snapshot_id=prior_snapshot_id, prior_snapshot_id=active_snapshot_id,
                promoted_at=now(), promoted_by='rollback'
            WHERE id=$1 RETURNING *
        """, env_id)
    return _env_row(row)


# ── Promotion Requests ────────────────────────────────────────

def _promo_req_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "environmentId": str(r["environment_id"]),
        "snapshotId": str(r["snapshot_id"]),
        "requestedBy": r["requested_by"],
        "status": r["status"],
        "approvers": json.loads(r["approvers"]) if isinstance(r["approvers"], str) else r["approvers"],
        "approvedBy": r["approved_by"],
        "approvedAt": r["approved_at"].isoformat() if r["approved_at"] else None,
        "rejectedBy": r["rejected_by"],
        "rejectedAt": r["rejected_at"].isoformat() if r["rejected_at"] else None,
        "rejectionReason": r["rejection_reason"],
        "comment": r["comment"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


async def _validate_policies(conn, env_id: UUID, snapshot_id: UUID):
    """Validate snapshot against environment policies. Returns (passed, results)."""
    policies = await conn.fetch("""
        SELECT cp.* FROM content_policies cp
        JOIN content_policy_assignments cpa ON cpa.policy_id = cp.id
        WHERE cpa.environment_id = $1 AND cp.enabled = true
    """, env_id)
    snap = await conn.fetchrow("SELECT * FROM content_snapshots WHERE id=$1", snapshot_id)
    results = []
    all_pass = True
    for p in policies:
        config = json.loads(p["config"]) if isinstance(p["config"], str) else p["config"]
        passed = True
        message = "OK"
        if p["policy_type"] == "minimum_age":
            if snap and snap["created_at"]:
                age_hours = (datetime.now(timezone.utc) - snap["created_at"]).total_seconds() / 3600
                required = config.get("hours", 24)
                if age_hours < required:
                    passed = False
                    message = f"Snapshot is {age_hours:.1f}h old, requires {required}h"
        elif p["policy_type"] == "size_limit":
            if snap and snap["total_size"]:
                max_bytes = config.get("max_bytes", 0)
                if max_bytes and snap["total_size"] > max_bytes:
                    passed = False
                    message = f"Total size {snap['total_size']} exceeds limit {max_bytes}"
        elif p["policy_type"] == "vulnerability_check":
            passed = True
            message = "No vulnerability data available (skipped)"
        elif p["policy_type"] == "required_packages":
            required = config.get("packages", [])
            if required:
                items = await conn.fetch("""
                    SELECT ci.name FROM content_items ci
                    JOIN content_snapshot_items csi ON csi.item_id = ci.id
                    WHERE csi.snapshot_id = $1
                """, snapshot_id)
                names = {i["name"] for i in items}
                missing = [r for r in required if r not in names]
                if missing:
                    passed = False
                    message = f"Missing required packages: {', '.join(missing)}"
        elif p["policy_type"] == "blocked_packages":
            blocked = config.get("packages", [])
            if blocked:
                items = await conn.fetch("""
                    SELECT ci.name FROM content_items ci
                    JOIN content_snapshot_items csi ON csi.item_id = ci.id
                    WHERE csi.snapshot_id = $1
                """, snapshot_id)
                names = {i["name"] for i in items}
                found = [b for b in blocked if b in names]
                if found:
                    passed = False
                    message = f"Blocked packages found: {', '.join(found)}"

        enforcement = p["enforcement"]
        if not passed and enforcement == "enforce":
            all_pass = False
        results.append({
            "policyId": str(p["id"]),
            "name": p["name"],
            "policyType": p["policy_type"],
            "enforcement": enforcement,
            "passed": passed,
            "message": message,
        })
    return all_pass, results


async def _do_promote(conn, env_id: UUID, snapshot_id, actor: str):
    """Execute the actual promotion."""
    sid = UUID(snapshot_id) if isinstance(snapshot_id, str) else snapshot_id
    row = await conn.fetchrow("""
        UPDATE content_environments SET
            prior_snapshot_id=active_snapshot_id,
            active_snapshot_id=$2, promoted_at=now(), promoted_by=$3
        WHERE id=$1 RETURNING *
    """, env_id, sid, actor)
    await conn.execute("""
        INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor)
        VALUES ($1, $2, 'promoted', $3)
    """, env_id, sid, actor)
    return row


@router.post("/environments/{env_id}/request-promotion", dependencies=_auth, status_code=201)
async def request_promotion(env_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    snapshot_id = body.get("snapshotId") or body.get("snapshot_id")
    if not snapshot_id:
        raise HTTPException(400, "snapshotId is required")
    sid = UUID(snapshot_id) if isinstance(snapshot_id, str) else snapshot_id
    async with db.acquire() as conn:
        env = await conn.fetchrow("SELECT * FROM content_environments WHERE id=$1", env_id)
        if not env:
            raise HTTPException(404, "Environment not found")
        if not await conn.fetchval("SELECT 1 FROM content_snapshots WHERE id=$1", sid):
            raise HTTPException(404, "Snapshot not found")
        requester = body.get("requestedBy", "api")
        # Check policies
        policy_pass, policy_results = await _validate_policies(conn, env_id, sid)
        enforced_failures = [r for r in policy_results if not r["passed"] and r["enforcement"] == "enforce"]
        if enforced_failures:
            for f in enforced_failures:
                await conn.execute("""
                    INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                    VALUES ($1, $2, 'policy_violated', $3, $4::jsonb)
                """, env_id, sid, requester, json.dumps(f))
            raise HTTPException(422, {"message": "Policy validation failed", "violations": enforced_failures})
        # Log warnings
        warnings = [r for r in policy_results if not r["passed"] and r["enforcement"] == "warn"]
        for w in warnings:
            await conn.execute("""
                INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                VALUES ($1, $2, 'policy_warning', $3, $4::jsonb)
            """, env_id, sid, requester, json.dumps(w))
        # Check approval rules
        rule = await conn.fetchrow(
            "SELECT * FROM content_approval_rules WHERE environment_id=$1", env_id)
        # Auto-promote if no approval needed
        if not rule or rule["required_approvals"] == 0:
            row = await _do_promote(conn, env_id, sid, requester)
            await conn.execute("""
                INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                VALUES ($1, $2, 'request_created', $3, $4::jsonb)
            """, env_id, sid, requester, json.dumps({"auto_promoted": True}))
            return {"autoPromoted": True, "environment": _env_row(row), "policyResults": policy_results}
        # Check auto_approve_from
        if rule["auto_approve_from"]:
            source_env = await conn.fetchrow(
                "SELECT * FROM content_environments WHERE name=$1", rule["auto_approve_from"])
            if source_env and source_env["active_snapshot_id"] == sid:
                row = await _do_promote(conn, env_id, sid, requester)
                await conn.execute("""
                    INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                    VALUES ($1, $2, 'request_created', $3, $4::jsonb)
                """, env_id, sid, requester,
                    json.dumps({"auto_promoted": True, "auto_approve_from": rule["auto_approve_from"]}))
                return {"autoPromoted": True, "environment": _env_row(row), "policyResults": policy_results}
        # Create pending request
        req = await conn.fetchrow("""
            INSERT INTO content_promotion_requests (environment_id, snapshot_id, requested_by, comment)
            VALUES ($1, $2, $3, $4) RETURNING *
        """, env_id, sid, requester, body.get("comment"))
        await conn.execute("""
            INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
            VALUES ($1, $2, 'request_created', $3, $4::jsonb)
        """, env_id, sid, requester, json.dumps({"request_id": str(req["id"])}))
        return {"autoPromoted": False, "request": _promo_req_row(req), "policyResults": policy_results}


@router.get("/promotion-requests", dependencies=_auth)
async def list_promotion_requests(
    status: Optional[str] = None,
    environment_id: Optional[UUID] = None,
    db: asyncpg.Pool = Depends(get_db),
):
    conditions = []
    params = []
    idx = 1
    if status:
        conditions.append(f"status=${idx}")
        params.append(status)
        idx += 1
    if environment_id:
        conditions.append(f"environment_id=${idx}")
        params.append(environment_id)
        idx += 1
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    async with db.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT * FROM content_promotion_requests{where} ORDER BY created_at DESC", *params)
    return [_promo_req_row(r) for r in rows]


@router.get("/promotion-requests/{req_id}", dependencies=_auth)
async def get_promotion_request(req_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM content_promotion_requests WHERE id=$1", req_id)
    if not row:
        raise HTTPException(404, "Promotion request not found")
    return _promo_req_row(row)


@router.post("/promotion-requests/{req_id}/approve", dependencies=_auth)
async def approve_promotion_request(req_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        req = await conn.fetchrow("SELECT * FROM content_promotion_requests WHERE id=$1", req_id)
        if not req:
            raise HTTPException(404, "Promotion request not found")
        if req["status"] != "pending":
            raise HTTPException(409, f"Request is already {req['status']}")
        approver = body.get("approvedBy", body.get("approved_by", "api"))
        approvers = json.loads(req["approvers"]) if isinstance(req["approvers"], str) else (req["approvers"] or [])
        if approver in approvers:
            raise HTTPException(409, "Already approved by this user")
        approvers.append(approver)
        # Check if enough approvals
        rule = await conn.fetchrow(
            "SELECT * FROM content_approval_rules WHERE environment_id=$1", req["environment_id"])
        required = rule["required_approvals"] if rule else 1
        if len(approvers) >= required:
            # Validate policies before promoting
            policy_pass, policy_results = await _validate_policies(
                conn, req["environment_id"], req["snapshot_id"])
            enforced_failures = [r for r in policy_results if not r["passed"] and r["enforcement"] == "enforce"]
            if enforced_failures:
                for f in enforced_failures:
                    await conn.execute("""
                        INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                        VALUES ($1, $2, 'policy_violated', $3, $4::jsonb)
                    """, req["environment_id"], req["snapshot_id"], approver, json.dumps(f))
                raise HTTPException(422, {"message": "Policy validation failed", "violations": enforced_failures})
            # Promote
            updated = await conn.fetchrow("""
                UPDATE content_promotion_requests SET
                    approvers=$2::jsonb, approved_by=$3, approved_at=now(), status='approved'
                WHERE id=$1 RETURNING *
            """, req_id, json.dumps(approvers), approver)
            await _do_promote(conn, req["environment_id"], req["snapshot_id"], approver)
            await conn.execute("""
                INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                VALUES ($1, $2, 'request_approved', $3, $4::jsonb)
            """, req["environment_id"], req["snapshot_id"], approver,
                json.dumps({"request_id": str(req_id), "final": True}))
            return {**_promo_req_row(updated), "promoted": True}
        else:
            updated = await conn.fetchrow("""
                UPDATE content_promotion_requests SET approvers=$2::jsonb
                WHERE id=$1 RETURNING *
            """, req_id, json.dumps(approvers))
            await conn.execute("""
                INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
                VALUES ($1, $2, 'request_approved', $3, $4::jsonb)
            """, req["environment_id"], req["snapshot_id"], approver,
                json.dumps({"request_id": str(req_id), "final": False,
                            "approvals": len(approvers), "required": required}))
            return {**_promo_req_row(updated), "promoted": False,
                    "approvalsCollected": len(approvers), "approvalsRequired": required}


@router.post("/promotion-requests/{req_id}/reject", dependencies=_auth)
async def reject_promotion_request(req_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        req = await conn.fetchrow("SELECT * FROM content_promotion_requests WHERE id=$1", req_id)
        if not req:
            raise HTTPException(404, "Promotion request not found")
        if req["status"] != "pending":
            raise HTTPException(409, f"Request is already {req['status']}")
        rejector = body.get("rejectedBy", body.get("rejected_by", "api"))
        updated = await conn.fetchrow("""
            UPDATE content_promotion_requests SET
                status='rejected', rejected_by=$2, rejected_at=now(), rejection_reason=$3
            WHERE id=$1 RETURNING *
        """, req_id, rejector, body.get("reason"))
        await conn.execute("""
            INSERT INTO content_promotion_log (environment_id, snapshot_id, action, actor, details)
            VALUES ($1, $2, 'request_rejected', $3, $4::jsonb)
        """, req["environment_id"], req["snapshot_id"], rejector,
            json.dumps({"request_id": str(req_id), "reason": body.get("reason")}))
    return _promo_req_row(updated)


@router.post("/promotion-requests/{req_id}/cancel", dependencies=_auth)
async def cancel_promotion_request(req_id: UUID, body: dict = None, db: asyncpg.Pool = Depends(get_db)):
    body = body or {}
    async with db.acquire() as conn:
        req = await conn.fetchrow("SELECT * FROM content_promotion_requests WHERE id=$1", req_id)
        if not req:
            raise HTTPException(404, "Promotion request not found")
        if req["status"] != "pending":
            raise HTTPException(409, f"Request is already {req['status']}")
        updated = await conn.fetchrow("""
            UPDATE content_promotion_requests SET status='cancelled' WHERE id=$1 RETURNING *
        """, req_id)
    return _promo_req_row(updated)


# ── Approval Rules ────────────────────────────────────────────

def _rule_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "environmentId": str(r["environment_id"]),
        "requiredApprovals": r["required_approvals"],
        "allowedApprovers": json.loads(r["allowed_approvers"]) if isinstance(r["allowed_approvers"], str) else r["allowed_approvers"],
        "autoApproveFrom": r["auto_approve_from"],
        "notifyOnRequest": r["notify_on_request"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


@router.get("/approval-rules", dependencies=_auth)
async def list_approval_rules(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT ar.*, ce.name AS env_name FROM content_approval_rules ar
            JOIN content_environments ce ON ce.id = ar.environment_id
            ORDER BY ce.sort_order
        """)
    return [{**_rule_row(r), "environmentName": r["env_name"]} for r in rows]


@router.put("/approval-rules/{env_id}", dependencies=_auth)
async def upsert_approval_rule(env_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM content_environments WHERE id=$1", env_id):
            raise HTTPException(404, "Environment not found")
        row = await conn.fetchrow("""
            INSERT INTO content_approval_rules (environment_id, required_approvals, allowed_approvers, auto_approve_from, notify_on_request)
            VALUES ($1, $2, $3::jsonb, $4, $5)
            ON CONFLICT (environment_id) DO UPDATE SET
                required_approvals=EXCLUDED.required_approvals,
                allowed_approvers=EXCLUDED.allowed_approvers,
                auto_approve_from=EXCLUDED.auto_approve_from,
                notify_on_request=EXCLUDED.notify_on_request
            RETURNING *
        """, env_id,
            body.get("requiredApprovals", body.get("required_approvals", 1)),
            json.dumps(body.get("allowedApprovers", body.get("allowed_approvers", []))),
            body.get("autoApproveFrom", body.get("auto_approve_from")),
            body.get("notifyOnRequest", body.get("notify_on_request", True)))
    return _rule_row(row)


# ── Content Policies ──────────────────────────────────────────

def _policy_row(r) -> dict:
    return {
        "id": str(r["id"]),
        "name": r["name"],
        "description": r["description"],
        "policyType": r["policy_type"],
        "config": json.loads(r["config"]) if isinstance(r["config"], str) else r["config"],
        "enabled": r["enabled"],
        "enforcement": r["enforcement"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    }


@router.get("/policies", dependencies=_auth)
async def list_policies(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM content_policies ORDER BY name")
        assignments = await conn.fetch("""
            SELECT cpa.policy_id, ce.id AS env_id, ce.name AS env_name
            FROM content_policy_assignments cpa
            JOIN content_environments ce ON ce.id = cpa.environment_id
        """)
    assign_map: dict = {}
    for a in assignments:
        assign_map.setdefault(str(a["policy_id"]), []).append(
            {"id": str(a["env_id"]), "name": a["env_name"]})
    return [{**_policy_row(r), "environments": assign_map.get(str(r["id"]), [])} for r in rows]


@router.post("/policies", dependencies=_auth, status_code=201)
async def create_policy(body: dict, db: asyncpg.Pool = Depends(get_db)):
    name = body.get("name")
    policy_type = body.get("policyType") or body.get("policy_type")
    if not name or not policy_type:
        raise HTTPException(400, "name and policyType are required")
    async with db.acquire() as conn:
        try:
            row = await conn.fetchrow("""
                INSERT INTO content_policies (name, description, policy_type, config, enabled, enforcement)
                VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING *
            """, name, body.get("description"), policy_type,
                json.dumps(body.get("config", {})),
                body.get("enabled", True),
                body.get("enforcement", "enforce"))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, f"Policy '{name}' already exists")
    return _policy_row(row)


@router.put("/policies/{policy_id}", dependencies=_auth)
async def update_policy(policy_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        existing = await conn.fetchrow("SELECT id FROM content_policies WHERE id=$1", policy_id)
        if not existing:
            raise HTTPException(404, "Policy not found")
        row = await conn.fetchrow("""
            UPDATE content_policies SET
                name=COALESCE($2, name), description=COALESCE($3, description),
                policy_type=COALESCE($4, policy_type), config=COALESCE($5::jsonb, config),
                enabled=COALESCE($6, enabled), enforcement=COALESCE($7, enforcement)
            WHERE id=$1 RETURNING *
        """, policy_id, body.get("name"), body.get("description"),
            body.get("policyType") or body.get("policy_type"),
            json.dumps(body["config"]) if "config" in body else None,
            body.get("enabled"), body.get("enforcement"))
    return _policy_row(row)


@router.delete("/policies/{policy_id}", dependencies=_auth)
async def delete_policy(policy_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute("DELETE FROM content_policies WHERE id=$1", policy_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Policy not found")
    return {"ok": True}


@router.post("/policies/{policy_id}/assign", dependencies=_auth)
async def assign_policy(policy_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    env_id = body.get("environmentId") or body.get("environment_id")
    if not env_id:
        raise HTTPException(400, "environmentId is required")
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM content_policies WHERE id=$1", policy_id):
            raise HTTPException(404, "Policy not found")
        if not await conn.fetchval("SELECT 1 FROM content_environments WHERE id=$1", UUID(env_id)):
            raise HTTPException(404, "Environment not found")
        try:
            await conn.execute(
                "INSERT INTO content_policy_assignments (policy_id, environment_id) VALUES ($1, $2)",
                policy_id, UUID(env_id))
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "Policy already assigned to this environment")
    return {"ok": True}


@router.delete("/policies/{policy_id}/unassign/{env_id}", dependencies=_auth)
async def unassign_policy(policy_id: UUID, env_id: UUID, db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM content_policy_assignments WHERE policy_id=$1 AND environment_id=$2",
            policy_id, env_id)
        if result == "DELETE 0":
            raise HTTPException(404, "Assignment not found")
    return {"ok": True}


@router.post("/environments/{env_id}/validate", dependencies=_auth)
async def validate_snapshot_policies(env_id: UUID, body: dict, db: asyncpg.Pool = Depends(get_db)):
    snapshot_id = body.get("snapshotId") or body.get("snapshot_id")
    if not snapshot_id:
        raise HTTPException(400, "snapshotId is required")
    sid = UUID(snapshot_id) if isinstance(snapshot_id, str) else snapshot_id
    async with db.acquire() as conn:
        if not await conn.fetchval("SELECT 1 FROM content_environments WHERE id=$1", env_id):
            raise HTTPException(404, "Environment not found")
        if not await conn.fetchval("SELECT 1 FROM content_snapshots WHERE id=$1", sid):
            raise HTTPException(404, "Snapshot not found")
        passed, results = await _validate_policies(conn, env_id, sid)
    return {"passed": passed, "results": results}


# ── Promotion Log ─────────────────────────────────────────────

@router.get("/promotion-log", dependencies=_auth)
async def list_promotion_log(
    environment_id: Optional[UUID] = None,
    action: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    db: asyncpg.Pool = Depends(get_db),
):
    conditions = []
    params: list = []
    idx = 1
    if environment_id:
        conditions.append(f"environment_id=${idx}")
        params.append(environment_id)
        idx += 1
    if action:
        conditions.append(f"action=${idx}")
        params.append(action)
        idx += 1
    if since:
        conditions.append(f"created_at >= ${idx}::timestamptz")
        params.append(since)
        idx += 1
    if until:
        conditions.append(f"created_at <= ${idx}::timestamptz")
        params.append(until)
        idx += 1
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    async with db.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT * FROM content_promotion_log{where} ORDER BY created_at DESC LIMIT ${idx}",
            *params, limit)
    return [{
        "id": str(r["id"]),
        "environmentId": str(r["environment_id"]),
        "snapshotId": str(r["snapshot_id"]),
        "action": r["action"],
        "actor": r["actor"],
        "details": json.loads(r["details"]) if isinstance(r["details"], str) else r["details"],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]


# ── Dashboard ─────────────────────────────────────────────────

@router.get("/dashboard", dependencies=_auth)
async def content_dashboard(db: asyncpg.Pool = Depends(get_db)):
    async with db.acquire() as conn:
        repo_count = await conn.fetchval("SELECT COUNT(*) FROM content_repositories")
        item_count = await conn.fetchval("SELECT COUNT(*) FROM content_items")
        snapshot_count = await conn.fetchval("SELECT COUNT(*) FROM content_snapshots")
        envs = await conn.fetch("""
            SELECT e.name, e.color, e.sort_order, s.name AS snapshot_name, e.promoted_at, e.promoted_by
            FROM content_environments e
            LEFT JOIN content_snapshots s ON s.id = e.active_snapshot_id
            ORDER BY e.sort_order
        """)
    return {
        "repositoryCount": repo_count,
        "itemCount": item_count,
        "snapshotCount": snapshot_count,
        "environments": [{
            "name": e["name"],
            "color": e["color"],
            "sortOrder": e["sort_order"],
            "activeSnapshot": e["snapshot_name"],
            "promotedAt": e["promoted_at"].isoformat() if e["promoted_at"] else None,
            "promotedBy": e["promoted_by"],
        } for e in envs],
    }
