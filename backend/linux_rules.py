"""Linux approval rules (#271): which pending Linux package updates a bulk installation may install.

A rule approves or excludes package versions (``linux_package_versions``) for the nodes in its scope:

- scope: all Linux nodes, or the nodes of the chosen deployment rings (``patch_rings``: a ring's
  group, a ring without a group = all nodes); a group narrows it further; optionally only some
  distribution releases;
- match: security updates only (with a minimum severity where the distribution has one), package
  name and repository patterns (``*`` and ``?``);
- minimum age: a version is approved once Octofleet first saw it ``min_age_hours`` ago **plus the
  delay of the node's ring** (the smallest of the rule's rings the node is in). ``expedite`` skips the
  ring delay. A paused ring approves nothing through approval rules.

A version is approved for a node when an enabled approval rule in the node's scope matches it and is
old enough, and **no enabled exclusion rule in the node's scope matches it** (an exclusion wins, also
across rules). Without an enabled rule nothing is approved. A **phased** update (apt holds it back on
the node until Ubuntu's rollout reaches it) is not evaluated: it is neither approved nor waiting, and
a bulk installation leaves it out; once the node reports it as installable, it is evaluated as usual.

Fail-safe on deleted rings or groups (no foreign keys, so a rule is never deleted or widened by
accident): an approval rule then no longer covers those nodes; an exclusion rule then covers all
Linux nodes.

Evaluation is one set-based statement over the requested nodes' rows in ``linux_node_updates``:
rules are matched against the distinct pending versions (not per node), and rule scopes are
built as rule x node rows with hash joins on ``device_groups``. It is 3 ms for one node and about
0.6 s for 500 nodes at 10,000 nodes x 150 updates with 20 rules - fine for the node page and for
the recheck of a bulk installation, too slow for the fleet list on every request. So the result is
also kept per node (``approved_at``/``excluded`` per row in ``linux_node_updates``, counts and the
next time a version becomes old enough in ``linux_data_current``), refreshed by a background worker
for the nodes in ``linux_approval_dirty``. Nodes get there through triggers (rule or ring changed:
all nodes; membership of a group a rule or ring uses changed: those nodes) and the inventory push
(the node's update list changed). Counts whose next approval time has passed are recounted from
the stored rows, so time alone needs no re-evaluation.
"""
import asyncio
import logging
import re
import uuid
from typing import Any, Optional

log = logging.getLogger(__name__)

SEVERITIES = ("Low", "Moderate", "Important", "Critical")
WORKER_BATCH = 500
WORKER_IDLE_SECONDS = 2
_UUID_TEXT = "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'"


def _as_uuid(column: str) -> str:
    """linux_data_current.node_id (text) as uuid, NULL when it is none - in a join condition the
    planner may evaluate a cast before a separate regex check, CASE keeps the order."""
    return f"CASE WHEN {column} ~ {_UUID_TEXT} THEN {column}::uuid END"
ACTIONS = ("approve", "exclude")
MAX_PATTERNS = 100
MAX_AGE_HOURS = 24 * 365
_PATTERN = re.compile(r"[A-Za-z0-9+._:@~*?-]{1,128}")
_RELEASE_PATTERN = re.compile(r"[a-z0-9*?][a-z0-9._:~+*?-]{0,95}")

SCHEMA_TABLE = """
    CREATE TABLE IF NOT EXISTS linux_update_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        description text,
        enabled boolean NOT NULL DEFAULT false,
        action text NOT NULL DEFAULT 'approve' CHECK (action IN ('approve', 'exclude')),
        ring_ids uuid[] NOT NULL DEFAULT '{}',
        group_id uuid,
        releases text[] NOT NULL DEFAULT '{}',
        security_only boolean NOT NULL DEFAULT false,
        min_severity text CHECK (min_severity IN ('Low', 'Moderate', 'Important', 'Critical')),
        repositories text[] NOT NULL DEFAULT '{}',
        packages text[] NOT NULL DEFAULT '{}',
        release_like text[] NOT NULL DEFAULT '{}',
        repository_like text[] NOT NULL DEFAULT '{}',
        package_like text[] NOT NULL DEFAULT '{}',
        min_age_hours integer NOT NULL DEFAULT 0 CHECK (min_age_hours >= 0),
        expedite boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by text
    )"""

EXAMPLE_RULE = {
    "name": "Security updates (example)",
    "description": "Approves security updates on all Linux nodes once enabled. Disabled: approves nothing.",
    "enabled": False, "action": "approve", "security_only": True,
}


SCHEMA_CACHE = (
    "ALTER TABLE patch_rings ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false",
    "ALTER TABLE linux_node_updates ADD COLUMN IF NOT EXISTS approved_at timestamptz",
    "ALTER TABLE linux_node_updates ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS approved_count integer NOT NULL DEFAULT 0",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS waiting_count integer NOT NULL DEFAULT 0",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS excluded_count integer NOT NULL DEFAULT 0",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS approval_next_at timestamptz",
    "ALTER TABLE linux_data_current ADD COLUMN IF NOT EXISTS approval_evaluated_at timestamptz",
    # security data per release (CentOS Stream: none) without scanning all its versions
    "CREATE INDEX IF NOT EXISTS idx_linux_package_versions_security ON linux_package_versions (release) WHERE security",
    """CREATE TABLE IF NOT EXISTS linux_approval_dirty (
        node_id uuid PRIMARY KEY,
        queued_at timestamptz NOT NULL DEFAULT now()
    )""",
    f"""CREATE OR REPLACE FUNCTION linux_approval_mark_all() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        INSERT INTO linux_approval_dirty (node_id)
        SELECT node_id::uuid FROM linux_data_current WHERE release IS NOT NULL AND node_id ~ {_UUID_TEXT}
        ON CONFLICT DO NOTHING;
        RETURN NULL;
    END $$""",
    # rings and groups matter only when a rule uses them (Windows ring edits do not re-evaluate)
    f"""CREATE OR REPLACE FUNCTION linux_approval_mark_ring_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF EXISTS (SELECT 1 FROM linux_update_rules WHERE cardinality(ring_ids) > 0) THEN
            INSERT INTO linux_approval_dirty (node_id)
            SELECT node_id::uuid FROM linux_data_current WHERE release IS NOT NULL AND node_id ~ {_UUID_TEXT}
            ON CONFLICT DO NOTHING;
        END IF;
        RETURN NULL;
    END $$""",
    f"""CREATE OR REPLACE FUNCTION linux_approval_mark_group_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF EXISTS (SELECT 1 FROM linux_update_rules WHERE group_id IS NOT NULL OR cardinality(ring_ids) > 0) THEN
            INSERT INTO linux_approval_dirty (node_id)
            SELECT node_id::uuid FROM linux_data_current WHERE release IS NOT NULL AND node_id ~ {_UUID_TEXT}
            ON CONFLICT DO NOTHING;
        END IF;
        RETURN NULL;
    END $$""",
    """CREATE OR REPLACE FUNCTION linux_approval_mark_members() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        INSERT INTO linux_approval_dirty (node_id)
        SELECT DISTINCT c.node_id FROM changed c
         WHERE EXISTS (SELECT 1 FROM linux_update_rules r WHERE r.group_id = c.group_id)
            OR EXISTS (SELECT 1 FROM patch_rings pr JOIN linux_update_rules r ON pr.id = ANY(r.ring_ids)
                        WHERE pr.node_group_id = c.group_id)
        ON CONFLICT DO NOTHING;
        RETURN NULL;
    END $$""",
    "DROP TRIGGER IF EXISTS linux_approval_rules_changed ON linux_update_rules",
    """CREATE TRIGGER linux_approval_rules_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
        ON linux_update_rules FOR EACH STATEMENT EXECUTE FUNCTION linux_approval_mark_all()""",
    "DROP TRIGGER IF EXISTS linux_approval_rings_changed ON patch_rings",
    """CREATE TRIGGER linux_approval_rings_changed AFTER INSERT OR UPDATE OR DELETE
        ON patch_rings FOR EACH STATEMENT EXECUTE FUNCTION linux_approval_mark_ring_change()""",
    "DROP TRIGGER IF EXISTS linux_approval_group_deleted ON groups",
    """CREATE TRIGGER linux_approval_group_deleted AFTER DELETE
        ON groups FOR EACH STATEMENT EXECUTE FUNCTION linux_approval_mark_group_delete()""",
    "DROP TRIGGER IF EXISTS linux_approval_members_added ON device_groups",
    """CREATE TRIGGER linux_approval_members_added AFTER INSERT ON device_groups
        REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION linux_approval_mark_members()""",
    "DROP TRIGGER IF EXISTS linux_approval_members_removed ON device_groups",
    """CREATE TRIGGER linux_approval_members_removed AFTER DELETE ON device_groups
        REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION linux_approval_mark_members()""",
)


async def ensure_schema(conn) -> None:
    """The rules table (with one disabled example rule when it is created, never again), the pause
    flag of deployment rings, and the per-node cache with its triggers. Needs linux_node_updates and
    linux_data_current (linux_updates.ensure_schema)."""
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext('octofleet:linux-update-rules-schema'))")
        exists = await conn.fetchval("SELECT to_regclass('linux_update_rules') IS NOT NULL")
        await conn.execute(SCHEMA_TABLE)
        for statement in SCHEMA_CACHE:
            await conn.execute(statement)
        if not exists:
            rule = validate(EXAMPLE_RULE)
            await conn.execute(INSERT_RULE, *rule_args(rule), "system")
        # nodes never evaluated (first start with this version) while a rule is enabled
        await conn.execute(f"""
            INSERT INTO linux_approval_dirty (node_id)
            SELECT node_id::uuid FROM linux_data_current
             WHERE release IS NOT NULL AND approval_evaluated_at IS NULL AND node_id ~ {_UUID_TEXT}
               AND EXISTS (SELECT 1 FROM linux_update_rules WHERE enabled)
            ON CONFLICT DO NOTHING""")


def glob_to_like(pattern: str) -> str:
    """`openssl*` -> `openssl%`; LIKE's own wildcards and the escape character are escaped."""
    escaped = pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped.replace("*", "%").replace("?", "_")


class RuleError(ValueError):
    pass


def _patterns(value: Any, field: str, pattern: re.Pattern = _PATTERN) -> list:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_PATTERNS:
        raise RuleError(f"{field}: a list of at most {MAX_PATTERNS} patterns")
    out = []
    for item in value:
        item = item.strip() if isinstance(item, str) else item
        if not isinstance(item, str) or not pattern.fullmatch(item):
            raise RuleError(f"{field}: invalid pattern {item!r} (letters, digits, + . _ : @ ~ - and the wildcards * ?)")
        if item not in out:
            out.append(item)
    return out


def _uuid(value: Any, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise RuleError(f"{field}: not a UUID") from None


def validate(data: Any, current: Optional[dict] = None) -> dict:
    """A complete, checked rule from the request body (on update merged over the current rule).
    Raises RuleError with a message for the client."""
    if not isinstance(data, dict):
        raise RuleError("body: a JSON object")
    merged = {**(current or {}), **{k: v for k, v in data.items() if k in FIELDS}}
    name = merged.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise RuleError("name: 1 to 200 characters")
    description = merged.get("description")
    if description is not None and (not isinstance(description, str) or len(description) > 2000):
        raise RuleError("description: at most 2000 characters")
    action = merged.get("action", "approve")
    if action not in ACTIONS:
        raise RuleError("action: approve or exclude")
    for flag in ("enabled", "security_only", "expedite"):
        if not isinstance(merged.get(flag, False), bool):
            raise RuleError(f"{flag}: true or false")
    ring_ids = merged.get("ring_ids") or []
    if not isinstance(ring_ids, list) or len(ring_ids) > 50:
        raise RuleError("ring_ids: a list of at most 50 ring IDs")
    ring_ids = list(dict.fromkeys(_uuid(r, "ring_ids") for r in ring_ids))
    group_id = merged.get("group_id")
    group_id = _uuid(group_id, "group_id") if group_id not in (None, "") else None
    min_severity = merged.get("min_severity")
    if min_severity in ("", None):
        min_severity = None
    elif min_severity not in SEVERITIES:
        raise RuleError(f"min_severity: one of {', '.join(SEVERITIES)}")
    age = merged.get("min_age_hours", 0)
    if isinstance(age, bool) or not isinstance(age, int) or not 0 <= age <= MAX_AGE_HOURS:
        raise RuleError(f"min_age_hours: a whole number from 0 to {MAX_AGE_HOURS}")
    releases = _patterns(merged.get("releases"), "releases", _RELEASE_PATTERN)
    repositories = _patterns(merged.get("repositories"), "repositories")
    packages = _patterns(merged.get("packages"), "packages")
    security_only = merged.get("security_only", False)
    if action == "exclude":
        if not packages and not repositories:
            raise RuleError("an exclusion rule needs package or repository patterns (to stop all updates, pause the ring)")
        security_only, min_severity, age, expedite = False, None, 0, False
    else:
        expedite = merged.get("expedite", False)
    if min_severity and not security_only:
        raise RuleError("min_severity: only with security_only")
    return {
        "name": name.strip(), "description": description, "enabled": merged.get("enabled", False),
        "action": action, "ring_ids": ring_ids, "group_id": group_id, "releases": releases,
        "security_only": security_only, "min_severity": min_severity, "repositories": repositories,
        "packages": packages, "min_age_hours": age, "expedite": expedite,
    }


FIELDS = ("name", "description", "enabled", "action", "ring_ids", "group_id", "releases", "security_only",
          "min_severity", "repositories", "packages", "min_age_hours", "expedite")


def rule_args(rule: dict) -> tuple:
    return (rule["name"], rule["description"], rule["enabled"], rule["action"],
            [uuid.UUID(r) for r in rule["ring_ids"]], uuid.UUID(rule["group_id"]) if rule["group_id"] else None,
            rule["releases"], rule["security_only"], rule["min_severity"], rule["repositories"], rule["packages"],
            [glob_to_like(p) for p in rule["releases"]], [glob_to_like(p) for p in rule["repositories"]],
            [glob_to_like(p) for p in rule["packages"]], rule["min_age_hours"], rule["expedite"])


_COLUMNS = ("name, description, enabled, action, ring_ids, group_id, releases, security_only, min_severity, "
            "repositories, packages, release_like, repository_like, package_like, min_age_hours, expedite")
INSERT_RULE = f"""
    INSERT INTO linux_update_rules ({_COLUMNS}, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *"""
UPDATE_RULE = f"""
    UPDATE linux_update_rules SET ({_COLUMNS}, updated_by, updated_at)
         = ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
     WHERE id = $1
    RETURNING *"""


# --- evaluation ---------------------------------------------------------------------------------
#
# $1: the rules to evaluate (NULL: the enabled ones; a preview passes one unsaved rule as JSON in $2)
# $3: node UUIDs as text (NULL: all Linux nodes with a release)
# Result per pending (node, version): excluded, approved_at (when the newest-qualifying approval
# rule's minimum age is reached; NULL: no approval rule matches), the approving rules.
#
# Steps: target nodes -> rule scopes (rings, group, release) -> matches of the distinct pending
# versions -> hits = pending rows x matches x scopes.

EVALUATE = f"""
WITH target AS MATERIALIZED (
    SELECT l.node_id::uuid AS node_id, l.release
      FROM linux_data_current l
     WHERE l.release IS NOT NULL AND l.node_id ~ {_UUID_TEXT}
       AND ($3::text[] IS NULL OR l.node_id = ANY($3::text[]))
       AND EXISTS (SELECT 1 FROM nodes n WHERE n.id = {_as_uuid("l.node_id")})
), rules AS MATERIALIZED (
    SELECT r.id, r.action, r.ring_ids, r.group_id, r.release_like, r.security_only, r.min_severity,
           r.repository_like, r.package_like, r.min_age_hours, r.expedite
      FROM linux_update_rules r
     WHERE ($2::jsonb IS NULL AND r.enabled AND ($1::uuid[] IS NULL OR r.id = ANY($1::uuid[])))
    UNION ALL
    SELECT (j->>'id')::uuid, j->>'action', ARRAY(SELECT jsonb_array_elements_text(j->'ring_ids'))::uuid[],
           (j->>'group_id')::uuid, ARRAY(SELECT jsonb_array_elements_text(j->'release_like')),
           (j->>'security_only')::boolean, j->>'min_severity',
           ARRAY(SELECT jsonb_array_elements_text(j->'repository_like')),
           ARRAY(SELECT jsonb_array_elements_text(j->'package_like')),
           (j->>'min_age_hours')::integer, (j->>'expedite')::boolean
      FROM (SELECT $2::jsonb AS j) p WHERE $2::jsonb IS NOT NULL
), rule_rings AS MATERIALIZED (
    -- the rule's rings that exist; paused rings approve nothing (an exclusion still applies)
    SELECT r.id AS rule_id, pr.node_group_id, pr.delay_hours
      FROM rules r JOIN patch_rings pr ON pr.id = ANY(r.ring_ids)
     WHERE r.action = 'exclude' OR NOT COALESCE(pr.paused, false)
), dangling AS MATERIALIZED (
    -- a ring, a ring's group or the rule's group deleted: an exclusion rule then covers all nodes
    SELECT r.id AS rule_id,
           cardinality(r.ring_ids) > (SELECT count(*) FROM patch_rings pr
                                       WHERE pr.id = ANY(r.ring_ids)
                                         AND (pr.node_group_id IS NULL
                                              OR EXISTS (SELECT 1 FROM groups g WHERE g.id = pr.node_group_id))) AS ring,
           r.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = r.group_id) AS grp
      FROM rules r
), ring_nodes AS MATERIALIZED (
    SELECT rule_id, node_id, min(delay_hours) AS delay
      FROM (SELECT rr.rule_id, t.node_id, rr.delay_hours
              FROM rule_rings rr JOIN target t ON rr.node_group_id IS NULL
            UNION ALL
            SELECT rr.rule_id, dg.node_id, rr.delay_hours
              FROM rule_rings rr JOIN device_groups dg ON dg.group_id = rr.node_group_id
              JOIN target t ON t.node_id = dg.node_id) x
     GROUP BY rule_id, node_id
), scope AS MATERIALIZED (
    SELECT r.id AS rule_id, r.action, t.node_id,
           r.min_age_hours + CASE WHEN r.expedite OR cardinality(r.ring_ids) = 0 THEN 0
                                  ELSE COALESCE(rn.delay, 0) END AS age_hours
      FROM rules r
      JOIN dangling d ON d.rule_id = r.id
      JOIN target t ON cardinality(r.release_like) = 0 OR t.release LIKE ANY(r.release_like)
      LEFT JOIN ring_nodes rn ON rn.rule_id = r.id AND rn.node_id = t.node_id
      LEFT JOIN device_groups g ON g.group_id = r.group_id AND g.node_id = t.node_id
     WHERE (cardinality(r.ring_ids) = 0 OR rn.node_id IS NOT NULL OR (r.action = 'exclude' AND d.ring))
       AND (r.group_id IS NULL OR g.node_id IS NOT NULL OR (r.action = 'exclude' AND d.grp))
), pending AS MATERIALIZED (
    SELECT u.node_id, u.version_id FROM linux_node_updates u JOIN target t ON t.node_id = u.node_id
     WHERE NOT u.phased
), matches AS MATERIALIZED (
    SELECT r.id AS rule_id, v.id AS version_id, v.first_seen_at
      FROM rules r
      JOIN linux_package_versions v
        ON (cardinality(r.release_like) = 0 OR v.release LIKE ANY(r.release_like))
       AND (NOT r.security_only OR v.security)
       AND (r.min_severity IS NULL OR v.severity IS NULL
            OR array_position(ARRAY['Low','Moderate','Important','Critical'], v.severity)
               >= array_position(ARRAY['Low','Moderate','Important','Critical'], r.min_severity))
       AND (cardinality(r.package_like) = 0 OR v.name LIKE ANY(r.package_like))
       AND (cardinality(r.repository_like) = 0 OR v.repository LIKE ANY(r.repository_like))
     WHERE v.id IN (SELECT DISTINCT version_id FROM pending)
)
SELECT p.node_id, p.version_id,
       bool_or(s.action = 'exclude') AS excluded,
       min(m.first_seen_at + make_interval(hours => s.age_hours)) FILTER (WHERE s.action = 'approve') AS approved_at,
       array_agg(DISTINCT s.rule_id) FILTER (WHERE s.action = 'approve') AS approve_rules,
       array_agg(DISTINCT s.rule_id) FILTER (WHERE s.action = 'exclude') AS exclude_rules
  FROM pending p
  JOIN matches m ON m.version_id = p.version_id
  JOIN scope s ON s.rule_id = m.rule_id AND s.node_id = p.node_id
 GROUP BY p.node_id, p.version_id
"""

# The nodes in the rules' scope, with whether their release has security data (preview)
SCOPE_NODES = EVALUATE.split("), pending AS")[0] + """)
SELECT DISTINCT s.node_id, i.security_data
  FROM scope s JOIN (""" + "{node_info}" + """) i ON i.node_id = s.node_id::text
"""

# The cache: evaluate the given nodes ($3) and store per row and per node in one statement
APPLY = f"""
WITH e AS ({EVALUATE}
), state AS MATERIALIZED (
    SELECT u.node_id, u.version_id, e.approved_at, COALESCE(e.excluded, false) AS excluded
      FROM linux_node_updates u
      LEFT JOIN e ON e.node_id = u.node_id AND e.version_id = u.version_id
     WHERE u.node_id = ANY($3::text[]::uuid[])
), changed AS (
    UPDATE linux_node_updates u SET approved_at = s.approved_at, excluded = s.excluded
      FROM state s
     WHERE u.node_id = s.node_id AND u.version_id = s.version_id
       AND (u.approved_at IS DISTINCT FROM s.approved_at OR u.excluded <> s.excluded)
)
UPDATE linux_data_current l
   SET approved_count = c.approved, waiting_count = c.waiting, excluded_count = c.excluded,
       approval_next_at = c.next_at, approval_evaluated_at = now()
  FROM (SELECT x.node_id,
               count(s.version_id) FILTER (WHERE NOT s.excluded AND s.approved_at <= now()) AS approved,
               count(s.version_id) FILTER (WHERE NOT s.excluded AND s.approved_at > now()) AS waiting,
               count(s.version_id) FILTER (WHERE s.excluded) AS excluded,
               min(s.approved_at) FILTER (WHERE NOT s.excluded AND s.approved_at > now()) AS next_at
          FROM unnest($3::text[]) AS x(node_id)
          LEFT JOIN state s ON s.node_id = x.node_id::uuid
         GROUP BY x.node_id) c
 WHERE l.node_id = c.node_id
"""

# Nodes whose next version has become old enough: recount from the stored rows (no evaluation)
RECOUNT_DUE = f"""
UPDATE linux_data_current l
   SET approved_count = c.approved, waiting_count = c.waiting, approval_next_at = c.next_at
  FROM (SELECT d.node_id,
               count(u.version_id) FILTER (WHERE NOT u.excluded AND u.approved_at <= now()) AS approved,
               count(u.version_id) FILTER (WHERE NOT u.excluded AND u.approved_at > now()) AS waiting,
               min(u.approved_at) FILTER (WHERE NOT u.excluded AND u.approved_at > now()) AS next_at
          FROM linux_data_current d
          LEFT JOIN linux_node_updates u ON u.node_id = {_as_uuid("d.node_id")}
         WHERE d.approval_next_at <= now()
         GROUP BY d.node_id) c
 WHERE l.node_id = c.node_id
"""

PICK_DIRTY = """
DELETE FROM linux_approval_dirty d
 USING (SELECT node_id FROM linux_approval_dirty ORDER BY queued_at LIMIT $1 FOR UPDATE SKIP LOCKED) p
 WHERE d.node_id = p.node_id
RETURNING d.node_id::text
"""

MARK_DIRTY = "INSERT INTO linux_approval_dirty (node_id) VALUES ($1::uuid) ON CONFLICT DO NOTHING"

# The node's pending updates with their approval state (node page, bulk installation)
NODE_DETAIL = f"""
SELECT v.name, v.arch, v.version, v.repository, v.security, v.severity, v.first_seen_at, v.release,
       u.package, u.installed_version, u.phased,
       COALESCE(e.excluded, false) AS excluded, e.approved_at, e.approve_rules, e.exclude_rules
  FROM linux_node_updates u
  JOIN linux_package_versions v ON v.id = u.version_id
  LEFT JOIN ({EVALUATE}) e ON e.node_id = u.node_id AND e.version_id = u.version_id
 WHERE u.node_id = ANY($3::text[]::uuid[])
 ORDER BY u.node_id, v.name, v.arch
"""

# Per Linux node: release, package manager (from the list summary the push stores, so the whole update
# list is not read for one field; the whole list for rows from before it), and whether its release has
# security data (apt: from the security suites; dnf/yum: advisories - none on e.g. CentOS Stream;
# pacman: none)
# Only nodes that still exist: linux_data_current is keyed by text and outlives a node deleted directly
NODE_INFO = f"""
SELECT l.node_id, l.release, COALESCE(l.updates_for_list, l.updates)->>'packageManager' AS package_manager,
       CASE COALESCE(l.updates_for_list, l.updates)->>'packageManager'
            WHEN 'apt' THEN true
            WHEN 'pacman' THEN false
            ELSE EXISTS (SELECT 1 FROM linux_package_versions v WHERE v.release = l.release AND v.security)
       END AS security_data
  FROM linux_data_current l
 WHERE ($1::text[] IS NULL OR l.node_id = ANY($1::text[]))
   AND EXISTS (SELECT 1 FROM nodes n WHERE n.id = {_as_uuid("l.node_id")})
"""


SCOPE_NODES = SCOPE_NODES.replace("{node_info}", NODE_INFO.replace("$1::text[]", "$3::text[]"))


# Per Linux node for the fleet list: release, package manager, security data and the cached counts
# (recounted here for nodes whose next approval time has passed, until the worker has done it);
# `evaluating` while the node waits for the worker
FLEET_STATE = f"""
SELECT i.*, l.approval_evaluated_at, l.excluded_count AS excluded,
       CASE WHEN l.approval_next_at <= now() THEN c.approved ELSE l.approved_count END AS approved,
       CASE WHEN l.approval_next_at <= now() THEN c.waiting ELSE l.waiting_count END AS waiting,
       EXISTS (SELECT 1 FROM linux_approval_dirty d WHERE d.node_id = {_as_uuid("l.node_id")}) AS evaluating
  FROM ({NODE_INFO}) i
  JOIN linux_data_current l ON l.node_id = i.node_id
  LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE NOT u.excluded AND u.approved_at <= now()) AS approved,
             count(*) FILTER (WHERE NOT u.excluded AND u.approved_at > now()) AS waiting
        FROM linux_node_updates u
       WHERE l.approval_next_at <= now() AND u.node_id = {_as_uuid("l.node_id")}) c ON true
"""


async def process_dirty(conn, limit: int = WORKER_BATCH) -> int:
    """Evaluate up to `limit` queued nodes and store the result; returns how many were taken. A node
    queued again meanwhile (its push waits for this transaction) is evaluated again next time."""
    async with conn.transaction():
        nodes = [r[0] for r in await conn.fetch(PICK_DIRTY, limit)]
        if nodes:
            await conn.execute(APPLY, None, None, nodes)
    return len(nodes)


async def recount_due(conn) -> None:
    await conn.execute(RECOUNT_DUE)


async def approval_loop(pool) -> None:
    """Background worker: keeps the per-node approval cache current. Several API processes can run
    it (FOR UPDATE SKIP LOCKED); a failure is logged and retried."""
    while True:
        try:
            async with pool.acquire() as conn:
                taken = await process_dirty(conn)
                await recount_due(conn)
            await asyncio.sleep(0 if taken >= WORKER_BATCH else WORKER_IDLE_SECONDS)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Updating the Linux approval cache failed")
            await asyncio.sleep(10)


def approval_state(row, now) -> str:
    """approved / waiting (minimum age not reached) / excluded / not_approved, or phased (apt holds it
    back on the node for now; not evaluated)"""
    if row.get("phased"):
        return "phased"
    if row["excluded"]:
        return "excluded"
    at = row["approved_at"]
    if at is None:
        return "not_approved"
    return "approved" if at <= now else "waiting"


def preview_json(rule: dict) -> dict:
    """The unsaved rule in the shape EVALUATE reads from $2."""
    return {
        "id": str(uuid.UUID(int=0)), "action": rule["action"], "ring_ids": rule["ring_ids"],
        "group_id": rule["group_id"], "release_like": [glob_to_like(p) for p in rule["releases"]],
        "security_only": rule["security_only"], "min_severity": rule["min_severity"],
        "repository_like": [glob_to_like(p) for p in rule["repositories"]],
        "package_like": [glob_to_like(p) for p in rule["packages"]],
        "min_age_hours": rule["min_age_hours"], "expedite": rule["expedite"],
    }


def install_packages(rows, now) -> list:
    """The payload's packages for a bulk installation: the approved versions, as the agent installs
    them ({"name", "version"}). apt lists a package once per architecture (multiarch): when a name
    comes with several, each is named name:arch."""
    approved = [r for r in rows if approval_state(r, now) == "approved"]
    per_name: dict = {}
    for r in approved:
        per_name.setdefault(r["package"], set()).add(r["arch"])
    out = []
    for r in approved:
        name = r["package"]
        if len(per_name[name]) > 1 and r["arch"] not in ("", "all") and ":" not in name and "." not in name:
            name = f"{name}:{r['arch']}"
        out.append({"name": name, "version": r["version"]})
    return out
