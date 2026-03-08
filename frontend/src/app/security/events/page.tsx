"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Activity, Monitor, Network, Key, Shield, Server, FileText, RefreshCw,
  ArrowUpDown, ChevronLeft, ChevronRight, Search, Filter, AlertTriangle
} from "lucide-react";

interface NormalizedEvent {
  id?: string;
  ts: string;
  node_id: string;
  user_id: string;
  event_type: string;
  severity: string;
  payload: Record<string, unknown> | string;
}

interface FileEvent {
  id?: number;
  ts: string;
  node_id: string;
  user_id: string;
  op: string;
  path: string;
  old_path?: string;
  process_name?: string;
  pid?: number;
  hash_after?: string;
  file_size?: number;
  success?: boolean;
}

interface EventStats {
  event_type: string;
  count: number;
}

type TabKey = "all" | "logon" | "process" | "network" | "registry" | "service" | "file";

const TABS: { key: TabKey; label: string; icon: React.ElementType; filter?: string; color: string }[] = [
  { key: "all", label: "All Events", icon: Activity, color: "purple" },
  { key: "logon", label: "Logon Events", icon: Key, filter: "logon", color: "blue" },
  { key: "process", label: "Process Monitor", icon: Monitor, filter: "process", color: "green" },
  { key: "network", label: "Network Monitor", icon: Network, filter: "network", color: "cyan" },
  { key: "registry", label: "Registry Monitor", icon: Shield, filter: "registry", color: "orange" },
  { key: "service", label: "Service Changes", icon: Server, filter: "service", color: "red" },
  { key: "file", label: "File Audit", icon: FileText, filter: "file", color: "yellow" },
];

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-blue-500/15 text-blue-400",
  info: "bg-zinc-700 text-zinc-400",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  "logon.success": "Logon Success",
  "logon.failed": "Logon Failed",
  "logon.logoff": "Logoff",
  "logon.explicit_creds": "Explicit Credentials",
  "logon.special_privs": "Special Privileges",
  "process.create": "Process Created",
  "process.terminate": "Process Terminated",
  "network.connect": "Connection Established",
  "network.close": "Connection Closed",
  "network.listen": "Listening Port",
  "registry.value_set": "Registry Value Set",
  "registry.key_create": "Registry Key Created",
  "registry.key_delete": "Registry Key Deleted",
  "registry.drift": "Registry Drift Detected",
  "service.install": "Service Installed",
  "service.remove": "Service Removed",
  "service.start": "Service Started",
  "service.stop": "Service Stopped",
  "service.config_change": "Service Config Changed",
};

function parsePayload(p: unknown): Record<string, unknown> {
  if (!p) return {};
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return {}; } }
  return p as Record<string, unknown>;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function PayloadDetail({ payload, eventType }: { payload: Record<string, unknown>; eventType: string }) {
  if (eventType.startsWith("logon")) {
    const user = payload.user as Record<string, string> | undefined;
    const meta = payload.metadata as Record<string, unknown> | undefined;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {user?.username && <span>User: <span className="text-zinc-200">{user.username}</span></span>}
        {user?.domain && <span>Domain: <span className="text-zinc-200">{user.domain}</span></span>}
        {payload.logon_type && <span>Type: <span className="text-zinc-200">{String(payload.logon_type)}</span></span>}
        {payload.source_ip && <span>Source: <span className="text-zinc-200">{String(payload.source_ip)}</span></span>}
        {payload.failure_reason && <span className="text-red-400">Reason: {String(payload.failure_reason)}</span>}
        {meta?.brute_force && <span className="text-red-400 font-medium">⚠ Brute force detected</span>}
      </div>
    );
  }
  if (eventType.startsWith("process")) {
    const proc = payload.process as Record<string, unknown> | undefined;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {proc?.name && <span>Process: <span className="text-zinc-200">{String(proc.name)}</span></span>}
        {proc?.pid && <span>PID: <span className="text-zinc-200">{String(proc.pid)}</span></span>}
        {proc?.parent_pid && <span>Parent: <span className="text-zinc-200">{String(proc.parent_pid)}</span></span>}
        {proc?.command_line && <span className="truncate max-w-xs">CMD: <span className="text-zinc-200 font-mono">{String(proc.command_line)}</span></span>}
        {proc?.path && <span className="truncate max-w-xs">Path: <span className="text-zinc-200 font-mono">{String(proc.path)}</span></span>}
      </div>
    );
  }
  if (eventType.startsWith("network")) {
    const net = payload.network as Record<string, unknown> | undefined;
    const proc = payload.process as Record<string, unknown> | undefined;
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {net?.local_address && <span>Local: <span className="text-zinc-200">{String(net.local_address)}:{String(net.local_port)}</span></span>}
        {net?.remote_address && <span>Remote: <span className="text-zinc-200">{String(net.remote_address)}:{String(net.remote_port)}</span></span>}
        {net?.state && <span>State: <span className="text-zinc-200">{String(net.state)}</span></span>}
        {proc?.name && <span>Process: <span className="text-zinc-200">{String(proc.name)}</span></span>}
      </div>
    );
  }
  if (eventType.startsWith("registry")) {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {payload.hive && <span>Hive: <span className="text-zinc-200">{String(payload.hive)}</span></span>}
        {payload.key_path && <span className="truncate max-w-md">Key: <span className="text-zinc-200 font-mono">{String(payload.key_path)}</span></span>}
        {payload.value_name && <span>Value: <span className="text-zinc-200">{String(payload.value_name)}</span></span>}
      </div>
    );
  }
  if (eventType.startsWith("service")) {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {payload.service_name && <span>Service: <span className="text-zinc-200">{String(payload.service_name)}</span></span>}
        {payload.display_name && <span>Display: <span className="text-zinc-200">{String(payload.display_name)}</span></span>}
        {payload.state && <span>State: <span className="text-zinc-200">{String(payload.state)}</span></span>}
        {payload.previous_state && <span>Previous: <span className="text-zinc-200">{String(payload.previous_state)}</span></span>}
        {payload.start_type && <span>Start: <span className="text-zinc-200">{String(payload.start_type)}</span></span>}
        {payload.suspicious && <span className="text-red-400 font-medium">⚠ Suspicious path</span>}
      </div>
    );
  }
  // Generic fallback
  const keys = Object.keys(payload).filter(k => !["process","user","network","metadata","event_subtype"].includes(k));
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
      {keys.slice(0, 5).map(k => (
        <span key={k}>{k}: <span className="text-zinc-200">{String(payload[k]).slice(0, 60)}</span></span>
      ))}
    </div>
  );
}

export default function SecurityEventsPage() {
  const [tab, setTab] = useState<TabKey>("all");
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [fileEvents, setFileEvents] = useState<FileEvent[]>([]);
  const [stats, setStats] = useState<EventStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [page, setPage] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { token } = useAuth();
  const PAGE_SIZE = 50;

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);

    // Fetch stats
    const statsData = await apiClient.get<{ stats: EventStats[] }>("/events/stats", { showErrorToast: false });

    if (tab === "file") {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (nodeFilter) params.set("node_id", nodeFilter);
      if (search) params.set("path", search);
      const data = await apiClient.get<{ events: FileEvent[] }>(`/events/files?${params}`, { showErrorToast: false });
      setFileEvents(data?.events || []);
    } else {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const typeFilter = TABS.find(t => t.key === tab)?.filter;
      if (typeFilter) params.set("type_prefix", typeFilter);
      if (nodeFilter) params.set("node_id", nodeFilter);
      if (search) params.set("search", search);
      const data = await apiClient.get<{ events: NormalizedEvent[] }>(`/events?${params}`, { showErrorToast: false });
      setEvents(data?.events || []);
    }

    setStats(statsData?.stats || []);
    setLoading(false);
  }, [token, tab, page, nodeFilter, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(fetchData, 15000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchData]);

  const totalByTab = (key: TabKey): number => {
    if (key === "all") return stats.reduce((s, e) => s + e.count, 0);
    const prefix = TABS.find(t => t.key === key)?.filter;
    if (!prefix) return 0;
    return stats.filter(e => e.event_type.startsWith(prefix)).reduce((s, e) => s + e.count, 0);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Activity className="h-8 w-8 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold">Security Events</h1>
              <p className="text-zinc-400 text-sm">Real-time security sensor data from all monitored nodes</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                autoRefresh ? "bg-green-500/15 text-green-400 border border-green-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700"
              }`}>
              {autoRefresh ? "● Live" : "○ Paused"}
            </button>
            <button onClick={() => { setPage(0); fetchData(); }}
              className="p-2 text-zinc-400 hover:text-white transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {TABS.map(t => {
            const count = totalByTab(t.key);
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setPage(0); }}
                className={`p-3 rounded-xl border transition-all text-left ${
                  tab === t.key
                    ? `bg-${t.color}-500/10 border-${t.color}-500/30`
                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                }`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${tab === t.key ? `text-${t.color}-400` : "text-zinc-500"}`} />
                  <span className="text-xs text-zinc-400">{t.label}</span>
                </div>
                <span className="text-lg font-bold">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder={tab === "file" ? "Search by path..." : "Search events..."}
              className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              value={nodeFilter} onChange={e => { setNodeFilter(e.target.value); setPage(0); }}
              placeholder="Filter by node..."
              className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Events Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
          </div>
        ) : tab === "file" ? (
          /* File Events Table */
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="text-left p-3">Time</th>
                  <th className="text-left p-3">Node</th>
                  <th className="text-left p-3">Operation</th>
                  <th className="text-left p-3">Path</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Process</th>
                  <th className="text-right p-3">Size</th>
                </tr>
              </thead>
              <tbody>
                {fileEvents.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-zinc-500">No file events found</td></tr>
                ) : fileEvents.map((e, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-3 text-zinc-400 whitespace-nowrap" title={e.ts}>{relativeTime(e.ts)}</td>
                    <td className="p-3 font-medium">{e.node_id}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        e.op.includes("delete") ? "bg-red-500/15 text-red-400" :
                        e.op.includes("create") ? "bg-green-500/15 text-green-400" :
                        e.op.includes("write") || e.op.includes("modify") ? "bg-amber-500/15 text-amber-400" :
                        e.op.includes("rename") ? "bg-blue-500/15 text-blue-400" :
                        "bg-zinc-700 text-zinc-300"
                      }`}>{e.op}</span>
                    </td>
                    <td className="p-3 font-mono text-xs max-w-md truncate" title={e.path}>{e.path}</td>
                    <td className="p-3 text-zinc-400">{e.user_id}</td>
                    <td className="p-3 text-zinc-400 text-xs">{e.process_name || "—"}</td>
                    <td className="p-3 text-right text-zinc-500 text-xs">{e.file_size ? `${(e.file_size / 1024).toFixed(1)}KB` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Normalized Events Table */
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                  <th className="text-left p-3">Time</th>
                  <th className="text-left p-3">Severity</th>
                  <th className="text-left p-3">Node</th>
                  <th className="text-left p-3">Event Type</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-zinc-500">No events found</td></tr>
                ) : events.map((e, i) => {
                  const payload = parsePayload(e.payload);
                  return (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="p-3 text-zinc-400 whitespace-nowrap" title={e.ts}>{relativeTime(e.ts)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${SEVERITY_COLORS[e.severity] || SEVERITY_COLORS.info}`}>
                          {e.severity}
                        </span>
                      </td>
                      <td className="p-3 font-medium">{e.node_id}</td>
                      <td className="p-3">
                        <span className="text-xs font-medium">{EVENT_TYPE_LABELS[e.event_type] || e.event_type}</span>
                      </td>
                      <td className="p-3 text-zinc-400 text-xs">{e.user_id || "—"}</td>
                      <td className="p-3"><PayloadDetail payload={payload} eventType={e.event_type} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-zinc-500">
            Page {page + 1} • Showing {PAGE_SIZE} events per page
          </span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs disabled:opacity-30 hover:bg-zinc-700 transition-colors">
              <ChevronLeft className="h-4 w-4 inline" /> Prev
            </button>
            <button onClick={() => setPage(page + 1)}
              className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs hover:bg-zinc-700 transition-colors">
              Next <ChevronRight className="h-4 w-4 inline" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
