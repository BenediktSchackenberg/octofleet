"""Linux package versions and the pending updates per node (#271).

The Linux agent reports its available updates with the distribution release. They are stored in two
tables, so approval rules can be evaluated set-based in SQL instead of reading JSON per node:

- ``linux_package_versions``: one row per (release, package, arch, version, repository) with the time
  Octofleet first saw it on any node. That time is written on insert only, so it is the same for all
  nodes (the minimum age of an approval rule counts from it). The security flag only ever turns on
  and a severity is only ever added: a node whose advisory search failed must not clear them.
- ``linux_node_updates``: the node's pending updates, one row per package version, with the name the
  agent installs it by, the installed version and ``phased`` (apt holds it back on this node for now:
  Ubuntu phases it in to a share of machines at a time - per node, not per version).

A push whose update list (and release) did not change costs one indexed read; a changed list is two
statements (versions upsert, node rows diff), independent of how many packages there are.
"""
import hashlib
import json
import re
from typing import Any, Optional

# Release key: the full release as the node reports it - "ubuntu:24.04", "debian:13", "rocky:9.8"
# ("cachyos" for rolling releases without a version). A point release is a release of its own: the
# first-seen times of its package versions start with the first node on it.
_ID = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")
_VERSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._~+-]{0,31}")
# Limits for a single report: longer values or more entries are not a real package list
MAX_UPDATES = 20000
MAX_FIELD = 256

SEVERITIES = ("Low", "Moderate", "Important", "Critical")


SCHEMA = (
    """CREATE TABLE IF NOT EXISTS linux_package_versions (
        id bigserial PRIMARY KEY,
        release text NOT NULL,
        name text NOT NULL,
        arch text NOT NULL DEFAULT '',
        version text NOT NULL,
        repository text NOT NULL DEFAULT '',
        first_seen_at timestamptz NOT NULL DEFAULT now(),
        security boolean NOT NULL DEFAULT false,
        severity text,
        CONSTRAINT linux_package_versions_key UNIQUE (release, name, arch, version, repository)
    )""",
    """CREATE TABLE IF NOT EXISTS linux_node_updates (
        node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        version_id bigint NOT NULL REFERENCES linux_package_versions(id) ON DELETE CASCADE,
        package text NOT NULL,
        installed_version text,
        PRIMARY KEY (node_id, version_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_linux_node_updates_version ON linux_node_updates (version_id)",
    # rows stored before this column were not phased; the hash of each node's list includes the flag
    # now, so every node rewrites its rows once with its next inventory
    "ALTER TABLE linux_node_updates ADD COLUMN IF NOT EXISTS phased boolean NOT NULL DEFAULT false",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS release text",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS updates_hash text",
)


async def ensure_schema(conn) -> None:
    for statement in SCHEMA:
        await conn.execute(statement)


def release_key(release: Any) -> Optional[str]:
    """The release key from the agent's ``release`` block ({id, versionId, idLike}), or None when it is
    missing or not plausible (older agents send none)."""
    if not isinstance(release, dict):
        return None
    os_id = release.get("id")
    if not isinstance(os_id, str) or not _ID.fullmatch(os_id.strip().lower()):
        return None
    os_id = os_id.strip().lower()
    version = release.get("versionId")
    version = version.strip() if isinstance(version, str) else ""
    if version and not _VERSION_ID.fullmatch(version):
        return None
    return f"{os_id}:{version}" if version else os_id


def repository_key(repository: Any) -> str:
    """apt reports all suites of a version ("noble-security,noble-updates"); a suite added later must not
    make it a new version, so the key is one suite: a security suite if there is one, else the first
    (sorted). dnf and pacman report one repository."""
    if not isinstance(repository, str):
        return ""
    suites = sorted({s.strip() for s in repository.split(",") if s.strip()})
    if not suites:
        return ""
    security = [s for s in suites if s.endswith("-security")]
    return (security or suites)[0][:MAX_FIELD]


def _text(value: Any) -> Optional[str]:
    if isinstance(value, str) and 0 < len(value) <= MAX_FIELD and value.isprintable():
        return value
    return None


def normalize(updates: Any) -> Optional[dict]:
    """The rows to store from the agent's ``updates`` block, or None when there is no list to store
    (block or list missing). Invalid entries are skipped; duplicates (same key) are merged."""
    if not isinstance(updates, dict) or not isinstance(updates.get("updates"), list):
        return None
    release = release_key(updates.get("release"))
    rows: dict = {}
    if release is not None:
        for entry in updates["updates"][:MAX_UPDATES]:
            if not isinstance(entry, dict):
                continue
            name, version = _text(entry.get("name")), _text(entry.get("newVersion"))
            if name is None or version is None:
                continue
            arch = _text(entry.get("arch")) or ""
            package = _text(entry.get("package")) or name
            if not entry.get("package") and arch and name.endswith("." + arch):
                package = name[: -len(arch) - 1]  # dnf "name.arch"
            severity = entry.get("severity")
            key = (package, arch, version, repository_key(entry.get("repository")))
            row = rows.get(key)
            security = entry.get("security") is True
            phased = entry.get("phased") is True
            severity = severity if severity in SEVERITIES else None
            if row is None:
                rows[key] = {"name": name, "installed": _text(entry.get("installedVersion")),
                             "security": security, "severity": severity, "phased": phased}
            else:
                row["security"] = row["security"] or security
                row["phased"] = row["phased"] or phased
                if severity and (not row["severity"] or SEVERITIES.index(severity) > SEVERITIES.index(row["severity"])):
                    row["severity"] = severity
    ordered = sorted(rows.items())  # one lock order for concurrent inserts of the same versions
    digest = hashlib.sha256(json.dumps([release, ordered], separators=(",", ":")).encode()).hexdigest()
    return {"release": release, "rows": ordered, "hash": digest}


# New versions are inserted in key order (no deadlocks between nodes inserting the same ones) and
# only when missing (ON CONFLICT alone would draw a sequence value for every reported version); the
# ids of new and existing rows come back in one statement (the CTE's insert is not visible to the
# join, so the union does not double them).
UPSERT_VERSIONS = """
    WITH input AS (
        SELECT t.*, array_position(ARRAY['Low', 'Moderate', 'Important', 'Critical'], t.severity) AS severity_rank
          FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[], $7::text[])
               AS t(name, arch, version, repository, security, severity)
    ), inserted AS (
        INSERT INTO linux_package_versions (release, name, arch, version, repository, security, severity)
        SELECT $1, name, arch, version, repository, security, severity FROM input i
         WHERE NOT EXISTS (SELECT 1 FROM linux_package_versions v
                            WHERE v.release = $1 AND v.name = i.name AND v.arch = i.arch
                              AND v.version = i.version AND v.repository = i.repository)
         ORDER BY name, arch, version, repository
        ON CONFLICT ON CONSTRAINT linux_package_versions_key DO NOTHING
        RETURNING id, name, arch, version, repository
    ), flagged AS (
        UPDATE linux_package_versions v
           SET security = v.security OR i.security,
               severity = CASE WHEN i.severity_rank > COALESCE(
                   array_position(ARRAY['Low', 'Moderate', 'Important', 'Critical'], v.severity), 0)
                   THEN i.severity ELSE v.severity END
          FROM input i
         WHERE v.release = $1 AND v.name = i.name AND v.arch = i.arch AND v.version = i.version
           AND v.repository = i.repository
           AND ((i.security AND NOT v.security) OR
                i.severity_rank > COALESCE(
                    array_position(ARRAY['Low', 'Moderate', 'Important', 'Critical'], v.severity), 0))
    )
    SELECT id, name, arch, version, repository FROM inserted
    UNION ALL
    SELECT v.id, v.name, v.arch, v.version, v.repository
      FROM input i JOIN linux_package_versions v
        ON v.release = $1 AND v.name = i.name AND v.arch = i.arch AND v.version = i.version
       AND v.repository = i.repository
"""

SELECT_VERSIONS = """
    SELECT v.id, v.name, v.arch, v.version, v.repository
      FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS i(name, arch, version, repository)
      JOIN linux_package_versions v
        ON v.release = $1 AND v.name = i.name AND v.arch = i.arch AND v.version = i.version
       AND v.repository = i.repository
"""

# The node's rows become exactly the reported ones: gone ones deleted, new ones inserted, changed
# ones (install name, installed version, phased) updated - unchanged rows are not written.
REPLACE_NODE_UPDATES = """
    WITH input AS (
        SELECT * FROM unnest($2::bigint[], $3::text[], $4::text[], $5::boolean[])
                      AS t(version_id, package, installed_version, phased)
    ), removed AS (
        DELETE FROM linux_node_updates u
         WHERE u.node_id = $1 AND u.version_id <> ALL($2::bigint[])
    )
    INSERT INTO linux_node_updates (node_id, version_id, package, installed_version, phased)
    SELECT $1, version_id, package, installed_version, phased FROM input
    ON CONFLICT (node_id, version_id) DO UPDATE
       SET package = EXCLUDED.package, installed_version = EXCLUDED.installed_version, phased = EXCLUDED.phased
     WHERE (linux_node_updates.package, linux_node_updates.installed_version, linux_node_updates.phased)
           IS DISTINCT FROM (EXCLUDED.package, EXCLUDED.installed_version, EXCLUDED.phased)
"""


async def store_node_updates(conn, node_uuid: str, updates: Any) -> Optional[str]:
    """Store the node's pending updates from its ``updates`` block, inside the caller's transaction.
    Returns "unchanged", "stored", "cleared" (no release: older agent - the node's rows are removed, so
    nothing is approved from stale data) or None (no update list in this push: nothing changes)."""
    report = normalize(updates)
    if report is None:
        return None
    previous = await conn.fetchval(
        "SELECT updates_hash FROM linux_data_current WHERE node_id = $1 FOR UPDATE", node_uuid)
    if previous == report["hash"]:
        return "unchanged"
    if report["release"] is None or not report["rows"]:
        await conn.execute("DELETE FROM linux_node_updates WHERE node_id = $1::uuid", node_uuid)
        result = "cleared" if report["release"] is None else "stored"
    else:
        keys = [key for key, _ in report["rows"]]
        values = [value for _, value in report["rows"]]
        ids = {(r["name"], r["arch"], r["version"], r["repository"]): r["id"]
               for r in await conn.fetch(
                   UPSERT_VERSIONS, report["release"],
                   [k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys], [k[3] for k in keys],
                   [v["security"] for v in values], [v["severity"] for v in values])}
        missing = [k for k in keys if k not in ids]
        if missing:
            # inserted by another node's push that committed after this statement started: the insert
            # waited for it and did nothing, the join's snapshot did not see it yet - a new one does
            for r in await conn.fetch(SELECT_VERSIONS, report["release"], [k[0] for k in missing],
                                      [k[1] for k in missing], [k[2] for k in missing], [k[3] for k in missing]):
                ids[(r["name"], r["arch"], r["version"], r["repository"])] = r["id"]
        stored = [(ids[k], v) for k, v in report["rows"] if k in ids]
        await conn.execute(
            REPLACE_NODE_UPDATES, node_uuid,
            [i for i, _ in stored], [v["name"] for _, v in stored], [v["installed"] for _, v in stored],
            [v["phased"] for _, v in stored])
        result = "stored"
    # the approval rules' cache re-evaluates the node (linux_rules worker)
    await conn.execute("INSERT INTO linux_approval_dirty (node_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING", node_uuid)
    await conn.execute("UPDATE linux_data_current SET release = $2, updates_hash = $3 WHERE node_id = $1",
                       node_uuid, report["release"], report["hash"])
    return result
