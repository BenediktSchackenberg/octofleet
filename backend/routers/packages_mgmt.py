"""
Octofleet API - Packages Routes
"""
from fastapi import APIRouter, Body, Depends, File, HTTPException, Header, Request, UploadFile
from dependencies import get_pool, get_db, verify_api_key
import os
MAX_REPO_FILE_SIZE = int(os.environ.get("OCTOFLEET_MAX_FILE_SIZE", 5 * 1024 * 1024 * 1024))
import asyncpg
from typing import Optional, Dict, List, Any
from fastapi.responses import FileResponse
import uuid
import json
import aiohttp
import os

router = APIRouter(tags=["Packages"])


@router.get("/api/v1/packages", dependencies=[Depends(verify_api_key)])
async def list_packages(category: str = None, active_only: bool = True, db: asyncpg.Pool = Depends(get_db)):
    """List all packages"""
    async with db.acquire() as conn:
        query = """
            SELECT p.id, p.name, p.display_name, p.vendor, p.description, p.category,
                   p.os_type, p.architecture, p.icon_url, p.tags, p.is_active, p.created_at,
                   (SELECT COUNT(*) FROM package_versions pv WHERE pv.package_id = p.id) as version_count,
                   (SELECT pv.version FROM package_versions pv WHERE pv.package_id = p.id AND pv.is_latest = true LIMIT 1) as latest_version
            FROM packages p
            WHERE 1=1
        """
        params = []
        param_idx = 1
        
        if active_only:
            query += " AND p.is_active = true"
        
        if category:
            query += f" AND p.category = ${param_idx}"
            params.append(category)
            param_idx += 1
        
        query += " ORDER BY p.display_name ASC"
        
        rows = await conn.fetch(query, *params)
        
        packages = []
        for row in rows:
            packages.append({
                "id": str(row["id"]),
                "name": row["name"],
                "displayName": row["display_name"],
                "vendor": row["vendor"],
                "description": row["description"],
                "category": row["category"],
                "osType": row["os_type"],
                "architecture": row["architecture"],
                "iconUrl": row["icon_url"],
                "tags": row["tags"] or [],
                "isActive": row["is_active"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
                "versionCount": row["version_count"],
                "latestVersion": row["latest_version"]
            })
        
        return {"packages": packages, "count": len(packages)}


@router.post("/api/v1/packages", dependencies=[Depends(verify_api_key)])
async def create_package(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new package"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO packages (name, display_name, vendor, description, category,
                                  os_type, os_min_version, architecture, homepage_url, 
                                  icon_url, tags, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        """,
            data.get("name"),
            data.get("displayName", data.get("name")),
            data.get("vendor"),
            data.get("description"),
            data.get("category"),
            data.get("osType", "windows"),
            data.get("osMinVersion"),
            data.get("architecture", "any"),
            data.get("homepageUrl"),
            data.get("iconUrl"),
            data.get("tags", []),
            data.get("createdBy", "api")
        )
        return {"id": str(row["id"]), "status": "created"}


@router.get("/api/v1/packages/{package_id}", dependencies=[Depends(verify_api_key)])
async def get_package(package_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get package details with versions"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, name, display_name, vendor, description, category,
                   os_type, os_min_version, architecture, homepage_url, icon_url, 
                   tags, is_active, created_by, created_at, updated_at
            FROM packages WHERE id = $1
        """, package_id)
        
        if not row:
            raise not_found("Package", package_id if "package_id" in dir() else str(id))
        
        package = {
            "id": str(row["id"]),
            "name": row["name"],
            "displayName": row["display_name"],
            "vendor": row["vendor"],
            "description": row["description"],
            "category": row["category"],
            "osType": row["os_type"],
            "osMinVersion": row["os_min_version"],
            "architecture": row["architecture"],
            "homepageUrl": row["homepage_url"],
            "iconUrl": row["icon_url"],
            "tags": row["tags"] or [],
            "isActive": row["is_active"],
            "createdBy": row["created_by"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None
        }
        
        # Get versions
        versions = await conn.fetch("""
            SELECT id, version, filename, file_size, sha256_hash,
                   install_command, install_args, uninstall_command, uninstall_args,
                   requires_reboot, requires_admin, silent_install,
                   is_latest, is_active, release_date, release_notes, created_at
            FROM package_versions 
            WHERE package_id = $1
            ORDER BY created_at DESC
        """, package_id)
        
        package["versions"] = [{
            "id": str(v["id"]),
            "version": v["version"],
            "filename": v["filename"],
            "fileSize": v["file_size"],
            "sha256Hash": v["sha256_hash"],
            "installCommand": v["install_command"],
            "installArgs": v["install_args"],
            "uninstallCommand": v["uninstall_command"],
            "uninstallArgs": v["uninstall_args"],
            "requiresReboot": v["requires_reboot"],
            "requiresAdmin": v["requires_admin"],
            "silentInstall": v["silent_install"],
            "isLatest": v["is_latest"],
            "isActive": v["is_active"],
            "releaseDate": v["release_date"].isoformat() if v["release_date"] else None,
            "releaseNotes": v["release_notes"],
            "createdAt": v["created_at"].isoformat() if v["created_at"] else None
        } for v in versions]
        
        return package


@router.put("/api/v1/packages/{package_id}", dependencies=[Depends(verify_api_key)])
async def update_package(package_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update package details"""
    async with db.acquire() as conn:
        await conn.execute("""
            UPDATE packages SET
                display_name = COALESCE($2, display_name),
                vendor = COALESCE($3, vendor),
                description = COALESCE($4, description),
                category = COALESCE($5, category),
                os_type = COALESCE($6, os_type),
                architecture = COALESCE($7, architecture),
                homepage_url = COALESCE($8, homepage_url),
                icon_url = COALESCE($9, icon_url),
                tags = COALESCE($10, tags),
                is_active = COALESCE($11, is_active),
                updated_at = NOW()
            WHERE id = $1
        """,
            package_id,
            data.get("displayName"),
            data.get("vendor"),
            data.get("description"),
            data.get("category"),
            data.get("osType"),
            data.get("architecture"),
            data.get("homepageUrl"),
            data.get("iconUrl"),
            data.get("tags"),
            data.get("isActive")
        )
        return {"status": "updated"}


@router.delete("/api/v1/packages/{package_id}", dependencies=[Depends(verify_api_key)])
async def delete_package(package_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package (cascades to versions)"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM packages WHERE id = $1 RETURNING name", package_id)
        if not row:
            raise not_found("Package", package_id if "package_id" in dir() else str(id))
        return {"status": "deleted", "name": row["name"]}


@router.post("/api/v1/packages/{package_id}/versions", dependencies=[Depends(verify_api_key)])
async def create_package_version(package_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a new version for a package"""
    async with db.acquire() as conn:
        # If this is marked as latest, unset other latest
        if data.get("isLatest", False):
            await conn.execute("""
                UPDATE package_versions SET is_latest = false WHERE package_id = $1
            """, package_id)
        
        row = await conn.fetchrow("""
            INSERT INTO package_versions (
                package_id, version, filename, file_size, sha256_hash,
                install_command, install_args, uninstall_command, uninstall_args,
                requires_reboot, requires_admin, silent_install,
                is_latest, is_active, release_date, release_notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING id
        """,
            package_id,
            data.get("version"),
            data.get("filename"),
            data.get("fileSize"),
            data.get("sha256Hash"),
            data.get("installCommand"),
            json.dumps(data.get("installArgs")) if data.get("installArgs") else None,
            data.get("uninstallCommand"),
            json.dumps(data.get("uninstallArgs")) if data.get("uninstallArgs") else None,
            data.get("requiresReboot", False),
            data.get("requiresAdmin", True),
            data.get("silentInstall", True),
            data.get("isLatest", True),
            data.get("isActive", True),
            data.get("releaseDate"),
            data.get("releaseNotes")
        )
        return {"id": str(row["id"]), "status": "created"}


@router.get("/api/v1/packages/{package_id}/versions/{version_id}", dependencies=[Depends(verify_api_key)])
async def get_package_version(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get a specific version with detection rules"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, version, filename, file_size, sha256_hash,
                   install_command, install_args, uninstall_command, uninstall_args,
                   requires_reboot, requires_admin, silent_install,
                   is_latest, is_active, release_date, release_notes, created_at
            FROM package_versions 
            WHERE id = $1 AND package_id = $2
        """, version_id, package_id)
        
        if not row:
            raise not_found("Version", version_id)
        
        version = {
            "id": str(row["id"]),
            "version": row["version"],
            "filename": row["filename"],
            "fileSize": row["file_size"],
            "sha256Hash": row["sha256_hash"],
            "installCommand": row["install_command"],
            "installArgs": row["install_args"],
            "uninstallCommand": row["uninstall_command"],
            "uninstallArgs": row["uninstall_args"],
            "requiresReboot": row["requires_reboot"],
            "requiresAdmin": row["requires_admin"],
            "silentInstall": row["silent_install"],
            "isLatest": row["is_latest"],
            "isActive": row["is_active"],
            "releaseDate": row["release_date"].isoformat() if row["release_date"] else None,
            "releaseNotes": row["release_notes"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        }
        
        # Get detection rules
        rules = await conn.fetch("""
            SELECT id, rule_order, rule_type, config, operator
            FROM detection_rules 
            WHERE package_version_id = $1
            ORDER BY rule_order ASC
        """, version_id)
        
        version["detectionRules"] = [{
            "id": str(r["id"]),
            "order": r["rule_order"],
            "type": r["rule_type"],
            "config": r["config"],
            "operator": r["operator"]
        } for r in rules]
        
        # Get sources
        sources = await conn.fetch("""
            SELECT pvs.id, ps.id as source_id, ps.name, ps.source_type, ps.base_url,
                   pvs.relative_path, pvs.priority
            FROM package_version_sources pvs
            JOIN package_sources ps ON ps.id = pvs.source_id
            WHERE pvs.package_version_id = $1
            ORDER BY pvs.priority ASC
        """, version_id)
        
        version["sources"] = [{
            "id": str(s["id"]),
            "sourceId": str(s["source_id"]),
            "sourceName": s["name"],
            "sourceType": s["source_type"],
            "baseUrl": s["base_url"],
            "relativePath": s["relative_path"],
            "priority": s["priority"]
        } for s in sources]
        
        return version


@router.put("/api/v1/packages/{package_id}/versions/{version_id}", dependencies=[Depends(verify_api_key)])
async def update_package_version(package_id: str, version_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Update a package version"""
    async with db.acquire() as conn:
        # Build dynamic UPDATE query
        updates = []
        params = []
        param_idx = 1
        
        field_mapping = {
            "installCommand": "install_command",
            "installArgs": "install_args",
            "uninstallCommand": "uninstall_command",
            "uninstallArgs": "uninstall_args",
            "requiresReboot": "requires_reboot",
            "requiresAdmin": "requires_admin",
            "silentInstall": "silent_install",
            "isLatest": "is_latest",
            "isActive": "is_active",
            "releaseNotes": "release_notes",
            "sha256Hash": "sha256_hash",
        }
        
        for json_key, db_col in field_mapping.items():
            if json_key in data:
                updates.append(f"{db_col} = ${param_idx}")
                params.append(data[json_key])
                param_idx += 1
        
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        params.append(version_id)
        params.append(package_id)
        
        query = f"""
            UPDATE package_versions 
            SET {", ".join(updates)}, updated_at = NOW()
            WHERE id = ${param_idx} AND package_id = ${param_idx + 1}
            RETURNING version
        """
        
        row = await conn.fetchrow(query, *params)
        
        if not row:
            raise not_found("Version", version_id)
        
        return {"status": "updated", "version": row["version"]}


@router.delete("/api/v1/packages/{package_id}/versions/{version_id}", dependencies=[Depends(verify_api_key)])
async def delete_package_version(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package version"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            DELETE FROM package_versions 
            WHERE id = $1 AND package_id = $2
            RETURNING version
        """, version_id, package_id)
        
        if not row:
            raise not_found("Version", version_id)
        return {"status": "deleted", "version": row["version"]}


@router.post("/api/v1/packages/{package_id}/versions/{version_id}/rules", dependencies=[Depends(verify_api_key)])
async def create_detection_rule(package_id: str, version_id: str, data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a detection rule for a version"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO detection_rules (package_version_id, rule_order, rule_type, config, operator)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        """,
            version_id,
            data.get("order", 1),
            data.get("type"),
            json.dumps(data.get("config", {})),
            data.get("operator", "AND")
        )
        return {"id": str(row["id"]), "status": "created"}


@router.get("/api/v1/package-sources")
async def list_package_sources(db: asyncpg.Pool = Depends(get_db)):
    """List all package sources"""
    async with db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, name, description, source_type, base_url, auth_config,
                   is_active, priority, created_at
            FROM package_sources
            ORDER BY priority ASC, name ASC
        """)
        
        sources = [{
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "sourceType": row["source_type"],
            "baseUrl": row["base_url"],
            "hasAuth": row["auth_config"] is not None,
            "isActive": row["is_active"],
            "priority": row["priority"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None
        } for row in rows]
        
        return {"sources": sources, "count": len(sources)}


@router.post("/api/v1/package-sources")
async def create_package_source(data: Dict[str, Any], db: asyncpg.Pool = Depends(get_db)):
    """Create a package source (SMB share, HTTP, etc.)"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO package_sources (name, description, source_type, base_url, auth_config, priority)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        """,
            data.get("name"),
            data.get("description"),
            data.get("sourceType", "http"),
            data.get("baseUrl"),
            json.dumps(data.get("authConfig")) if data.get("authConfig") else None,
            data.get("priority", 10)
        )
        return {"id": str(row["id"]), "status": "created"}


@router.delete("/api/v1/package-sources/{source_id}")
async def delete_package_source(source_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a package source"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("DELETE FROM package_sources WHERE id = $1 RETURNING name", source_id)
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")
        return {"status": "deleted", "name": row["name"]}


@router.get("/api/v1/packages/{package_id}/versions/{version_id}/detect", dependencies=[Depends(verify_api_key)])
async def get_detection_info(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get detection info for agent to check if package is installed"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT pv.version, p.name, p.display_name
            FROM package_versions pv
            JOIN packages p ON p.id = pv.package_id
            WHERE pv.id = $1 AND pv.package_id = $2
        """, version_id, package_id)
        
        if not row:
            raise not_found("Version", version_id)
        
        rules = await conn.fetch("""
            SELECT rule_type, config, operator, rule_order
            FROM detection_rules 
            WHERE package_version_id = $1
            ORDER BY rule_order ASC
        """, version_id)
        
        return {
            "version": row["version"],
            "packageName": row["name"],
            "displayName": row["display_name"],
            "rules": [{
                "type": r["rule_type"],
                "config": r["config"],
                "operator": r["operator"],
                "order": r["rule_order"]
            } for r in rules]
        }


@router.get("/api/v1/packages/{package_id}/versions/{version_id}/download-info", dependencies=[Depends(verify_api_key)])
async def get_download_info(package_id: str, version_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get download URLs for agent"""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT filename, sha256_hash, file_size,
                   install_command, install_args, 
                   uninstall_command, uninstall_args,
                   requires_reboot, requires_admin, silent_install
            FROM package_versions
            WHERE id = $1 AND package_id = $2
        """, version_id, package_id)
        
        if not row:
            raise not_found("Version", version_id)
        
        sources = await conn.fetch("""
            SELECT ps.source_type, ps.base_url, pvs.relative_path, pvs.priority
            FROM package_version_sources pvs
            JOIN package_sources ps ON ps.id = pvs.source_id
            WHERE pvs.package_version_id = $1 AND ps.is_active = true
            ORDER BY pvs.priority ASC
        """, version_id)
        
        source_list = []
        for s in sources:
            base_url = s["base_url"].rstrip('/')
            rel_path = s["relative_path"].lstrip('/') if s["relative_path"] else row["filename"]
            source_list.append({
                "type": s["source_type"],
                "url": f"{base_url}/{rel_path}",
                "priority": s["priority"]
            })
        
        return {
            "filename": row["filename"],
            "sha256Hash": row["sha256_hash"],
            "fileSize": row["file_size"],
            "installCommand": row["install_command"],
            "installArgs": row["install_args"],
            "uninstallCommand": row["uninstall_command"],
            "uninstallArgs": row["uninstall_args"],
            "requiresReboot": row["requires_reboot"],
            "requiresAdmin": row["requires_admin"],
            "silentInstall": row["silent_install"],
            "sources": source_list
        }


@router.get("/api/v1/package-versions", dependencies=[Depends(verify_api_key)])
async def list_package_versions(limit: int = 100):
    """List package versions for deployment creation"""
    async with get_pool().acquire() as conn:
        rows = await conn.fetch("""
            SELECT pv.id, pv.version, p.id as package_id, p.name as package_name, p.display_name
            FROM package_versions pv
            JOIN packages p ON pv.package_id = p.id
            WHERE pv.is_active = true
            ORDER BY p.name, pv.version DESC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]


@router.post("/api/v1/repo/upload", dependencies=[Depends(verify_api_key)])
async def repo_upload_file(
    request: Request,
    db: asyncpg.Pool = Depends(get_db)
):
    """Upload a file to the repository. Use multipart/form-data with 'file' field."""
    from fastapi import UploadFile
    
    form = await request.form()
    file = form.get("file")
    if not file or not hasattr(file, 'filename'):
        raise HTTPException(400, "No file uploaded. Use multipart/form-data with 'file' field.")
    
    display_name = form.get("display_name", file.filename)
    version = form.get("version")
    category = form.get("category")
    file_type = form.get("file_type") or detect_repo_file_type(file.filename)
    
    file_id = str(uuid.uuid4())
    safe_filename = f"{file_id}_{file.filename}"
    storage_path = get_repo_storage_path(file_type, safe_filename)
    os.makedirs(os.path.dirname(storage_path), exist_ok=True)
    
    file_size = 0
    try:
        async with aiofiles.open(storage_path, 'wb') as out_file:
            while chunk := await file.read(1024 * 1024):
                file_size += len(chunk)
                if file_size > MAX_REPO_FILE_SIZE:
                    raise HTTPException(413, "File too large")
                await out_file.write(chunk)
    except Exception as e:
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(500, f"Upload failed: {str(e)}")
    
    sha256_hash = await compute_file_sha256(storage_path)
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO repo_files (id, filename, display_name, version, file_type, category, sha256_hash, file_size, storage_path, created_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, 'api')
        """, file_id, file.filename, display_name, version, file_type, category, sha256_hash, file_size, storage_path)
    
    return {"id": file_id, "filename": file.filename, "sha256": sha256_hash, "size": file_size, "downloadUrl": f"/api/v1/repo/download/{file_id}"}


@router.get("/api/v1/repo/files", dependencies=[Depends(verify_api_key)])
async def repo_list_files(
    category: Optional[str] = None,
    file_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    db: asyncpg.Pool = Depends(get_db)
):
    """List files in the repository."""
    async with db.acquire() as conn:
        query = "SELECT id, filename, display_name, version, file_type, category, sha256_hash, file_size, source_url, download_count, created_at FROM repo_files WHERE 1=1"
        params = []
        idx = 1
        if category:
            query += f" AND category = ${idx}"; params.append(category); idx += 1
        if file_type:
            query += f" AND file_type = ${idx}"; params.append(file_type); idx += 1
        if search:
            query += f" AND (filename ILIKE ${idx} OR display_name ILIKE ${idx})"; params.append(f"%{search}%"); idx += 1
        query += f" ORDER BY created_at DESC LIMIT ${idx}"; params.append(limit)
        
        rows = await conn.fetch(query, *params)
    
    return {"files": [{"id": str(r["id"]), "filename": r["filename"], "displayName": r["display_name"], "version": r["version"], "type": r["file_type"], "category": r["category"], "sha256": r["sha256_hash"], "size": r["file_size"], "downloads": r["download_count"], "downloadUrl": f"/api/v1/repo/download/{r['id']}"} for r in rows]}


@router.get("/api/v1/repo/files/{file_id}", dependencies=[Depends(verify_api_key)])
async def repo_get_file(file_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Get file metadata."""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM repo_files WHERE id = $1::uuid", file_id)
    if not row:
        raise HTTPException(404, "File not found")
    return {"id": str(row["id"]), "filename": row["filename"], "displayName": row["display_name"], "version": row["version"], "type": row["file_type"], "category": row["category"], "sha256": row["sha256_hash"], "size": row["file_size"], "storagePath": row["storage_path"], "sourceUrl": row["source_url"], "downloads": row["download_count"], "downloadUrl": f"/api/v1/repo/download/{row['id']}"}


@router.get("/api/v1/repo/download/{file_id}")
async def repo_download_file(file_id: str, node_id: Optional[str] = None, db: asyncpg.Pool = Depends(get_db)):
    """Download a file. No auth required for agents."""
    from fastapi.responses import FileResponse
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT filename, storage_path, file_size FROM repo_files WHERE id = $1::uuid", file_id)
        if not row:
            raise HTTPException(404, "File not found")
        if not os.path.exists(row["storage_path"]):
            raise HTTPException(404, "File not found on disk")
        await conn.execute("UPDATE repo_files SET download_count = download_count + 1 WHERE id = $1::uuid", file_id)
        if node_id:
            await conn.execute("INSERT INTO repo_downloads (file_id, node_id, bytes_transferred, success) VALUES ($1::uuid, $2, $3, true)", file_id, node_id, row["file_size"])
    return FileResponse(path=row["storage_path"], filename=row["filename"], media_type="application/octet-stream")


@router.delete("/api/v1/repo/files/{file_id}", dependencies=[Depends(verify_api_key)])
async def repo_delete_file(file_id: str, db: asyncpg.Pool = Depends(get_db)):
    """Delete a file from the repository."""
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT storage_path FROM repo_files WHERE id = $1::uuid", file_id)
        if not row:
            raise HTTPException(404, "File not found")
        if row["storage_path"] and os.path.exists(row["storage_path"]):
            os.remove(row["storage_path"])
        await conn.execute("DELETE FROM repo_files WHERE id = $1::uuid", file_id)
    return {"status": "deleted", "id": file_id}


@router.post("/api/v1/repo/cache", dependencies=[Depends(verify_api_key)])
async def repo_cache_remote_file(
    data: Dict[str, Any] = Body(...),
    db: asyncpg.Pool = Depends(get_db)
):
    """Cache a remote file locally. Body: {url, display_name?, version?, category?, file_type?, expected_hash?}"""
    import aiohttp
    
    url = data.get("url")
    if not url:
        raise HTTPException(400, "url required")
    
    filename = url.rsplit('/', 1)[-1].split('?')[0] or f"cached_{uuid.uuid4().hex[:8]}"
    file_type = data.get("file_type") or detect_repo_file_type(filename)
    file_id = str(uuid.uuid4())
    storage_path = get_repo_storage_path(file_type, f"{file_id}_{filename}")
    os.makedirs(os.path.dirname(storage_path), exist_ok=True)
    
    file_size = 0
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise HTTPException(400, f"Download failed: HTTP {response.status}")
                async with aiofiles.open(storage_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        file_size += len(chunk)
                        if file_size > MAX_REPO_FILE_SIZE:
                            raise HTTPException(413, "File too large")
                        await f.write(chunk)
    except aiohttp.ClientError as e:
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(400, f"Download failed: {str(e)}")
    
    sha256_hash = await compute_file_sha256(storage_path)
    if data.get("expected_hash") and sha256_hash.lower() != data["expected_hash"].lower():
        os.remove(storage_path)
        raise HTTPException(400, f"Hash mismatch! Expected: {data['expected_hash']}, Got: {sha256_hash}")
    
    async with db.acquire() as conn:
        await conn.execute("""
            INSERT INTO repo_files (id, filename, display_name, version, file_type, category, sha256_hash, file_size, storage_path, source_url, is_cached, cached_at, created_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), 'cache')
        """, file_id, filename, data.get("display_name", filename), data.get("version"), file_type, data.get("category"), sha256_hash, file_size, storage_path, url)
    
    return {"id": file_id, "filename": filename, "sha256": sha256_hash, "size": file_size, "cached": True, "downloadUrl": f"/api/v1/repo/download/{file_id}"}


@router.get("/api/v1/repo/stats", dependencies=[Depends(verify_api_key)])
async def repo_get_stats(db: asyncpg.Pool = Depends(get_db)):
    """Get repository statistics."""
    async with db.acquire() as conn:
        stats = await conn.fetchrow("SELECT COUNT(*) as total_files, COALESCE(SUM(file_size), 0) as total_size, COALESCE(SUM(download_count), 0) as total_downloads FROM repo_files")
        by_type = await conn.fetch("SELECT file_type, COUNT(*) as count, COALESCE(SUM(file_size), 0) as size FROM repo_files GROUP BY file_type")
    
    total_gb = stats["total_size"] / 1024 / 1024 / 1024
    return {
        "totalFiles": stats["total_files"],
        "totalSize": stats["total_size"],
        "totalSizeFormatted": f"{total_gb:.2f} GB" if total_gb >= 1 else f"{stats['total_size'] / 1024 / 1024:.2f} MB",
        "totalDownloads": stats["total_downloads"],
        "byType": [{"type": r["file_type"], "count": r["count"], "size": r["size"]} for r in by_type]
    }
