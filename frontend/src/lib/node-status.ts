/**
 * A node's connection status as the API reports it (`status` in GET /api/v1/nodes): online =
 * contact within 5 minutes, away = within an hour, offline = longer or never - the same rule as
 * the dashboard's Fleet status card, which links to the list filtered by it (?status=).
 */
export const NODE_STATUSES = ["online", "away", "offline"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

/** Label key, badge variant and dot colour per status */
export const STATUS_LABEL: Record<NodeStatus, string> = { online: "common.online", away: "nodeDetail.away", offline: "common.offline" };
export const STATUS_VARIANT: Record<NodeStatus, string> = { online: "success", away: "warning", offline: "danger" };
export const STATUS_DOT: Record<NodeStatus, string> = { online: "bg-green-500 animate-pulse", away: "bg-yellow-500", offline: "bg-zinc-500" };

export function isNodeStatus(value: string | null | undefined): value is NodeStatus {
  return (NODE_STATUSES as readonly string[]).includes(value ?? "");
}

/** The status filter from the URL; unknown values give no filter */
export function statusFromSearch(search: string): NodeStatus | null {
  const value = new URLSearchParams(search).get("status");
  return isNodeStatus(value) ? value : null;
}

/** The URL with the status filter (null removes it); other parameters stay */
export function statusToUrl(href: string, status: NodeStatus | null): string {
  const url = new URL(href);
  if (status) url.searchParams.set("status", status); else url.searchParams.delete("status");
  return url.toString();
}
