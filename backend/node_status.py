"""A node's connection status from its last contact - one definition for the dashboard, the Nodes
list and the Fleet tree, so a count on the dashboard and the list it links to agree.

`nodes.is_online` is not used: it is set on every inventory push and only reset when the agent is
uninstalled, so a node that stopped reporting stayed "online".
"""

ONLINE_MINUTES = 5
AWAY_MINUTES = 60
STATUSES = ("online", "away", "offline")


def status_sql(alias: str = "n") -> str:
    """SQL expression: 'online' (contact within 5 minutes), 'away' (within an hour) or 'offline'."""
    return (
        f"CASE WHEN {alias}.last_seen > NOW() - INTERVAL '{ONLINE_MINUTES} minutes' THEN 'online' "
        f"WHEN {alias}.last_seen > NOW() - INTERVAL '{AWAY_MINUTES} minutes' THEN 'away' "
        "ELSE 'offline' END"
    )
