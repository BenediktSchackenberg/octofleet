"""What uses a group, and what deleting it does to each use.

Deleting a group never widens an approval: Linux approval rules and patch rings keep the group's id
(clearing it would make them apply to *all* nodes), and the rule engine treats a missing group fail-safe -
an approval rule (or a ring's approvals) then approves nothing, an exclusion rule covers all nodes. They
are only named in the warning. Assignments that only exist for the group are deleted, maintenance windows
for it are deactivated, the onboarding default is cleared (new nodes could not join a missing group).
Jobs and deployments are left as they are: they were expanded to their nodes when they were created and
keep running there.

Each use is one row: `kind`, `count`, up to 10 `names` and `effect` (what the delete does). The tables
are optional (older or partial installations): a missing table counts as unused.
"""
from uuid import UUID

NAMES = 10

# kind, table, the WHERE clause on $1 (the group id), the name column (or None), effect
USES = (
    ("members", "device_groups", "group_id = $1::uuid", None, "removed"),
    ("subgroups", "groups", "parent_id = $1::uuid", "name", "moved_to_top"),
    ("linux_approvals", "linux_update_rules", "group_id = $1::uuid AND action = 'approve'", "name", "approves_nothing"),
    ("linux_exclusions", "linux_update_rules", "group_id = $1::uuid AND action = 'exclude'", "name", "covers_all"),
    ("patch_rings", "patch_rings", "node_group_id = $1::uuid", "name", "no_nodes"),
    ("onboarding", "onboarding_config", "onboarding_group_id = $1::uuid", None, "cleared"),
    ("maintenance_windows", "maintenance_windows", "target_type = 'group' AND target_id = $1::uuid", "name", "deactivated"),
    ("remediation_windows", "maintenance_window_groups", "group_id = $1::uuid", None, "removed"),
    ("monitoring_assignments", "monitoring_assignments", "target_type = 'group' AND target_id = $1::text", None, "deleted"),
    ("config_baselines", "config_baseline_assignments", "target_type = 'group' AND target_id = $1::uuid", None, "deleted"),
    ("software_baselines", "software_baseline_assignments", "group_id = $1::uuid", None, "deleted"),
    ("sql_server", "mssql_group_assignments", "group_id = $1::uuid", None, "deleted"),
    ("jobs", "jobs", "target_type = 'group' AND target_id = $1::uuid", "name", "kept"),
    ("deployments", "deployments", "target_type = 'group' AND target_id = $1::uuid", "name", "kept"),
)

# what the delete does before the group row goes (the foreign keys handle members, sub-groups and
# the assignment tables with ON DELETE CASCADE; these have no foreign key)
CLEANUP = (
    ("onboarding_config", "UPDATE onboarding_config SET onboarding_group_id = NULL, auto_assign_new_nodes = false WHERE onboarding_group_id = $1::uuid"),
    ("maintenance_windows", "UPDATE maintenance_windows SET is_active = false WHERE target_type = 'group' AND target_id = $1::uuid AND is_active"),
    ("monitoring_assignments", "DELETE FROM monitoring_assignments WHERE target_type = 'group' AND target_id = $1::text"),
    ("config_baseline_assignments", "DELETE FROM config_baseline_assignments WHERE target_type = 'group' AND target_id = $1::uuid"),
)


async def _tables(conn) -> set[str]:
    names = {u[1] for u in USES} | {c[0] for c in CLEANUP}
    rows = await conn.fetch("SELECT relname FROM pg_class WHERE relkind = 'r' AND relname = ANY($1::text[])"
                            " AND relnamespace = 'public'::regnamespace", list(names))
    return {r["relname"] for r in rows}


async def usage(conn, group_id: UUID) -> list[dict]:
    """The uses of a group that exist, in the order of USES (one indexed or small query each)"""
    group_id = str(group_id)  # as text, cast per column: target_id is uuid or text depending on the table
    tables = await _tables(conn)
    result = []
    for kind, table, where, name, effect in USES:
        if table not in tables:
            continue
        count = await conn.fetchval(f"SELECT count(*) FROM {table} WHERE {where}", group_id)
        if not count:
            continue
        names = []
        if name:
            names = [r[0] for r in await conn.fetch(
                f"SELECT {name} FROM {table} WHERE {where} ORDER BY lower({name}) LIMIT {NAMES}", group_id)]
        result.append({"kind": kind, "count": count, "names": names, "effect": effect})
    return result


async def clean_up(conn, group_id: UUID) -> None:
    """Deactivate, clear or delete what would otherwise point at the deleted group (in the delete's transaction)"""
    group_id = str(group_id)
    tables = await _tables(conn)
    for table, sql in CLEANUP:
        if table in tables:
            await conn.execute(sql, group_id)


async def ensure_schema(pool) -> None:
    """Jobs by group (usage) and by tag (the tag list counts them per tag): small partial indexes, so
    neither reads every job (500,000 jobs at 10,000 nodes)"""
    async with pool.acquire() as conn:
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_target_group ON jobs (target_id) WHERE target_type = 'group'")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_target_tag ON jobs (target_tag) WHERE target_type = 'tag'")
