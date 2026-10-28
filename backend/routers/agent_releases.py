"""Agent releases served by this Octofleet server.

Agents and the installers ask this server for updates before falling back to
GitHub. Release files contain no secrets.

Windows: ZIP/SHA256 pairs produced by scripts/Build-Release.ps1 (or
scripts/publish-local-agent-release.sh), placed in AGENT_RELEASES_DIR. The
response of /latest mirrors GitHub's releases API, so the same parsing code
works for both sources.

Linux: agent.sh, octofleet-agent.service and install.sh from the server's
linux-agent/ directory (LINUX_AGENT_DIR); the version is the VERSION="..." line
of agent.sh.
"""
import hashlib
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import FileResponse

router = APIRouter(prefix="/api/v1/agent/releases", tags=["agent-releases"])

AGENT_RELEASES_DIR = Path(os.getenv("AGENT_RELEASES_DIR", "/app/agent-releases"))
RELEASE_ZIP = re.compile(r"^OctofleetAgent-v(\d+)\.(\d+)\.(\d+)\.zip$")
RELEASE_FILE = re.compile(r"^OctofleetAgent-v\d+\.\d+\.\d+\.(zip|sha256)$")

LINUX_AGENT_DIR = Path(os.getenv("LINUX_AGENT_DIR", "/app/static/linux-agent"))
LINUX_AGENT_FILES = ("agent.sh", "octofleet-agent.service", "install.sh")
LINUX_VERSION = re.compile(r'^VERSION="([^"]+)"', re.MULTILINE)


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


@router.get("/linux/latest")
async def get_latest_linux_agent(request: Request):
    """Linux agent (agent.sh) offered by this server, with version and SHA256."""
    agent = LINUX_AGENT_DIR / "agent.sh"
    if not agent.is_file():
        raise HTTPException(status_code=404, detail="No Linux agent available on this server")
    content = agent.read_bytes()
    match = LINUX_VERSION.search(content.decode("utf-8", errors="replace"))
    if not match:
        raise HTTPException(status_code=404, detail="Linux agent has no VERSION line")
    base = f"{_base_url(request)}/api/v1/agent/releases/linux"
    release = {
        "version": match.group(1),
        "sha256": hashlib.sha256(content).hexdigest(),
        "download_url": f"{base}/agent.sh",
        "service_url": f"{base}/octofleet-agent.service",
        "source": "octofleet-server",
    }
    # install.sh verifies the systemd unit as well and stops without this checksum
    service = LINUX_AGENT_DIR / "octofleet-agent.service"
    if service.is_file():
        release["service_sha256"] = hashlib.sha256(service.read_bytes()).hexdigest()
    return release


@router.get("/linux/{filename}")
async def download_linux_agent_file(filename: str):
    """Download agent.sh, its systemd unit or install.sh (which then installs from this server)."""
    path = LINUX_AGENT_DIR / filename
    if filename not in LINUX_AGENT_FILES or not path.is_file():
        raise HTTPException(status_code=404, detail="Linux agent file not found")
    return FileResponse(path, media_type="text/plain; charset=utf-8", filename=filename)
