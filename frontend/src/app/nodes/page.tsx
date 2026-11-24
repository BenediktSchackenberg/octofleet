"use client";
import { apiClient } from "@/lib/api-client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/components/ui-components";
import { StatusBadge, statusToVariant } from "@/components/ui/StatusBadge";
import { Check, X, Clock, Monitor, LayoutGrid, List, Plus, Server, FolderTree } from "lucide-react";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { StandardPage } from "@/components/ui/StandardPage";
import { NodeRemovalStatus } from "@/components/node-removal";
import { useI18n } from "@/lib/i18n-context";
import { useFleetTree } from "@/components/fleet/FleetTree";
import { ALL_NODES, UNASSIGNED, scopeGroupName, scopeNodeIds } from "@/lib/fleet-scope";
import { DEFAULT_DIR, NODE_SORTS, sortFromSearch, sortNodes, sortToUrl, type NodeSort, type SortDir } from "@/lib/node-sort";

type Translate = ReturnType<typeof useI18n>["t"];



interface Node {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  is_online: boolean;
  last_seen: string;
  agent_version: string;
  cpu_name: string | null;
  total_memory_gb: number | null;
  health_status?: 'healthy' | 'warning' | 'critical';
  alert_count?: number;
  removal_state?: 'uninstall_pending' | 'uninstall_failed' | 'uninstalled' | null;
}

interface PendingNode {
  id: string;
  hostname: string;
  osName: string;
  osVersion: string;
  ipAddress: string;
  agentVersion: string;
  machineId: string | null;
  createdAt: string;
}

/** A column header of the list that sorts by its column (again: the other direction) */
function SortHeader({ sort, label, className = "", order, onSort }: {
  sort: NodeSort; label: string; className?: string; order: { sort: NodeSort; dir: SortDir }; onSort: (sort: NodeSort) => void;
}) {
  const active = order.sort === sort;
  return (
    <th className={`p-4 ${className}`} aria-sort={active ? (order.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(sort)} className={`inline-flex items-center gap-1 hover:text-white ${active ? "text-zinc-100" : ""}`}>
        {label}{active && <span aria-hidden>{order.dir === "asc" ? "\u25b2" : "\u25bc"}</span>}
      </button>
    </th>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        online ? "bg-green-500" : "bg-zinc-500"
      }`}
    />
  );
}

function HealthBadge({ status, count }: { status?: string; count?: number }) {
  if (!status || status === 'healthy') return null;
  
  const colors = {
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    critical: 'bg-red-500/20 text-red-400 border-red-500/50'
  };
  
  const icons = { warning: '⚠️', critical: '🔴' };
  
  return (
    <span className={`ml-2 px-2 py-0.5 text-xs rounded border ${colors[status as keyof typeof colors] || ''}`}>
      {icons[status as keyof typeof icons]} {count || 1}
    </span>
  );
}

function formatLastSeen(dateStr: string, t: Translate): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t("time.now");
  if (diffMin < 60) return t("time.minutesAgo", { minutes: diffMin });
  if (diffHours < 24) return t("time.hoursAgo", { hours: diffHours });
  return t("time.daysAgo", { days: diffDays });
}

function PendingNodesSection({ 
  pendingNodes, 
  onApprove, 
  onReject,
  approving 
}: { 
  pendingNodes: PendingNode[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  approving: string | null;
}) {
  const { t } = useI18n();
  if (pendingNodes.length === 0) return null;

  return (
    <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-5 w-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-amber-400">
          {t("nodes.pendingApprovals", { count: pendingNodes.length })}
        </h2>
      </div>
      
      <div className="space-y-3">
        {pendingNodes.map((node) => (
          <div 
            key={node.id}
            className="bg-zinc-900/80 rounded-lg p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <Monitor className="h-8 w-8 text-amber-400" />
              <div>
                <div className="font-medium text-zinc-100">{node.hostname}</div>
                <div className="text-sm text-zinc-400">
                  {node.osName} • {node.ipAddress} • {t("nodes.agentVersionShort", { version: node.agentVersion || "?" })}
                </div>
                <div className="text-xs text-zinc-500">
                  {t("nodes.registered", { time: formatLastSeen(node.createdAt, t) })}
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(node.id)}
                disabled={approving === node.id}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-800 text-white rounded-lg transition-colors"
              >
                {approving === node.id ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {t("nodes.approve")}
              </button>
              <button
                onClick={() => onReject(node.id)}
                disabled={approving === node.id}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-red-600 text-zinc-300 hover:text-white rounded-lg transition-colors"
              >
                <X className="h-4 w-4" />
                {t("nodes.reject")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NodesPage() {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [pendingNodes, setPendingNodes] = useState<PendingNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("octofleet-nodes-view") as "list" | "grid") || "grid";
    return "grid";
  });
  const router = useRouter();
  // The order the user picked (?sort=&dir=); read after mounting, Back/Forward follow the URL
  const [order, setOrder] = useState<{ sort: NodeSort; dir: SortDir }>({ sort: "name", dir: "asc" });
  useEffect(() => {
    const read = () => setOrder(sortFromSearch(window.location.search));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  /** Sort by a column: the same column again flips the direction; each change is a history entry */
  function sortBy(sort: NodeSort, dir?: SortDir) {
    const next = { sort, dir: dir ?? (sort === order.sort ? (order.dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[sort]) };
    setOrder(next);
    const url = sortToUrl(window.location.href, next.sort, next.dir);
    if (url !== window.location.href) window.history.pushState(window.history.state, "", url);
  }

  useEffect(() => {
    fetchNodes();
    fetchPendingNodes();
  }, []);

  // Follow open removal requests until the agent answers (#160)
  const removalPending = nodes.some((n) => n.removal_state === "uninstall_pending");
  useEffect(() => {
    if (!removalPending) return;
    const timer = setInterval(fetchNodes, 10000);
    return () => clearInterval(timer);
  }, [removalPending]);

  async function fetchNodes() {
    try {
      const data = await apiClient.get<{ nodes: Node[] }>(`/nodes`, { showErrorToast: false });
      setNodes(data?.nodes || []);
    } catch (err) {
      console.error("Failed to fetch nodes:", err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPendingNodes() {
    try {
      const data = await apiClient.get<{ pending: PendingNode[] }>(`/pending-nodes`, { showErrorToast: false });
      setPendingNodes(data?.pending || []);
    } catch (err) {
      console.error("Failed to fetch pending nodes:", err);
    }
  }

  async function handleApprove(pendingId: string) {
    setApproving(pendingId);
    try {
      const res = await apiClient.post(`/pending-nodes/${pendingId}/approve`, {}, { showErrorToast: false });
      
      if (res) {
        // Refresh both lists
        await fetchPendingNodes();
        await fetchNodes();
      } else {
        console.error("Failed to approve node");
      }
    } catch (err) {
      console.error("Failed to approve node:", err);
    } finally {
      setApproving(null);
    }
  }

  async function handleReject(pendingId: string) {
    if (!confirm(t("nodes.rejectConfirm"))) return;
    
    setApproving(pendingId);
    try {
      const res = await apiClient.delete(`/pending-nodes/${pendingId}/reject`, { showErrorToast: false });
      
      if (res) {
        await fetchPendingNodes();
      }
    } catch (err) {
      console.error("Failed to reject node:", err);
    } finally {
      setApproving(null);
    }
  }

  // The branch picked in the Fleet tree (?group=&os=&release=); null: all nodes
  const { tree, loading: treeLoading, scope, selectScope } = useFleetTree();
  const inScope = useMemo(() => scopeNodeIds(tree, scope), [tree, scope]);
  const scopedNodes = inScope ? nodes.filter((n) => inScope.has(n.node_id)) : nodes;
  const scopeLabel = scope.group
    ? [scope.group === UNASSIGNED ? t("fleetTree.unassigned") : scopeGroupName(tree, scope) ?? t("fleetTree.unknownGroup"), scope.os, scope.release]
        .filter(Boolean).join(" › ")
    : null;

  const filteredNodes = sortNodes(scopedNodes.filter(
    (node) => {
      const matchesSearch = node.hostname.toLowerCase().includes(search.toLowerCase()) ||
        node.node_id.toLowerCase().includes(search.toLowerCase()) ||
        (node.os_name && node.os_name.toLowerCase().includes(search.toLowerCase()));
      
      const matchesIssueFilter = !showOnlyIssues || 
        (node.health_status && node.health_status !== 'healthy');
      
      return matchesSearch && matchesIssueFilter;
    }
  ), order.sort, order.dir);

  const onlineCount = scopedNodes.filter((n) => n.is_online).length;
  const issueCount = scopedNodes.filter((n) => n.health_status && n.health_status !== 'healthy').length;

  return (
    <StandardPage
      title={scopeLabel ?? t("nodes.devices")}
      description={`${t("nodes.onlineSummary", { online: onlineCount, total: scopedNodes.length })}${!scopeLabel && pendingNodes.length > 0 ? ` • ${t("nodes.pendingSummary", { count: pendingNodes.length })}` : ""}`}
      icon={<Server className="h-6 w-6" />}
      loading={loading || (!!scope.group && !tree && treeLoading)}
      actions={
        <div className="flex gap-2">
          <OnboardingDialog trigger={
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-colors text-sm font-medium">
              <Plus className="h-4 w-4" /> {t("nodes.addDevice")}
            </button>
          } />
          <button
            onClick={() => { setViewMode("list"); localStorage.setItem("octofleet-nodes-view", "list"); }}
            className={`p-2 rounded-lg border transition-colors ${viewMode === "list" ? "bg-zinc-700 border-zinc-600 text-white" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white"}`}
            title={t("nodes.listView")}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setViewMode("grid"); localStorage.setItem("octofleet-nodes-view", "grid"); }}
            className={`p-2 rounded-lg border transition-colors ${viewMode === "grid" ? "bg-zinc-700 border-zinc-600 text-white" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-white"}`}
            title={t("nodes.gridView")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      }
      filters={
        <div className="flex flex-wrap gap-4 items-center">
          {scopeLabel && (
            <span className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-full border border-zinc-700 bg-zinc-800/50 text-sm text-zinc-200">
              <FolderTree className="h-3.5 w-3.5 text-zinc-400" /> {scopeLabel}
              <button type="button" onClick={() => selectScope(ALL_NODES)} title={t("fleetTree.showAll")} aria-label={t("fleetTree.showAll")}
                className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <input
            type="text"
            placeholder={`${t("common.search")}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full md:w-80 px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            {t("nodes.sortBy")}
            <select value={order.sort} onChange={(e) => sortBy(e.target.value as NodeSort, DEFAULT_DIR[e.target.value as NodeSort])}
              className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100">
              {NODE_SORTS.map((s) => <option key={s} value={s}>{t(`nodes.sort.${s}`)}</option>)}
            </select>
            <button type="button" onClick={() => sortBy(order.sort, order.dir === "asc" ? "desc" : "asc")}
              title={t(order.dir === "asc" ? "nodes.sortAscending" : "nodes.sortDescending")}
              aria-label={t(order.dir === "asc" ? "nodes.sortAscending" : "nodes.sortDescending")}
              className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 hover:border-zinc-500">
              {order.dir === "asc" ? "▲" : "▼"}
            </button>
          </label>
          {issueCount > 0 && (
            <button
              onClick={() => setShowOnlyIssues(!showOnlyIssues)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                showOnlyIssues 
                  ? 'bg-red-500/20 border-red-500 text-red-400' 
                  : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-red-500'
              }`}
            >
              🔴 {t("nodes.onlyProblems", { count: issueCount })}
            </button>
          )}
        </div>
      }
    >
        {/* Pending Nodes Section (on the whole fleet only: waiting nodes are in no branch yet) */}
        <PendingNodesSection 
          pendingNodes={scopeLabel ? [] : pendingNodes}
          onApprove={handleApprove}
          onReject={handleReject}
          approving={approving}
        />

        {/* Nodes View */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredNodes.map((node) => {
              const healthColor = node.health_status === "critical" ? "border-l-red-500" : node.health_status === "warning" ? "border-l-yellow-500" : "border-l-green-500";
              const osIcon = node.os_name?.toLowerCase().includes("windows") ? "🪟" : node.os_name?.toLowerCase().includes("linux") ? "🐧" : "🖥️";
              return (
                <div
                  key={node.id}
                  onClick={() => router.push(`/nodes/${node.node_id}`)}
                  className={`bg-zinc-900 border border-zinc-800 border-l-4 ${healthColor} rounded-lg p-4 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{osIcon}</span>
                      <span className="font-semibold text-zinc-100">{node.hostname}</span>
                    </div>
                    <span className={`w-2.5 h-2.5 rounded-full mt-1 ${node.is_online ? "bg-green-500 animate-pulse" : "bg-zinc-500"}`} />
                  </div>
                  <div className="text-xs text-zinc-400 space-y-1">
                    <div>{node.os_name}</div>
                    <div className="flex justify-between">
                      <span>{t("nodes.agentVersionShort", { version: node.agent_version || "-" })}</span>
                      <span>{formatLastSeen(node.last_seen, t)}</span>
                    </div>
                  </div>
                  {node.health_status && node.health_status !== "healthy" && (
                    <HealthBadge status={node.health_status} count={node.alert_count} />
                  )}
                  <NodeRemovalStatus nodeId={node.node_id} state={node.removal_state} onChanged={fetchNodes} />
                </div>
              );
            })}
            {filteredNodes.length === 0 && (
              <div className="col-span-full text-center py-8 text-zinc-500">
                {search ? t("nodes.noNodes") : scopeLabel ? t("fleetTree.emptyBranch") : t("nodes.noNodesYet")}
              </div>
            )}
          </div>
        ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                <SortHeader order={order} onSort={sortBy} sort="status" label={t("common.status")} />
                <SortHeader order={order} onSort={sortBy} sort="name" label={t("nodes.hostname")} />
                <SortHeader order={order} onSort={sortBy} sort="os" label={t("nodes.os")} className="hidden md:table-cell" />
                <SortHeader order={order} onSort={sortBy} sort="agent" label={t("nodes.agent")} className="hidden lg:table-cell" />
                <SortHeader order={order} onSort={sortBy} sort="last_seen" label={t("nodes.lastSeen")} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredNodes.map((node) => (
                <tr
                  key={node.id}
                  className="hover:bg-zinc-800/50 transition-colors"
                >
                  <td className="p-4">
                    <StatusBadge variant={statusToVariant(node.is_online ? 'online' : 'offline')} dot>
                      {node.is_online ? t("common.online") : t("common.offline")}
                    </StatusBadge>
                  </td>
                  <td className="p-4">
                    <Link
                      href={`/nodes/${node.node_id}`}
                      className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {node.hostname}
                    </Link>
                    <HealthBadge status={node.health_status} count={node.alert_count} />
                    <NodeRemovalStatus nodeId={node.node_id} state={node.removal_state} onChanged={fetchNodes} />
                  </td>
                  <td className="p-4 hidden md:table-cell text-sm text-zinc-400">
                    {node.os_name}
                  </td>
                  <td className="p-4 hidden lg:table-cell text-sm text-zinc-500">
                    {node.agent_version || "-"}
                  </td>
                  <td className="p-4 text-sm text-zinc-500">
                    {formatLastSeen(node.last_seen, t)}
                  </td>
                </tr>
              ))}

              {filteredNodes.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">
                    {search ? t("nodes.noNodes") : scopeLabel ? t("fleetTree.emptyBranch") : t("nodes.noNodesYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
    </StandardPage>
  );
}
