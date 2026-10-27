#!/usr/bin/env bash
# Build the Windows agent from the committed state of this checkout and publish
# it to agent-releases/, from where the backend offers it to the installer and
# to the agents' auto-updater.
#
# Usage: bash scripts/publish-local-agent-release.sh VERSION      (e.g. 0.7.2)
#
# Runs scripts/Build-Release.ps1 in the .NET 8 SDK container, so only Docker is
# needed. The resulting binaries are not code-signed.

set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Usage: $0 VERSION   (e.g. 0.7.2)" >&2
    exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${AGENT_RELEASES_DIR:-$ROOT/agent-releases}"
SDK_IMAGE="${DOTNET_SDK_IMAGE:-mcr.microsoft.com/dotnet/sdk:8.0}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
    echo "⚠️  Uncommitted changes are NOT included - building $(git -C "$ROOT" rev-parse --short HEAD)" >&2
fi

mkdir -p "$WORK/src" "$WORK/out"
git -C "$ROOT" archive HEAD | tar -x -C "$WORK/src"

echo "🔨 Building Octofleet Windows Agent v$VERSION ($(git -C "$ROOT" rev-parse --short HEAD)) in $SDK_IMAGE..."
# The SDK runs as root inside the container (it cannot create its NuGet mutex
# under an unknown UID); hand the output back to the calling user afterwards.
docker run --rm \
    -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 -e EnableWindowsTargeting=true \
    -v "$WORK/src:/src" -v "$WORK/out:/out" -w /src \
    "$SDK_IMAGE" \
    sh -c "pwsh -NoProfile -File scripts/Build-Release.ps1 -Version '$VERSION' -OutputPath /out; rc=\$?; chown -R $(id -u):$(id -g) /src /out; exit \$rc"

install -d -m 755 "$TARGET"
install -m 644 "$WORK/out/OctofleetAgent-v$VERSION.zip" "$WORK/out/OctofleetAgent-v$VERSION.sha256" "$TARGET/"

echo ""
echo "✅ Published to $TARGET:"
ls -l "$TARGET/OctofleetAgent-v$VERSION.zip" "$TARGET/OctofleetAgent-v$VERSION.sha256"
echo "   SHA256: $(cat "$TARGET/OctofleetAgent-v$VERSION.sha256")"
echo ""
echo "Agents with the server-first updater pick it up within 6 hours;"
echo "older agents need the install command from \"Add Device\" once."
