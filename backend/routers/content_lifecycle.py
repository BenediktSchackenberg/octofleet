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
        snap = await conn.fetchval("SELECT id FROM content_snapshots WHERE id=$1", snapshot_id)
        if not snap:
            raise HTTPException(404, "Snapshot not found")
        row = await conn.fetchrow("""
            UPDATE content_environments SET
                prior_snapshot_id=active_snapshot_id,
                active_snapshot_id=$2, promoted_at=now(), promoted_by=$3
            WHERE id=$1 RETURNING *
        """, env_id, snapshot_id, body.get("promotedBy", "api"))
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
