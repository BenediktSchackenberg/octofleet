"""Windows agent releases served by this Octofleet server.

Agents and the installer ask this server for updates before falling back to
GitHub. Releases are the ZIP/SHA256 pairs produced by scripts/Build-Release.ps1
(or scripts/publish-local-agent-release.sh), placed in AGENT_RELEASES_DIR.
The response of /latest mirrors GitHub's releases API, so the same parsing code
works for both sources. Release files contain no secrets.
"""
import os
import re
from pathlib import Path

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import FileResponse

from dependencies import get_db
from provisioning_config import server_url

router = APIRouter(prefix="/api/v1/agent/releases", tags=["agent-releases"])

AGENT_RELEASES_DIR = Path(os.getenv("AGENT_RELEASES_DIR", "/app/agent-releases"))
RELEASE_ZIP = re.compile(r"^OctofleetAgent-v(\d+)\.(\d+)\.(\d+)\.zip$")
RELEASE_FILE = re.compile(r"^OctofleetAgent-v\d+\.\d+\.\d+\.(zip|sha256)$")


def _sha256_path(zip_path: Path) -> Path:
    return zip_path.with_suffix(".sha256")


def _releases() -> list[tuple[tuple[int, int, int], Path]]:
    """Complete releases in AGENT_RELEASES_DIR (ZIP plus matching .sha256), newest first.

    A ZIP without its checksum file is an incomplete publish and is not offered.
    """
    if not AGENT_RELEASES_DIR.is_dir():
        return []
    found = []
    for path in AGENT_RELEASES_DIR.iterdir():
        match = RELEASE_ZIP.match(path.name)
        if match and path.is_file() and _sha256_path(path).is_file():
            found.append((tuple(int(part) for part in match.groups()), path))
    return sorted(found, reverse=True)


def _asset(base_url: str, path: Path) -> dict:
    return {
        "name": path.name,
        "size": path.stat().st_size,
        "browser_download_url": f"{base_url}/api/v1/agent/releases/download/{path.name}",
    }


@router.get("/latest")
async def get_latest_agent_release(request: Request, db: asyncpg.Pool = Depends(get_db)):
    """Newest agent release on this server, in GitHub releases API format."""
    releases = _releases()
    if not releases:
        raise HTTPException(status_code=404, detail="No agent release available on this server")
    version_parts, zip_path = releases[0]
    version = ".".join(str(part) for part in version_parts)
    base_url = await server_url(db, request)
    assets = [_asset(base_url, zip_path), _asset(base_url, _sha256_path(zip_path))]
    return {
        "tag_name": f"v{version}",
        "name": f"v{version}",
        "source": "octofleet-server",
        "assets": assets,
    }


@router.get("/download/{filename}")
async def download_agent_release(filename: str):
    """Download a release ZIP or its SHA256 file."""
    if not RELEASE_FILE.match(filename):
        raise HTTPException(status_code=404, detail="Release file not found")
    path = AGENT_RELEASES_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Release file not found")
    media_type = "text/plain; charset=utf-8" if filename.endswith(".sha256") else "application/zip"
    return FileResponse(path, media_type=media_type, filename=filename)
