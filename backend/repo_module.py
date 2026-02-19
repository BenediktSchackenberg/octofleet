"""
Software Repository Module
Handles file storage, upload, download, and caching for the Octofleet package repository.
"""
import os
import hashlib
import aiofiles
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from typing import Optional, List
import uuid
import json
from datetime import datetime

# Configuration
REPO_BASE_PATH = os.environ.get("OCTOFLEET_REPO_PATH", os.path.expanduser("~/.openclaw/repo"))
MAX_FILE_SIZE = int(os.environ.get("OCTOFLEET_MAX_FILE_SIZE", 5 * 1024 * 1024 * 1024))  # 5GB default

router = APIRouter(prefix="/api/v1/repo", tags=["Repository"])


def get_storage_path(file_type: str, filename: str) -> str:
    """Get the full storage path for a file based on its type."""
    type_dirs = {
        'msi': 'msi',
        'exe': 'exe',
        'sql-cu': 'sql-cu',
        'script': 'scripts',
        'ps1': 'scripts',
        'zip': 'other',
        'cab': 'other',
        'msix': 'other',
        'appx': 'other',
        'other': 'other'
    }
    subdir = type_dirs.get(file_type, 'other')
    return os.path.join(REPO_BASE_PATH, subdir, filename)


def detect_file_type(filename: str) -> str:
    """Detect file type from extension."""
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    type_map = {
        'msi': 'msi',
        'exe': 'exe',
        'zip': 'zip',
        'ps1': 'ps1',
        'cab': 'cab',
        'msix': 'msix',
        'appx': 'appx'
    }
    return type_map.get(ext, 'other')


async def compute_sha256(filepath: str) -> str:
    """Compute SHA256 hash of a file."""
    sha256_hash = hashlib.sha256()
    async with aiofiles.open(filepath, 'rb') as f:
        while chunk := await f.read(8192):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()


# =============================================================================
# Upload Endpoint
# =============================================================================
@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    display_name: Optional[str] = Form(None),
    version: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    file_type: Optional[str] = Form(None),
    metadata: Optional[str] = Form("{}"),
    db: asyncpg.Pool = None
):
    """
    Upload a file to the repository.
    Returns file ID and download URL.
    """
    if not file.filename:
        raise HTTPException(400, "Filename required")
    
    # Detect type if not provided
    detected_type = file_type or detect_file_type(file.filename)
    
    # Generate unique filename to avoid collisions
    file_id = str(uuid.uuid4())
    safe_filename = f"{file_id}_{file.filename}"
    storage_path = get_storage_path(detected_type, safe_filename)
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(storage_path), exist_ok=True)
    
    # Stream file to disk
    file_size = 0
    try:
        async with aiofiles.open(storage_path, 'wb') as out_file:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    await out_file.close()
                    os.remove(storage_path)
                    raise HTTPException(413, f"File too large. Max size: {MAX_FILE_SIZE / 1024 / 1024 / 1024:.1f}GB")
                await out_file.write(chunk)
    except Exception as e:
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(500, f"Upload failed: {str(e)}")
    
    # Compute hash
    sha256_hash = await compute_sha256(storage_path)
    
    # Parse metadata
    try:
        meta_dict = json.loads(metadata) if metadata else {}
    except:
        meta_dict = {}
    
    # Insert into database
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO repo_files (
                id, filename, display_name, version, file_type, category,
                sha256_hash, file_size, storage_path, metadata, created_by
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'api'
            ) RETURNING id, filename, sha256_hash, file_size
        """, file_id, file.filename, display_name or file.filename, version,
            detected_type, category, sha256_hash, file_size, storage_path,
            json.dumps(meta_dict))
    
    return {
        "id": str(row["id"]),
        "filename": row["filename"],
        "sha256": row["sha256_hash"],
        "size": row["file_size"],
        "downloadUrl": f"/api/v1/repo/download/{file_id}"
    }


# =============================================================================
# List Files
# =============================================================================
@router.get("/files")
async def list_files(
    category: Optional[str] = None,
    file_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: asyncpg.Pool = None
):
    """List files in the repository with optional filters."""
    async with db.acquire() as conn:
        query = """
            SELECT id, filename, display_name, version, file_type, category,
                   sha256_hash, file_size, source_url, download_count, created_at
            FROM repo_files
            WHERE 1=1
        """
        params = []
        param_idx = 1
        
        if category:
            query += f" AND category = ${param_idx}"
            params.append(category)
            param_idx += 1
        
        if file_type:
            query += f" AND file_type = ${param_idx}"
            params.append(file_type)
            param_idx += 1
        
        if search:
            query += f" AND (filename ILIKE ${param_idx} OR display_name ILIKE ${param_idx})"
            params.append(f"%{search}%")
            param_idx += 1
        
        query += f" ORDER BY created_at DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
        params.extend([limit, offset])
        
        rows = await conn.fetch(query, *params)
        
        # Get total count
        count_query = "SELECT COUNT(*) FROM repo_files WHERE 1=1"
        if category:
            count_query += " AND category = $1"
        total = await conn.fetchval(count_query, category) if category else await conn.fetchval("SELECT COUNT(*) FROM repo_files")
    
    return {
        "files": [
            {
                "id": str(r["id"]),
                "filename": r["filename"],
                "displayName": r["display_name"],
                "version": r["version"],
                "type": r["file_type"],
                "category": r["category"],
                "sha256": r["sha256_hash"],
                "size": r["file_size"],
                "sourceUrl": r["source_url"],
                "downloads": r["download_count"],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "downloadUrl": f"/api/v1/repo/download/{r['id']}"
            }
            for r in rows
        ],
        "total": total,
        "limit": limit,
        "offset": offset
    }


# =============================================================================
# Get File Metadata
# =============================================================================
@router.get("/files/{file_id}")
async def get_file(file_id: str, db: asyncpg.Pool = None):
    """Get metadata for a specific file."""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM repo_files WHERE id = $1::uuid
        """, file_id)
    
    if not row:
        raise HTTPException(404, "File not found")
    
    return {
        "id": str(row["id"]),
        "filename": row["filename"],
        "displayName": row["display_name"],
        "version": row["version"],
        "type": row["file_type"],
        "category": row["category"],
        "sha256": row["sha256_hash"],
        "size": row["file_size"],
        "storagePath": row["storage_path"],
        "sourceUrl": row["source_url"],
        "metadata": row["metadata"],
        "downloads": row["download_count"],
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
        "downloadUrl": f"/api/v1/repo/download/{row['id']}"
    }


# =============================================================================
# Download File
# =============================================================================
@router.get("/download/{file_id}")
async def download_file(
    file_id: str,
    node_id: Optional[str] = None,
    db: asyncpg.Pool = None
):
    """
    Download a file from the repository.
    Streams the file and tracks download statistics.
    """
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT filename, storage_path, file_size FROM repo_files WHERE id = $1::uuid
        """, file_id)
        
        if not row:
            raise HTTPException(404, "File not found")
        
        storage_path = row["storage_path"]
        if not os.path.exists(storage_path):
            raise HTTPException(404, "File not found on disk")
        
        # Update download count
        await conn.execute("""
            UPDATE repo_files SET download_count = download_count + 1, updated_at = NOW()
            WHERE id = $1::uuid
        """, file_id)
        
        # Log download
        await conn.execute("""
            INSERT INTO repo_downloads (file_id, node_id, bytes_transferred, success)
            VALUES ($1::uuid, $2, $3, true)
        """, file_id, node_id, row["file_size"])
    
    return FileResponse(
        path=storage_path,
        filename=row["filename"],
        media_type="application/octet-stream"
    )


# =============================================================================
# Delete File
# =============================================================================
@router.delete("/files/{file_id}")
async def delete_file(file_id: str, db: asyncpg.Pool = None):
    """Delete a file from the repository."""
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT storage_path FROM repo_files WHERE id = $1::uuid
        """, file_id)
        
        if not row:
            raise HTTPException(404, "File not found")
        
        # Delete from disk
        if row["storage_path"] and os.path.exists(row["storage_path"]):
            os.remove(row["storage_path"])
        
        # Delete from database
        await conn.execute("DELETE FROM repo_files WHERE id = $1::uuid", file_id)
    
    return {"status": "deleted", "id": file_id}


# =============================================================================
# Cache Remote File
# =============================================================================
@router.post("/cache")
async def cache_remote_file(
    url: str = Form(...),
    display_name: Optional[str] = Form(None),
    version: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    file_type: Optional[str] = Form(None),
    expected_hash: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = None,
    db: asyncpg.Pool = None
):
    """
    Cache a remote file (download and store locally).
    Useful for caching Microsoft updates, drivers, etc.
    """
    import aiohttp
    
    # Extract filename from URL
    filename = url.rsplit('/', 1)[-1].split('?')[0]
    if not filename:
        filename = f"cached_{uuid.uuid4().hex[:8]}"
    
    detected_type = file_type or detect_file_type(filename)
    file_id = str(uuid.uuid4())
    safe_filename = f"{file_id}_{filename}"
    storage_path = get_storage_path(detected_type, safe_filename)
    
    os.makedirs(os.path.dirname(storage_path), exist_ok=True)
    
    # Download file
    file_size = 0
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise HTTPException(400, f"Failed to download: HTTP {response.status}")
                
                async with aiofiles.open(storage_path, 'wb') as f:
                    async for chunk in response.content.iter_chunked(1024 * 1024):
                        file_size += len(chunk)
                        if file_size > MAX_FILE_SIZE:
                            raise HTTPException(413, "File too large")
                        await f.write(chunk)
    except aiohttp.ClientError as e:
        if os.path.exists(storage_path):
            os.remove(storage_path)
        raise HTTPException(400, f"Download failed: {str(e)}")
    
    # Compute hash and verify
    sha256_hash = await compute_sha256(storage_path)
    if expected_hash and sha256_hash.lower() != expected_hash.lower():
        os.remove(storage_path)
        raise HTTPException(400, f"Hash mismatch! Expected: {expected_hash}, Got: {sha256_hash}")
    
    # Insert into database
    async with db.acquire() as conn:
        row = await conn.fetchrow("""
            INSERT INTO repo_files (
                id, filename, display_name, version, file_type, category,
                sha256_hash, file_size, storage_path, source_url, is_cached, cached_at, created_by
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), 'cache'
            ) RETURNING id, filename, sha256_hash, file_size
        """, file_id, filename, display_name or filename, version,
            detected_type, category, sha256_hash, file_size, storage_path, url)
    
    return {
        "id": str(row["id"]),
        "filename": row["filename"],
        "sha256": row["sha256_hash"],
        "size": row["file_size"],
        "cached": True,
        "sourceUrl": url,
        "downloadUrl": f"/api/v1/repo/download/{file_id}"
    }


# =============================================================================
# Repository Stats
# =============================================================================
@router.get("/stats")
async def get_repo_stats(db: asyncpg.Pool = None):
    """Get repository statistics."""
    async with db.acquire() as conn:
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total_files,
                COALESCE(SUM(file_size), 0) as total_size,
                COALESCE(SUM(download_count), 0) as total_downloads,
                COUNT(DISTINCT category) as categories
            FROM repo_files
        """)
        
        by_type = await conn.fetch("""
            SELECT file_type, COUNT(*) as count, COALESCE(SUM(file_size), 0) as size
            FROM repo_files
            GROUP BY file_type
            ORDER BY count DESC
        """)
    
    return {
        "totalFiles": stats["total_files"],
        "totalSize": stats["total_size"],
        "totalSizeFormatted": f"{stats['total_size'] / 1024 / 1024 / 1024:.2f} GB" if stats["total_size"] > 1024*1024*1024 else f"{stats['total_size'] / 1024 / 1024:.2f} MB",
        "totalDownloads": stats["total_downloads"],
        "categories": stats["categories"],
        "byType": [
            {"type": r["file_type"], "count": r["count"], "size": r["size"]}
            for r in by_type
        ]
    }
