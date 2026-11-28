"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, FolderOpen, FolderTree, RefreshCw, Server, Settings2, TriangleAlert } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { cn } from "@/lib/utils";
import {
  ALL_NODES, UNASSIGNED, branchKey, sameScope, scopeAncestors, scopeFromSearch, scopeHref, scopeToUrl,
  type FleetScope, type FleetTreeSummary, type TreeBranch,
} from "@/lib/fleet-scope";

/**
 * Fleet workspace: the tree of groups → OS → release on the left of Fleet → Nodes and of each node
 * page. Picking a branch scopes the Nodes list (in the URL); the tree keeps its expanded rows for
 * the browser session, so it looks the same after opening a node and going Back.
 */

interface FleetTreeState {
  tree: FleetTreeSummary | null;
  loading: boolean;
  failed: boolean;
  reload: () => void;
  scope: FleetScope;
  selectScope: (scope: FleetScope) => void;
}

const FleetTreeContext = createContext<FleetTreeState>({
  tree: null, loading: false, failed: false, reload: () => {}, scope: ALL_NODES, selectScope: () => {},
});

export function useFleetTree(): FleetTreeState {
  return useContext(FleetTreeContext);
}

// The last tree, shown at once when the next page mounts (pages remount on navigation) and
// refreshed in the background
let cachedTree: FleetTreeSummary | null = null;

export function FleetTreeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tree, setTree] = useState<FleetTreeSummary | null>(cachedTree);
  const [loading, setLoading] = useState(cachedTree === null);
  const [failed, setFailed] = useState(false);

  const fetchTree = useCallback(() => {
    apiClient.get<FleetTreeSummary>("/nodes/tree?view=summary", { showErrorToast: false }).then((data) => {
      if (data) {
        cachedTree = data;
        setTree(data);
      }
      setFailed(!data);
      setLoading(false);
    });
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    fetchTree();
  }, [fetchTree]);

  useEffect(fetchTree, [fetchTree]);

  // The scope is the list's; on a node page no branch is picked
  const onList = pathname === "/nodes";
  const query = searchParams.toString();
  const scope = useMemo(() => (onList ? scopeFromSearch(query) : ALL_NODES), [onList, query]);

  const selectScope = useCallback((next: FleetScope) => {
    if (onList) {
      const url = scopeToUrl(window.location.href, next);
      // null state: Next.js adds its own and updates useSearchParams (with its own state passed in,
      // it treats the call as internal and the list would not follow)
      if (url !== window.location.href) window.history.pushState(null, "", url);
    } else {
      router.push(scopeHref(next));
    }
  }, [onList, router]);

  const value = useMemo(() => ({ tree, loading, failed, reload, scope, selectScope }), [tree, loading, failed, reload, scope, selectScope]);
  return <FleetTreeContext.Provider value={value}>{children}</FleetTreeContext.Provider>;
}

const EXPANDED_KEY = "octofleet-fleet-tree-expanded";
const DEFAULT_EXPANDED = ["groups", UNASSIGNED];

function readExpanded(): Set<string> {
  try {
    const saved = sessionStorage.getItem(EXPANDED_KEY);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {
    // private mode or broken JSON: start with the defaults
  }
  return new Set(DEFAULT_EXPANDED);
}

/** Every release row that lists the node: one per group it is in, or one under "Not in a group" */
function nodeScopes(tree: FleetTreeSummary, nodeId: string): FleetScope[] {
  const found: FleetScope[] = [];
  const scan = (group: string, branch: TreeBranch) => {
    for (const family of branch.os) {
      for (const release of family.releases) {
        if (release.node_ids.includes(nodeId)) found.push({ group, os: family.family, release: release.name });
      }
    }
  };
  tree.groups.forEach((g) => scan(g.id, g));
  scan(UNASSIGNED, tree.unassigned);
  return found;
}

function osIcon(family: string): string {
  return family === "Windows" ? "🪟" : family === "Linux" ? "🐧" : "💻"; // i18n-ignore
}

export function FleetTree() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { tree, loading, failed, reload, scope, selectScope } = useFleetTree();
  // The tree renders in the browser only (below the Suspense boundary of useSearchParams), so the
  // saved rows can be read on the first render
  const [expanded, setExpanded] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set(DEFAULT_EXPANDED) : readExpanded()));
  const onList = pathname === "/nodes";
  // On a node page: the releases (one per group the node is in) that hold it
  const nodeId = !onList && pathname.startsWith("/nodes/") ? decodeURIComponent(pathname.split("/")[2] ?? "") : null;
  const nodePlaces = useMemo(() => (tree && nodeId ? nodeScopes(tree, nodeId) : []), [tree, nodeId]);

  const save = (next: Set<string>) => {
    try { sessionStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* not kept */ }
    return next;
  };

  // A scope from a link or Back opens its branch (adjusted while rendering, not in an effect)
  const [shownScope, setShownScope] = useState<FleetScope | null>(null);
  if (shownScope === null || !sameScope(shownScope, scope)) {
    setShownScope(scope);
    const missing = scopeAncestors(scope).filter((key) => !expanded.has(key));
    if (missing.length) setExpanded(save(new Set([...expanded, ...missing])));
  }
  // ... and a node page opens the node's places in the tree
  const placesKey = nodePlaces.map(branchKey).join("|");
  const [shownPlaces, setShownPlaces] = useState("");
  if (placesKey !== shownPlaces) {
    setShownPlaces(placesKey);
    const missing = nodePlaces.flatMap(scopeAncestors).filter((key) => !expanded.has(key));
    if (missing.length) setExpanded(save(new Set([...expanded, ...missing])));
  }

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return save(next);
  });

  /** Picking a row shows its nodes and opens it (a picked row is not closed again) */
  const pick = (target: FleetScope, key: string) => {
    selectScope(target);
    if (!expanded.has(key)) toggle(key);
  };

  const selected = (target: FleetScope) => (onList ? sameScope(scope, target) : nodePlaces.some((place) => sameScope(place, target)));

  function branchRows(groupId: string, branch: TreeBranch, indent: number) {
    return branch.os.map((family) => {
      const familyScope = { group: groupId, os: family.family, release: null };
      const familyKey = branchKey(familyScope);
      return (
        <div key={familyKey}>
          <TreeRow
            label={family.family} icon={<span className="text-xs" aria-hidden>{osIcon(family.family)}</span>}
            total={family.total} online={family.online} indent={indent}
            expanded={expanded.has(familyKey)} onToggle={() => toggle(familyKey)}
            selected={selected(familyScope)} onPick={() => pick(familyScope, familyKey)}
          />
          {expanded.has(familyKey) && family.releases.map((release) => {
            const releaseScope = { group: groupId, os: family.family, release: release.name };
            return (
              <TreeRow
                key={release.name} label={release.name} total={release.total} online={release.online} indent={indent + 1}
                selected={selected(releaseScope)} onPick={() => selectScope(releaseScope)}
              />
            );
          })}
        </div>
      );
    });
  }

  // groups as a tree: a group with sub-groups lists them, a group without lists its OS breakdown
  function groupRows(parent: string | null, indent: number): React.ReactNode {
    if (!tree) return null;
    const known = new Set(tree.groups.map((g) => g.id));
    const level = tree.groups.filter((g) => (g.parent_id && known.has(g.parent_id) ? g.parent_id : null) === parent);
    return level.map((group) => {
      const groupScope = { group: group.id, os: null, release: null };
      const groupKey = branchKey(groupScope);
      const subGroups = tree.groups.some((g) => g.parent_id === group.id);
      return (
        <div key={group.id}>
          <TreeRow
            label={group.name} icon={<FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />}
            total={group.total} online={group.online} indent={indent}
            expanded={expanded.has(groupKey)} onToggle={() => toggle(groupKey)}
            selected={selected(groupScope)} onPick={() => pick(groupScope, groupKey)}
            action={<RowLink href={`/groups/${group.id}`} label={t("fleetTree.manageGroup", { name: group.name })} />}
          />
          {expanded.has(groupKey) && (subGroups
            ? groupRows(group.id, indent + 1)
            : branchRows(group.id, group, indent + 1))}
        </div>
      );
    });
  }

  return (
    <nav aria-label={t("fleetTree.title")} className="text-sm select-none">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{t("fleetTree.title")}</h2>
        <button type="button" onClick={reload} title={t("common.refresh")} aria-label={t("common.refresh")}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {!tree ? (
        <p className="p-3 text-muted-foreground">{failed ? t("widgets.loadFailed") : t("common.loading")}</p>
      ) : (
        <div className="py-1">
          <TreeRow
            label={t("fleetTree.allNodes")} icon={<Server className="h-3.5 w-3.5 text-muted-foreground" />}
            total={tree.total} online={tree.online} indent={0}
            selected={selected(ALL_NODES)} onPick={() => selectScope(ALL_NODES)}
          />

          <TreeRow
            label={t("nav.groups")} icon={<FolderTree className="h-3.5 w-3.5 text-muted-foreground" />}
            indent={0} expanded={expanded.has("groups")} onToggle={() => toggle("groups")} onPick={() => toggle("groups")}
            action={<RowLink href="/groups" label={t("fleetTree.manageGroups")} />}
          />
          {expanded.has("groups") && (tree.groups.length === 0 ? (
            <p className="py-1 pr-2 text-xs text-muted-foreground" style={{ paddingLeft: 40 }}>{t("fleetTree.noGroups")}</p>
          ) : groupRows(null, 1))}

          {tree.unassigned.total > 0 && (() => {
            const unassignedScope = { group: UNASSIGNED, os: null, release: null };
            return (
              <div className="mt-1 border-t border-yellow-500/30 pt-1">
                <TreeRow
                  label={t("fleetTree.unassigned")} icon={<TriangleAlert className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-500" />}
                  total={tree.unassigned.total} online={tree.unassigned.online} indent={0} warning
                  expanded={expanded.has(UNASSIGNED)} onToggle={() => toggle(UNASSIGNED)}
                  selected={selected(unassignedScope)} onPick={() => pick(unassignedScope, UNASSIGNED)}
                />
                {expanded.has(UNASSIGNED) && branchRows(UNASSIGNED, tree.unassigned, 1)}
              </div>
            );
          })()}
        </div>
      )}
    </nav>
  );
}

function RowLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} title={label} aria-label={label} onClick={(e) => e.stopPropagation()}
      className="p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground">
      <Settings2 className="h-3.5 w-3.5" />
    </Link>
  );
}

interface TreeRowProps {
  label: string;
  icon?: React.ReactNode;
  total?: number;
  online?: number;
  indent: number;
  expanded?: boolean;
  onToggle?: () => void;
  selected?: boolean;
  onPick: () => void;
  action?: React.ReactNode;
  warning?: boolean;
}

/** One row: the chevron opens and closes it, the label picks it */
function TreeRow({ label, icon, total, online, indent, expanded, onToggle, selected, onPick, action, warning }: TreeRowProps) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "group flex items-center gap-1 py-1 pr-2 rounded-sm hover:bg-accent transition-colors",
        selected && "bg-accent border-l-2 border-primary font-medium",
        warning && "text-yellow-600 dark:text-yellow-500",
      )}
      style={{ paddingLeft: indent * 12 + 4 }}
    >
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={!!expanded} aria-label={t("fleetTree.toggle", { name: label })}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground shrink-0">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button type="button" onClick={onPick} aria-current={selected ? "true" : undefined}
        className="flex flex-1 min-w-0 items-center gap-1.5 text-left">
        {icon}
        <span className="truncate" title={label}>{label}</span>
        {total !== undefined && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground"
            title={t("nodes.onlineSummary", { online: online ?? 0, total })}>
            {total}
          </span>
        )}
      </button>
      {action}
    </div>
  );
}
