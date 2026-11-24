/**
 * Order of the Nodes list. The API returns the nodes by hostname (case-insensitive, then node_id);
 * the page sorts on top of that by the column the user picked, kept in the URL (?sort=&dir=), with
 * the hostname as the tie-breaker so equal values never change places between reloads.
 */
export const NODE_SORTS = ["name", "status", "os", "agent", "last_seen"] as const;
export type NodeSort = (typeof NODE_SORTS)[number];
export type SortDir = "asc" | "desc";

/** The direction a column starts with: names A–Z, online first, newest agent and last contact first */
export const DEFAULT_DIR: Record<NodeSort, SortDir> = { name: "asc", status: "asc", os: "asc", agent: "desc", last_seen: "desc" };

export interface SortableNode {
  hostname: string;
  node_id: string;
  is_online: boolean;
  os_name?: string | null;
  agent_version?: string | null;
  last_seen?: string | null;
}

const text = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function byName(a: SortableNode, b: SortableNode): number {
  return text.compare(a.hostname, b.hostname) || (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0);
}

/** Ascending comparison of one column; missing values sort last in either direction */
function byColumn(sort: NodeSort, a: SortableNode, b: SortableNode): number | null {
  switch (sort) {
    case "name": return 0;
    case "status": return (a.is_online ? 0 : 1) - (b.is_online ? 0 : 1);
    case "os": return a.os_name && b.os_name ? text.compare(a.os_name, b.os_name) : null;
    case "agent": return a.agent_version && b.agent_version ? text.compare(a.agent_version, b.agent_version) : null;
    case "last_seen": {
      const ta = Date.parse(a.last_seen || ""), tb = Date.parse(b.last_seen || "");
      return Number.isNaN(ta) || Number.isNaN(tb) ? null : ta - tb;
    }
  }
}

function missing(sort: NodeSort, n: SortableNode): boolean {
  if (sort === "os") return !n.os_name;
  if (sort === "agent") return !n.agent_version;
  if (sort === "last_seen") return Number.isNaN(Date.parse(n.last_seen || ""));
  return false;
}

export function sortNodes<T extends SortableNode>(nodes: T[], sort: NodeSort, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...nodes].sort((a, b) => {
    if (sort === "name") return sign * byName(a, b);
    const ma = missing(sort, a), mb = missing(sort, b);
    if (ma !== mb) return ma ? 1 : -1;
    return sign * (byColumn(sort, a, b) ?? 0) || byName(a, b);
  });
}

/** The sort from the URL; unknown values give the default (name, A–Z) */
export function sortFromSearch(search: string): { sort: NodeSort; dir: SortDir } {
  const p = new URLSearchParams(search);
  const sort = (NODE_SORTS as readonly string[]).includes(p.get("sort") ?? "") ? (p.get("sort") as NodeSort) : "name";
  const dir = p.get("dir") === "asc" || p.get("dir") === "desc" ? (p.get("dir") as SortDir) : DEFAULT_DIR[sort];
  return { sort, dir };
}

/** The URL with the sort; the default is left out */
export function sortToUrl(href: string, sort: NodeSort, dir: SortDir): string {
  const url = new URL(href);
  url.searchParams.delete("sort"); url.searchParams.delete("dir");
  if (sort !== "name") url.searchParams.set("sort", sort);
  if (dir !== DEFAULT_DIR[sort]) url.searchParams.set("dir", dir);
  return url.toString();
}
