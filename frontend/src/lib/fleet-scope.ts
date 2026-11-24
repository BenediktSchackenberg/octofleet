/**
 * The Fleet workspace's tree (Fleet → Nodes): groups → OS family → release, and the nodes in no
 * group the same way. The branch the user picked is the list's scope and lives in the URL
 * (?group=<id>|unassigned&os=<family>&release=<name>), so Back, reload and shared links keep it.
 */

export interface TreeCount {
  total: number;
  online: number;
}

export interface TreeRelease extends TreeCount {
  name: string;
  node_ids: string[];
}

export interface TreeFamily extends TreeCount {
  family: string;
  releases: TreeRelease[];
}

export interface TreeBranch extends TreeCount {
  os: TreeFamily[];
}

export interface TreeGroup extends TreeBranch {
  id: string;
  name: string;
}

/** GET /api/v1/nodes/tree?view=summary */
export interface FleetTreeSummary extends TreeCount {
  groups: TreeGroup[];
  unassigned: TreeBranch;
}

export const UNASSIGNED = "unassigned";

/** No group: all nodes. `os` and `release` narrow a group (or the unassigned branch) down. */
export interface FleetScope {
  group: string | null;
  os: string | null;
  release: string | null;
}

export const ALL_NODES: FleetScope = { group: null, os: null, release: null };

const PARAMS = ["group", "os", "release"] as const;

/** The scope from the URL; a release without its OS, or an OS without its group, is dropped */
export function scopeFromSearch(search: string): FleetScope {
  const p = new URLSearchParams(search);
  const group = p.get("group") || null;
  const os = group ? p.get("os") || null : null;
  const release = os ? p.get("release") || null : null;
  return { group, os, release };
}

/** The URL with the scope; other parameters (sort, …) stay */
export function scopeToUrl(href: string, scope: FleetScope): string {
  const url = new URL(href);
  for (const name of PARAMS) url.searchParams.delete(name);
  for (const name of PARAMS) {
    const value = scope[name];
    if (!value) break;
    url.searchParams.set(name, value);
  }
  return url.toString();
}

/** /nodes with the scope, as a link target from anywhere (the node page, the dashboard) */
export function scopeHref(scope: FleetScope): string {
  const p = new URLSearchParams();
  for (const name of PARAMS) {
    const value = scope[name];
    if (!value) break;
    p.set(name, value);
  }
  const query = p.toString();
  return query ? `/nodes?${query}` : "/nodes";
}

export function sameScope(a: FleetScope, b: FleetScope): boolean {
  return a.group === b.group && a.os === b.os && a.release === b.release;
}

/** The tree branch a scope points at (null: all nodes, or a branch that no longer exists) */
export function scopeBranch(tree: FleetTreeSummary, scope: FleetScope): TreeCount & { releases: TreeRelease[] } | null {
  if (!scope.group) return null;
  const branch: TreeBranch | undefined = scope.group === UNASSIGNED ? tree.unassigned : tree.groups.find((g) => g.id === scope.group);
  if (!branch) return null;
  const families = scope.os ? branch.os.filter((f) => f.family === scope.os) : branch.os;
  const releases = families.flatMap((f) => f.releases).filter((r) => !scope.release || r.name === scope.release);
  const total = releases.reduce((sum, r) => sum + r.total, 0);
  const online = releases.reduce((sum, r) => sum + r.online, 0);
  return { total, online, releases };
}

/** The node IDs in the scope; null means all nodes (no filter) */
export function scopeNodeIds(tree: FleetTreeSummary | null, scope: FleetScope): Set<string> | null {
  if (!scope.group || !tree) return null;
  const branch = scopeBranch(tree, scope);
  return new Set(branch ? branch.releases.flatMap((r) => r.node_ids) : []);
}

/** The group's name for a scope ("unassigned" and unknown IDs give null) */
export function scopeGroupName(tree: FleetTreeSummary | null, scope: FleetScope): string | null {
  if (!tree || !scope.group || scope.group === UNASSIGNED) return null;
  return tree.groups.find((g) => g.id === scope.group)?.name ?? null;
}

/** Keys of the tree rows a scope sits under, so they can be expanded to show it */
export function scopeAncestors(scope: FleetScope): string[] {
  const keys: string[] = [];
  if (!scope.group) return keys;
  keys.push(scope.group === UNASSIGNED ? UNASSIGNED : "groups");
  keys.push(branchKey({ group: scope.group, os: null, release: null }));
  if (scope.os) keys.push(branchKey({ group: scope.group, os: scope.os, release: null }));
  return keys;
}

/** A stable key for a tree row (expanded state) */
export function branchKey(scope: FleetScope): string {
  return [scope.group ?? "", scope.os ?? "", scope.release ?? ""].join("\u001f").replace(/\u001f+$/, "");
}
