"use client";
import { apiClient } from "@/lib/api-client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "@/components/ui-components";
import { Card, CardContent } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  Eye,
  Heart,
  Monitor,
  Package,
  Pause,
  Play,
  Search,
  Shield,
  Terminal,
  Wifi,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { formatNumber, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";

type AgentStatusName = "active" | "idle" | "stale" | "offline" | "unknown";

interface AgentRow {
  id: string | null;
  hostname: string;
  registered: boolean;
  reported_names: string[];
  os_name: string | null;
  agent_version: string | null;
  last_seen: string | null;
  seconds_ago: number | null;
  status: AgentStatusName;
  requests: number;
  errors: number;
  running_jobs: number;
  queued_jobs: number;
  pending_remediation: number;
  running_remediation: number;
}

interface StatusResponse {
  agents: AgentRow[];
  total: number;
  limit: number;
  offset: number;
  summary: Record<AgentStatusName, number> & { total: number; with_errors: number; running_jobs: number; remediation: number };
}

interface ActivityEvent {
  timestamp: string;
  ts: number;
  hostname: string;
  reported_name: string;
  node_id: string | null;
  action: string;
  detail: string;
  ip: string;
  status_code: number;
}

interface ActivityResponse {
  events: ActivityEvent[];
  matched: number;
  buffer: "node" | "errors" | "recent";
  buffer_size: number;
  oldest: string | null;
  total_requests: number;
  since_start: string;
}

const ACTIONS = [
  "job-poll", "terminal-poll", "shell-poll", "screen-poll", "remediation-poll",
  "live-data", "inventory-push", "health-report", "job-result", "remediation-result",
] as const;

const ACTION_ICONS: Record<string, any> = {
  "job-poll": ArrowDownToLine,
  "terminal-poll": Terminal,
  "shell-poll": Terminal,
  "screen-poll": Eye,
  "remediation-poll": Shield,
  "health-report": Heart,
  "live-data": Database,
  "inventory-push": Package,
  "remediation-result": Wrench,
  "job-result": Zap,
  poll: ArrowDownToLine,
};

const STATUS_STYLE: Record<AgentStatusName, { dot: string; text: string; pulse: boolean }> = {
  active: { dot: "bg-green-500", text: "text-green-500", pulse: true },
  idle: { dot: "bg-yellow-500", text: "text-yellow-500", pulse: false },
  stale: { dot: "bg-orange-500", text: "text-orange-500", pulse: false },
  offline: { dot: "bg-red-500", text: "text-red-500", pulse: false },
  unknown: { dot: "bg-muted-foreground", text: "text-muted-foreground", pulse: false },
};

const PAGE_SIZE = 50;
const POLL_MS = 5000;
const RANGES = { all: 0, "5m": 300, "15m": 900, "1h": 3600 } as const;
type RangeKey = keyof typeof RANGES;

interface NodeFilter { key: string; label: string }

export default function AgentMonitorPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);

  // agent list
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<"hostname" | "last_seen" | "errors">("hostname");
  const [offset, setOffset] = useState(0);

  // activity table
  const [node, setNode] = useState<NodeFilter | null>(null);
  const [action, setAction] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [range, setRange] = useState<RangeKey>("all");

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // search waits until typing pauses
  useEffect(() => {
    const h = setTimeout(() => { setSearch(searchInput.trim()); setOffset(0); }, 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  const fetchData = useCallback(async () => {
    const sp = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), sort, dir: sort === "hostname" ? "asc" : "desc" });
    if (search) sp.set("q", search);
    if (statusFilter) sp.set("status", statusFilter);
    const ap = new URLSearchParams({ limit: "500" });
    if (node) ap.set("node", node.key);
    if (action) ap.set("action", action);
    if (errorsOnly) ap.set("errors", "true");
    if (RANGES[range]) ap.set("since", String(Date.now() / 1000 - RANGES[range]));
    try {
      const [s, a] = await Promise.all([
        apiClient.get<StatusResponse>(`/admin/agent-status?${sp}`, { showErrorToast: false }),
        apiClient.get<ActivityResponse>(`/admin/agent-activity?${ap}`, { showErrorToast: false }),
      ]);
      if (s) setStatus(s);
      if (a) setActivity(a);
      setFailed(!s || !a);
      setUpdatedAt(new Date());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [offset, sort, search, statusFilter, node, action, errorsOnly, range]);

  // reload when a filter changes, then every 5 s while the page is visible and not paused
  useEffect(() => {
    fetchData();
    const timer = setInterval(() => {
      if (!pausedRef.current && document.visibilityState === "visible") fetchData();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchData]);

  const formatAgo = (seconds: number | null): string => {
    if (seconds === null) return t("agentMonitor.never");
    if (seconds < 5) return t("agentMonitor.justNow");
    if (seconds < 60) return t("agentMonitor.secondsAgo", { count: seconds });
    if (seconds < 3600) return t("agentMonitor.minutesAgo", { count: Math.floor(seconds / 60) });
    if (seconds < 172800) return t("agentMonitor.hoursAgo", { count: Math.floor(seconds / 3600) });
    return t("agentMonitor.daysAgo", { count: Math.floor(seconds / 86400) });
  };

  const actionLabel = (a: string) => (ACTIONS as readonly string[]).includes(a) ? t(`agentMonitor.actions.${a}`) : a;

  const selectAgent = (agent: AgentRow) => {
    const key = agent.id || agent.hostname;
    setNode(node?.key === key ? null : { key, label: agent.hostname });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>;

  const summary = status?.summary;
  const agents = status?.agents || [];
  const total = status?.total || 0;
  const events = activity?.events || [];

  const bufferNote = activity
    ? activity.buffer === "node"
      ? t("agentMonitor.bufferNode", { count: activity.buffer_size })
      : activity.buffer === "errors"
        ? t("agentMonitor.bufferErrors", { count: formatNumber(activity.buffer_size) })
        : t("agentMonitor.bufferRecent", { count: formatNumber(activity.buffer_size) })
    : "";

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="h-8 w-8 text-green-500" />
            {t("agentMonitor.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("agentMonitor.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${failed ? "bg-red-500" : paused ? "bg-yellow-500" : "bg-green-500 animate-pulse"}`} />
          <span className="text-sm text-muted-foreground">
            {failed ? t("agentMonitor.notReachable") : paused ? t("agentMonitor.paused")
              : t("agentMonitor.updatedAt", { time: updatedAt ? formatTime(updatedAt, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-" })}
          </span>
          <button
            onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? t("agentMonitor.resume") : t("agentMonitor.pause")}
          </button>
        </div>
      </div>

      {/* Summary cards: all agents, independent of the filters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { icon: Wifi, color: "text-green-500", value: summary?.active ?? 0, label: t("agentMonitor.cards.active"), onClick: () => { setStatusFilter("active"); setOffset(0); } },
          { icon: Monitor, color: "text-blue-500", value: summary?.total ?? 0, label: t("agentMonitor.cards.total"), onClick: () => { setStatusFilter(""); setOffset(0); } },
          { icon: AlertTriangle, color: "text-red-500", value: summary?.with_errors ?? 0, label: t("agentMonitor.cards.withErrors"), onClick: () => { setStatusFilter("errors"); setOffset(0); } },
          { icon: Cpu, color: "text-yellow-500", value: summary?.running_jobs ?? 0, label: t("agentMonitor.cards.runningJobs") },
          { icon: Wrench, color: "text-purple-500", value: summary?.remediation ?? 0, label: t("agentMonitor.cards.remediation") },
        ].map((c) => (
          <Card key={c.label} className={c.onClick ? "cursor-pointer hover:bg-muted/30" : ""} onClick={c.onClick}>
            <CardContent className="p-4 flex items-center gap-3">
              <c.icon className={`h-8 w-8 ${c.color}`} />
              <div>
                <div className="text-2xl font-bold">{formatNumber(c.value)}</div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Agent list */}
        <div className="lg:col-span-4 xl:col-span-3 space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t("agentMonitor.agents", { count: formatNumber(total) })}
          </h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("agentMonitor.searchPlaceholder")}
              className="w-full rounded-md border bg-background pl-8 pr-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
              className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label={t("agentMonitor.statusFilter")}
            >
              <option value="">{t("agentMonitor.status.all")}</option>
              {(["active", "idle", "stale", "offline", "errors"] as const).map((s) => (
                <option key={s} value={s}>{t(`agentMonitor.status.${s}`)}</option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as typeof sort); setOffset(0); }}
              className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label={t("agentMonitor.sortBy")}
            >
              <option value="hostname">{t("agentMonitor.sort.hostname")}</option>
              <option value="last_seen">{t("agentMonitor.sort.lastSeen")}</option>
              <option value="errors">{t("agentMonitor.sort.errors")}</option>
            </select>
          </div>

          {agents.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">{t("agentMonitor.noAgents")}</p>
          )}
          {agents.map((agent) => {
            const sc = STATUS_STYLE[agent.status];
            const key = agent.id || agent.hostname;
            const isSelected = node?.key === key;
            const others = agent.reported_names.filter((n) => n.toLowerCase() !== agent.hostname.toLowerCase());
            return (
              <button
                key={key}
                onClick={() => selectAgent(agent)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                  isSelected ? "bg-primary text-primary-foreground ring-2 ring-primary" : "bg-card border hover:bg-muted/50"
                }`}
                title={t("agentMonitor.filterByAgent")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${sc.dot} ${sc.pulse ? "animate-pulse" : ""}`} />
                    <span className="font-semibold text-sm truncate">{agent.hostname}</span>
                  </div>
                  <span className={`text-xs shrink-0 ${isSelected ? "opacity-80" : sc.text}`}>{formatAgo(agent.seconds_ago)}</span>
                </div>
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                  {agent.registered
                    ? <span>{agent.agent_version ? `v${agent.agent_version}` : t("agentMonitor.noVersion")}</span>
                    : <span className="text-orange-500">{t("agentMonitor.notRegistered")}</span>}
                  {agent.running_jobs > 0 && (
                    <span className="flex items-center gap-1" title={t("agentMonitor.cards.runningJobs")}><Zap className="h-3 w-3" /> {agent.running_jobs}</span>
                  )}
                  {agent.pending_remediation + agent.running_remediation > 0 && (
                    <span className="flex items-center gap-1" title={t("agentMonitor.cards.remediation")}><Shield className="h-3 w-3" /> {agent.pending_remediation + agent.running_remediation}</span>
                  )}
                  {agent.errors > 0 && (
                    <span className={isSelected ? "" : "text-red-500"}>{t("agentMonitor.errorCount", { count: formatNumber(agent.errors) })}</span>
                  )}
                  <span className="ml-auto">{t("agentMonitor.requestCount", { count: formatNumber(agent.requests) })}</span>
                </div>
                {others.length > 0 && (
                  <div className={`mt-0.5 text-xs truncate ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                    {t("agentMonitor.alsoReportsAs", { names: others.join(", ") })}
                  </div>
                )}
              </button>
            );
          })}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> {t("agentMonitor.previous")}
              </button>
              <span>{t("agentMonitor.range", { from: formatNumber(offset + 1), to: formatNumber(Math.min(offset + PAGE_SIZE, total)), total: formatNumber(total) })}</span>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 disabled:opacity-40"
              >
                {t("agentMonitor.next")} <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* Activity table */}
        <div className="lg:col-span-8 xl:col-span-9 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 mr-2">
              <Activity className="h-4 w-4 text-green-500" />
              {t("agentMonitor.activity")}
            </h2>
            {node && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium">
                {node.label}
                <button onClick={() => setNode(null)} aria-label={t("agentMonitor.clearAgentFilter")}><X className="h-3 w-3" /></button>
              </span>
            )}
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label={t("agentMonitor.actionFilter")}
            >
              <option value="">{t("agentMonitor.allActions")}</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </select>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label={t("agentMonitor.timeRange")}
            >
              {(Object.keys(RANGES) as RangeKey[]).map((r) => <option key={r} value={r}>{t(`agentMonitor.ranges.${r}`)}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
              {t("agentMonitor.errorsOnly")}
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              {t("agentMonitor.eventCount", { count: formatNumber(activity?.matched ?? 0) })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{bufferNote}</p>
          <Card>
            <CardContent className="p-0">
              <div className="h-[calc(100vh-420px)] min-h-[400px] overflow-y-auto">
                {events.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>{node ? t("agentMonitor.noActivityFor", { name: node.label }) : t("agentMonitor.noActivity")}</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr className="text-xs text-muted-foreground">
                        <th className="text-left py-2 px-3 w-[90px]">{t("agentMonitor.columns.time")}</th>
                        <th className="w-[30px]"></th>
                        <th className="text-left py-2 px-3">{t("agentMonitor.columns.agent")}</th>
                        <th className="text-left py-2 px-3">{t("agentMonitor.columns.action")}</th>
                        <th className="text-left py-2 px-3">{t("agentMonitor.columns.ip")}</th>
                        <th className="text-right py-2 px-3 w-[60px]">{t("agentMonitor.columns.status")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {events.map((evt, idx) => {
                        const IconComp = ACTION_ICONS[evt.action] || Activity;
                        const isError = evt.status_code >= 400;
                        const key = evt.node_id || evt.reported_name;
                        return (
                          <tr key={`${evt.ts}-${idx}`} className={`hover:bg-muted/50 transition-colors ${isError ? "bg-red-500/5" : ""}`}>
                            <td className="py-1.5 px-3 font-mono text-xs text-muted-foreground">
                              {formatTime(new Date(evt.timestamp), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </td>
                            <td className="py-1.5 px-1">
                              <IconComp className={`h-3.5 w-3.5 ${isError ? "text-red-500" : "text-muted-foreground"}`} />
                            </td>
                            <td className="py-1.5 px-3">
                              <button
                                onClick={() => setNode(node?.key === key ? null : { key, label: evt.hostname })}
                                className="font-medium hover:text-primary transition-colors text-left"
                                title={evt.reported_name !== evt.hostname ? t("agentMonitor.reportedAs", { name: evt.reported_name }) : undefined}
                              >
                                {evt.hostname}
                              </button>
                              {!evt.node_id && <span className="ml-2 text-xs text-orange-500">{t("agentMonitor.notRegistered")}</span>}
                            </td>
                            <td className="py-1.5 px-3">
                              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                isError ? "bg-red-500/10 text-red-500" :
                                evt.action.includes("result") ? "bg-green-500/10 text-green-500" :
                                evt.action.includes("health") || evt.action.includes("live") || evt.action.includes("inventory") ? "bg-blue-500/10 text-blue-500" :
                                evt.action.includes("remediation") ? "bg-purple-500/10 text-purple-500" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {actionLabel(evt.action)}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-xs text-muted-foreground font-mono">{evt.ip}</td>
                            <td className="py-1.5 px-3 text-right">
                              <span className={`text-xs font-mono ${isError ? "text-red-500 font-bold" : "text-muted-foreground"}`}>{evt.status_code}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
