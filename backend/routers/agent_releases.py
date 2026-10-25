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

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import FileResponse

router = APIRouter(prefix="/api/v1/agent/releases", tags=["agent-releases"])

AGENT_RELEASES_DIR = Path(os.getenv("AGENT_RELEASES_DIR", "/app/agent-releases"))
RELEASE_ZIP = re.compile(r"^OctofleetAgent-v(\d+)\.(\d+)\.(\d+)\.zip$")
RELEASE_FILE = re.compile(r"^OctofleetAgent-v\d+\.\d+\.\d+\.(zip|sha256)$")


def _releases() -> list[tuple[tuple[int, int, int], Path]]:
    """All release ZIPs in AGENT_RELEASES_DIR, newest first."""
    if not AGENT_RELEASES_DIR.is_dir():
        return []
    found = []
    for path in AGENT_RELEASES_DIR.iterdir():
        match = RELEASE_ZIP.match(path.name)
        if match and path.is_file():
            found.append((tuple(int(part) for part in match.groups()), path))
    return sorted(found, reverse=True)


def _base_url(request: Request) -> str:
    host = request.headers.get("x-forwarded-host", request.headers.get("host", "localhost:8080"))
    scheme = request.headers.get("x-forwarded-proto", "http")
    return f"{scheme}://{host}"


def _asset(request: Request, path: Path) -> dict:
    return {
        "name": path.name,
        "size": path.stat().st_size,
        "browser_download_url": f"{_base_url(request)}/api/v1/agent/releases/download/{path.name}",
    }


@router.get("/latest")
async def get_latest_agent_release(request: Request):
    """Newest agent release on this server, in GitHub releases API format."""
    releases = _releases()
    if not releases:
        raise HTTPException(status_code=404, detail="No agent release available on this server")
    version_parts, zip_path = releases[0]
    version = ".".join(str(part) for part in version_parts)
    assets = [_asset(request, zip_path)]
    sha_path = zip_path.with_name(f"OctofleetAgent-v{version}.sha256")
    if sha_path.is_file():
        assets.append(_asset(request, sha_path))
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
