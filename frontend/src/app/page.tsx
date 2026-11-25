"use client";

import { useState, useEffect, useMemo } from "react";
import { OsDistributionChart } from "@/components/OsDistributionChart";
import { getAuthHeader } from "@/lib/auth-context";
import { apiClient } from "@/lib/api-client";
import { JOB_FAILURES_PATH } from "@/lib/tasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Package, Briefcase, FolderTree, RefreshCw, Activity, AlertCircle, Monitor, Shield, TrendingUp, Plus, Bug, Bell as BellIcon, Zap, Star, Clock } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";
import { useRecentlyOpened } from "@/hooks/useRecentlyOpened";
import { useAuth } from "@/lib/auth-context";
import { RoleDashboard, type DashboardRole } from "@/components/dashboard/RoleDashboard";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from "recharts";
import { toast } from "sonner";
import { formatLocalDate, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";
import { VulnerabilitySummaryFreshness } from "@/components/vulnerability-summary-freshness";
import { routeLabel } from "@/lib/routes";
import { CRIT_PERCENT, WARN_PERCENT, performanceHref, worstMetric } from "@/lib/node-health";

// Skeleton Components for Loading State
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div>
      {/* Header Skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-24" />
      </div>

      {/* KPI Cards Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Metrics Skeleton */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-32 mb-2" />
              <Skeleton className="h-8 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface DashboardSummary {
  counts: {
    total: number;
    online: number;
    away: number;
    offline: number;
    unassigned: number;
  };
  recent_events: Array<{
    type: string;
    subject: string;
    subject_id: string;
    timestamp: string | null;
  }>;
  vulnerabilities?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    /** From the cached vulnerability summary: as of when, and when the last scan finished */
    as_of?: string | null;
    refreshing?: boolean;
    pending_nodes?: number;
    scan_completed_at?: string | null;
  };
  jobs?: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    success: number;
  };
}

interface MetricsSummary {
  nodesWithMetrics: number;
  totalNodes: number;
  fleetAverages: {
    cpuPercent: number | null;
    ramPercent: number | null;
    diskPercent: number | null;
  };
  nodes: Array<{
    nodeId: string;
    hostname: string;
    cpuPercent: number | null;
    ramPercent: number | null;
    diskPercent: number | null;
  }>;
}

export default function HomePage() {
  const { isAdmin, user } = useAuth();
  const { t } = useI18n();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<{timeseries: Array<{time: string; cpu: number; ram: number; disk: number; nodes: number}>; current: {cpu: number; ram: number; disk: number}} | null>(null);
  const [sqlCatalog, setSqlCatalog] = useState<{versions: Array<{version: string; count: number; latestCu: number}>; total: number} | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemHealth, setSystemHealth] = useState<{status: string, database: string} | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  // Jobs of the last 24 h, counted like the Jobs page the card links to (jobs, failed by failure time)
  const [jobCounts, setJobCounts] = useState<{ total: number; running: number; success: number; failed: number } | null>(null);
  const [showAllPerf, setShowAllPerf] = useState(false);
  const [taskCounts, setTaskCounts] = useState<{ approvals: number; findings: number; failedJobs: number; offline: number } | null>(null);
  const [eventStats, setEventStats] = useState<{ stats: Array<{ event_type: string; count: number }>; retention: any } | null>(null);
  const { favorites } = useFavorites();
  const { recent } = useRecentlyOpened();

  // Time-based greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return t("dashboard.greeting.morning");
    if (h >= 12 && h < 17) return t("dashboard.greeting.afternoon");
    if (h >= 17 && h < 22) return t("dashboard.greeting.evening");
    return t("dashboard.greeting.night");
  }, [t]);

  

  function getHeaders() {
    return getAuthHeader();
  }

  useEffect(() => {
    fetchSummary();
    fetchMetrics();
    fetchTimeseries();
    fetchSqlCatalog();
    fetchSystemHealth();
    fetchRecentAlerts();
    fetchTaskCounts();
    fetchJobCounts();
    fetchEventStats();
  }, []);

  async function fetchSummary() {
    try {
      const data = await apiClient.get<DashboardSummary>("/dashboard/summary");
      if (data) setSummary(data);
    } catch (e) {
      console.error("Failed to fetch summary:", e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSystemHealth() {
    const data = await apiClient.get<any>("/health", { showErrorToast: false });
    if (data) setSystemHealth(data);
    else setSystemHealth({ status: 'error', database: 'unknown' });
  }

  async function fetchRecentAlerts() {
    const data = await apiClient.get<any[]>("/alert-history?limit=5");
    if (data) setRecentAlerts(data);
  }

  async function fetchJobCounts() {
    const data = await apiClient.get<{ counts?: { total: number; running: number; success: number; failed: number } }>("/jobs?since_hours=24&limit=1", { showErrorToast: false });
    if (data?.counts) setJobCounts(data.counts);
  }

  async function fetchTaskCounts() {
    const c = { approvals: 0, findings: 0, failedJobs: 0, offline: 0 };
    const results = await Promise.allSettled([
      apiClient.get<{ pending: any[] }>("/pending-nodes"),
      apiClient.get<{ findings: any[]; total: number }>("/security/findings?severity=critical&limit=1"),
      apiClient.get<{ total?: number }>(`${JOB_FAILURES_PATH}&limit=1`, { showErrorToast: false }),
      apiClient.get<{ nodes: any[] }>("/nodes"),
    ]);
    if (results[0].status === "fulfilled" && results[0].value?.pending) c.approvals = results[0].value.pending.length;
    if (results[1].status === "fulfilled" && results[1].value) c.findings = results[1].value.total || results[1].value.findings?.length || 0;
    // Open job failures of the last 7 days - the same number as on the Tasks page the widget links to
    if (results[2].status === "fulfilled") c.failedJobs = results[2].value?.total || 0;
    if (results[3].status === "fulfilled" && results[3].value?.nodes) {
      // Offline by the server's node status (no contact for an hour) - the Fleet status card's number
      c.offline = results[3].value.nodes.filter((n: any) => n.status === "offline").length;
    }
    setTaskCounts(c);
  }

  async function fetchEventStats() {
    try {
      const data = await apiClient.get<{ stats: Array<{ event_type: string; count: number }>; retention: any }>("/events/stats?days=7");
      if (data) setEventStats(data);
    } catch (e) {
      console.error("Failed to fetch event stats:", e);
    }
  }

  async function fetchMetrics() {
    const data = await apiClient.get<MetricsSummary>("/metrics/summary");
    if (data) setMetrics(data);
  }

  async function fetchSqlCatalog() {
    const data = await apiClient.get<any>("/mssql/cumulative-updates");
    if (data) {
      const cus = data.cumulativeUpdates || [];
      const byVersion: Record<string, {count: number; latestCu: number}> = {};
      cus.forEach((cu: any) => {
        if (!byVersion[cu.version]) {
          byVersion[cu.version] = { count: 0, latestCu: 0 };
        }
        byVersion[cu.version].count++;
        if (cu.cu_number > byVersion[cu.version].latestCu) {
          byVersion[cu.version].latestCu = cu.cu_number;
        }
      });
      const versions = Object.entries(byVersion)
        .map(([version, data]) => ({ version, ...data }))
        .sort((a, b) => b.version.localeCompare(a.version));
      setSqlCatalog({ versions, total: cus.length });
    }
  }

  async function fetchTimeseries() {
    const data = await apiClient.get<any>("/metrics/timeseries?hours=1&bucket_minutes=5");
    if (data) setTimeseries(data);
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Area */}
        <main className="flex-1 overflow-y-auto p-6">
          {
            /* Dashboard Overview */
            loading ? (
              <DashboardSkeleton />
            ) : (
            <RoleDashboard role={((): DashboardRole => { const r = user?.roles?.[0]; return r === "admin" || r === "operator" || r === "auditor" || r === "viewer" ? r : "admin"; })()}>
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-extrabold tracking-tight text-foreground">{greeting}{user?.username ? `, ${user.username}` : ""}</h2>
                  <p className="text-muted-foreground flex items-center gap-2">
                    <Monitor className="h-4 w-4" /> {t("dashboard.fleetOverview")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="shadow-sm" onClick={() => { fetchSummary(); fetchMetrics(); fetchTimeseries(); fetchSqlCatalog(); fetchTaskCounts(); }}>
                    <RefreshCw className="h-4 w-4 mr-2" /> {t("common.refresh")}
                  </Button>
                </div>
              </div>

              {/* Today's Tasks Widget */}
              {taskCounts && (taskCounts.approvals + taskCounts.findings + taskCounts.failedJobs + taskCounts.offline > 0) && (
                <Card className="mb-6 border-zinc-800 bg-zinc-900/50">
                  <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                    <AlertCircle className="h-5 w-5 text-orange-400" />
                    <span className="text-sm font-medium text-foreground">{t("dashboard.todayTasks")}</span>
                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      {taskCounts.approvals > 0 && (
                        <Link href="/tasks?tab=approvals" className="text-orange-400 hover:underline">{t(taskCounts.approvals === 1 ? "dashboard.pendingApprovalsOne" : "dashboard.pendingApprovalsOther", { count: taskCounts.approvals })}</Link>
                      )}
                      {taskCounts.findings > 0 && (
                        <Link href="/tasks?tab=security" className="text-red-400 hover:underline">{t(taskCounts.findings === 1 ? "dashboard.criticalFindingsOne" : "dashboard.criticalFindingsOther", { count: taskCounts.findings })}</Link>
                      )}
                      {taskCounts.failedJobs > 0 && (
                        <Link href="/tasks?tab=jobs" className="text-yellow-400 hover:underline">{t(taskCounts.failedJobs === 1 ? "dashboard.failedJobsOne" : "dashboard.failedJobsOther", { count: taskCounts.failedJobs })}</Link>
                      )}
                      {taskCounts.offline > 0 && (
                        <Link href="/tasks?tab=devices" className="text-zinc-400 hover:underline">{t(taskCounts.offline === 1 ? "dashboard.offlineDevicesOne" : "dashboard.offlineDevicesOther", { count: taskCounts.offline })}</Link>
                      )}
                    </div>
                    <Link href="/tasks" className="ml-auto text-xs text-muted-foreground hover:text-foreground">{t("dashboard.viewAll")}</Link>
                  </CardContent>
                </Card>
              )}

              {/* Quick Actions */}
              {isAdmin() && (
                <div className="flex flex-wrap gap-3 mb-6">
                  <Link href="/jobs?new=true" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
                    <Zap className="h-4 w-4" /> {t("dashboard.newJob")}
                  </Link>
                  <button
                    onClick={async () => {
                      const res = await apiClient.post("/vulnerabilities/scan", {});
                      if (res) toast.success(t("dashboard.scanStarted"));
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                  >
                    <Bug className="h-4 w-4" /> {t("dashboard.scanVulnerabilities")}
                  </button>
                  <Link href="/alerts" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
                    <BellIcon className="h-4 w-4" /> {t("dashboard.viewAlerts")}
                  </Link>
                </div>
              )}

              {/* Favorites */}
              <div className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5" /> {t("dashboard.favorites")}
                </h3>
                {favorites.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {favorites.map((fav) => (
                      <Link
                        key={`${fav.type}-${fav.id}`}
                        href={fav.href}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/5 text-sm text-yellow-200 hover:bg-yellow-500/10 hover:border-yellow-500/40 transition-colors"
                      >
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {fav.label}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/50">⭐ {t("dashboard.favoritesHint")}</p>
                )}
              </div>

              {/* Recently Opened */}
              {recent.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> {t("dashboard.recentlyOpened")}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {recent.slice(0, 8).map((item, i) => (
                      <Link
                        key={i}
                        href={item.href}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-800/50 text-sm text-zinc-300 hover:bg-zinc-700/50 hover:border-zinc-600 transition-colors"
                      >
                        {routeLabel(item.href, t, item.name)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Bento Grid */}
              <div className="grid grid-cols-12 gap-6">
                
                {/* Fleet Status - 3 cols: links into Fleet -> Nodes, filtered by the same status */}
                <Card className="col-span-12 md:col-span-3 border-primary/10 bg-gradient-to-br from-card to-primary/5 shadow-md">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                      {t("dashboard.fleetStatus")}
                      <Link href="/nodes" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">{t("dashboard.showNodes")}</Link>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Link href="/nodes" className="block text-6xl font-black mb-4 tracking-tighter hover:text-primary transition-colors" title={t("dashboard.showNodes")}>
                      {summary?.counts.total || 0}
                    </Link>
                    <div className="flex flex-col gap-2">
                      {([
                        ["online", "common.online", "bg-green-500 animate-pulse"],
                        ["away", "nodeDetail.away", "bg-yellow-500"],
                        ["offline", "common.offline", "bg-zinc-500"],
                      ] as const).filter(([status]) => status !== "away" || (summary?.counts.away ?? 0) > 0).map(([status, label, dot]) => (
                        <Link
                          key={status}
                          href={`/nodes?status=${status}`}
                          className="flex items-center justify-between text-sm px-3 py-1.5 bg-background/50 rounded-lg border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${dot}`} />
                            <span className="text-muted-foreground">{t(label)}</span>
                          </div>
                          <span className="font-bold">{summary?.counts[status] || 0}</span>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Security - 3 cols */}
                <Card className="col-span-12 md:col-span-3 border-destructive/10 bg-gradient-to-br from-card to-destructive/5 shadow-md">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-destructive">
                      {t("dashboard.criticalThreats")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-center">
                        <div className="text-2xl font-black text-destructive">{summary?.vulnerabilities?.critical || 0}</div>
                        <div className="text-[10px] uppercase font-bold text-destructive/70">{t("dashboard.critical")}</div>
                      </div>
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-center">
                        <div className="text-2xl font-black text-orange-500">{summary?.vulnerabilities?.high || 0}</div>
                        <div className="text-[10px] uppercase font-bold text-orange-500/70">{t("dashboard.highRisk")}</div>
                      </div>
                    </div>
                    <VulnerabilitySummaryFreshness
                      asOf={summary?.vulnerabilities?.as_of}
                      scanCompletedAt={summary?.vulnerabilities?.scan_completed_at}
                      refreshing={summary?.vulnerabilities?.refreshing}
                      pendingNodes={summary?.vulnerabilities?.pending_nodes}
                      onRefreshed={fetchSummary}
                      className="justify-center flex-wrap"
                    />
                    <Button variant="ghost" size="sm" className="w-full text-xs hover:bg-destructive/5 text-muted-foreground" asChild>
                      <Link href="/vulnerabilities">{t("dashboard.viewSecurityReports")}</Link>
                    </Button>
                  </CardContent>
                </Card>

                {/* Performance - 6 cols, spans 2 rows */}
                <Card className="col-span-12 md:col-span-6 md:row-span-2 border-border/50 shadow-lg bg-card/50 backdrop-blur-sm">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5" /> {t("dashboard.fleetPerformance")}
                      </CardDescription>
                      <Link href="/performance" className="text-xs font-semibold text-primary hover:underline">
                        {t("dashboard.detailedAnalytics")}
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {timeseries && timeseries.timeseries?.length > 0 ? (
                      <div className="space-y-6">
                        {/* Fleet Sparklines */}
                        <div className="grid grid-cols-3 gap-4 pb-6 border-b border-border/50">
                          {/* CPU Sparkline */}
                          <div className="bg-background/40 p-3 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">CPU</span>{/* i18n-ignore */}
                              <span className="text-lg font-black text-primary">{timeseries.current?.cpu?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-12">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <Area type="monotone" dataKey="cpu" stroke="var(--primary)" fill="url(#colorCpu)" strokeWidth={2} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* RAM Sparkline */}
                          <div className="bg-background/40 p-3 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">RAM</span>{/* i18n-ignore */}
                              <span className="text-lg font-black text-green-500">{timeseries.current?.ram?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-12">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="ram" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* Disk Sparkline */}
                          <div className="bg-background/40 p-3 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">{t("dashboard.disk")}</span>
                              <span className="text-lg font-black text-purple-500">{timeseries.current?.disk?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-12">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="disk" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={2} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>
                        {/* Per-node hotspot matrix */}
                        <div className="space-y-2">
                          <div className="grid grid-cols-[1fr_75px_75px_75px_80px] gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 px-2">
                            <span>{t("dashboard.nodeColumn")}</span>
                            <span className="text-center">CPU</span>{/* i18n-ignore */}
                            <span className="text-center">RAM</span>{/* i18n-ignore */}
                            <span className="text-center">{t("dashboard.disk")}</span>
                            <span className="text-right">{t("common.status")}</span>
                          </div>
                          {/* No inner scroll: the busiest rows first, the rest behind "Show all" (the card grows) */}
                          {(() => {
                            const perfNodes = (Array.isArray(metrics?.nodes) ? metrics.nodes : [])
                              .filter((n: any) => n.cpuPercent !== null || n.ramPercent !== null)
                              .sort((a: any, b: any) => Math.max(b.cpuPercent || 0, b.ramPercent || 0, b.diskPercent || 0) - Math.max(a.cpuPercent || 0, a.ramPercent || 0, a.diskPercent || 0));
                            const PERF_ROWS = 8;
                            return (<>
                          <div className="space-y-1">
                            {(showAllPerf ? perfNodes : perfNodes.slice(0, PERF_ROWS))
                              .map((node: any, i: number) => {
                                const cpu = node.cpuPercent || 0;
                                const ram = node.ramPercent || 0;
                                const disk = node.diskPercent || 0;
                                const worst = worstMetric({ cpu, ram, disk });
                                const status = worst.level;
                                const why = status === "ok" ? undefined : t("dashboard.perfWhy", {
                                  metric: t(`dashboard.perfMetric.${worst.metric}`), value: Math.round(worst.value),
                                  threshold: status === "crit" ? CRIT_PERCENT : WARN_PERCENT,
                                });
                                
                                const HeatBar = ({ value, colorClass }: { value: number; colorClass: string }) => (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="font-mono text-[11px] w-6 text-right tabular-nums">{Math.round(value)}</span>
                                    <div className="flex gap-0.5 h-3 items-center">
                                      {[1, 2, 3, 4, 5].map((step) => {
                                        const threshold = step * 20;
                                        const isActive = value >= threshold - 10;
                                        return (
                                          <div 
                                            key={step} 
                                            className={`w-1.5 h-full rounded-[1px] transition-colors ${isActive ? colorClass : 'bg-muted/30'}`} 
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                                
                                return (
                                  <Link
                                    key={i}
                                    href={performanceHref(node.nodeId, worst)}
                                    title={why}
                                    className="grid grid-cols-[1fr_75px_75px_75px_80px] gap-2 items-center py-2 px-2 hover:bg-primary/5 rounded-lg border border-transparent hover:border-primary/10 transition-all cursor-pointer group"
                                  >
                                    <span className="font-bold text-xs truncate group-hover:text-primary transition-colors">{node.hostname}</span>
                                    <HeatBar value={cpu} colorClass="bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                                    <HeatBar value={ram} colorClass="bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                    <HeatBar value={disk} colorClass="bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                                    <div className="text-right">
                                      {status === 'crit' ? (
                                        <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[9px] font-bold uppercase py-0 px-1.5">{t("dashboard.critical")}</Badge>
                                      ) : status === 'warn' ? (
                                        <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[9px] font-bold uppercase py-0 px-1.5">{t("common.warning")}</Badge>
                                      ) : (
                                        <span className="text-[10px] font-bold text-muted-foreground/50 uppercase">{t("dashboard.healthy")}</span>
                                      )}
                                    </div>
                                  </Link>
                                );
                              })}
                          </div>
                          {perfNodes.length > PERF_ROWS && (
                            <button type="button" onClick={() => setShowAllPerf((v) => !v)}
                              className="mt-2 w-full text-center text-xs font-semibold text-primary hover:underline">
                              {showAllPerf ? t("dashboard.showLess") : t("dashboard.showAllCount", { count: perfNodes.length })}
                            </button>
                          )}
                            </>);
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-muted/10 rounded-xl border border-dashed border-border">
                        <Activity className="h-8 w-8 mb-2 opacity-20" />
                        <p className="text-sm font-medium">{t("dashboard.noPerformanceData")}</p>
                        <p className="text-xs opacity-50">{t("dashboard.checkAgents")}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {/* Jobs 24h - 3 cols */}
                <Card className="col-span-6 md:col-span-3 border-green-500/10 bg-gradient-to-br from-card to-green-500/5 shadow-md hover:shadow-green-500/5 transition-all">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-widest text-green-600">
                      <span className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" /> {t("dashboard.jobs24h")}</span>
                      <Link href="/jobs?range=24h" className="text-[10px] font-bold text-green-600 hover:underline uppercase tracking-tighter">{t("dashboard.showJobs")}</Link>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-end gap-6 mb-4">
                      <Link href="/jobs?status=success&range=24h" className="group">
                        <div className="text-4xl font-black text-green-500 group-hover:scale-110 transition-transform origin-left">{jobCounts?.success ?? 0}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">{t("common.success")}</div>
                      </Link>
                      <Link href="/jobs?status=failed&range=24h" className="group">
                        <div className="text-3xl font-bold text-red-500 group-hover:scale-110 transition-transform origin-left">{jobCounts?.failed ?? 0}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">{t("dashboard.failed")}</div>
                      </Link>
                    </div>
                    {(jobCounts?.running ?? 0) > 0 && (
                      <Link href="/jobs?status=running" className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 text-yellow-600 rounded-md text-[10px] font-bold uppercase border border-yellow-500/20 hover:bg-yellow-500/20">
                        <Activity className="h-3 w-3 animate-spin" /> {t("dashboard.runningCount", { count: jobCounts?.running ?? 0 })}
                      </Link>
                    )}
                  </CardContent>
                </Card>

                {/* SQL Server - 3 cols */}
                <Card className="col-span-6 md:col-span-3 border-blue-500/10 bg-gradient-to-br from-card to-blue-500/5 shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                        🗄️ {t("dashboard.sqlLifecycle")}
                      </CardDescription>
                      <Link href="/sql" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">
                        {t("dashboard.manage")}
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {sqlCatalog && sqlCatalog.total > 0 ? (
                      <div>
                        <div className="text-4xl font-black mb-1">{sqlCatalog.total}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground mb-3">{t("dashboard.syncableCus")}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {sqlCatalog.versions.slice(0, 3).map((v) => (
                            <Badge key={v.version} variant="outline" className="text-[9px] font-bold bg-background/50 border-blue-500/20">
                              {v.version} • CU{v.latestCu}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40">
                        <Package className="h-8 w-8 mb-1 opacity-20" />
                        <span className="text-[10px] font-bold uppercase">{t("dashboard.noCus")}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Security Events - 3 cols */}
                <Card className="col-span-6 md:col-span-3 border-purple-500/10 bg-gradient-to-br from-card to-purple-500/5 shadow-md hover:shadow-purple-500/5 transition-all">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400">
                        <Shield className="h-3.5 w-3.5" /> {t("dashboard.securityEvents")}
                      </CardDescription>
                      <Link href="/security/events" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">
                        {t("dashboard.details")}
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {eventStats && eventStats.stats.length > 0 ? (() => {
                      const prefixMap: Record<string, { label: string; color: string }> = {
                        logon: { label: t("dashboard.eventTypes.logon"), color: "#a78bfa" },
                        network: { label: t("nodes.network"), color: "#60a5fa" },
                        process: { label: t("nodeDetail.process"), color: "#34d399" },
                        service: { label: t("nodeDetail.service"), color: "#fbbf24" },
                        file: { label: t("dashboard.eventTypes.file"), color: "#f87171" },
                      };
                      const grouped: Record<string, number> = {};
                      (eventStats.stats || []).forEach((s) => {
                        const key = Object.keys(prefixMap).find((p) => (s.event_type || "").toLowerCase().startsWith(p)) || "other";
                        grouped[key] = (grouped[key] || 0) + (s.count || 0);
                      });
                      const total = Object.values(grouped).reduce((a, b) => a + b, 0) || 0;
                      const entries = Object.entries(prefixMap).filter(([k]) => grouped[k]);
                      return (
                        <div>
                          <div className="text-4xl font-black mb-0.5">{total.toLocaleString()}</div>
                          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-3">{t("dashboard.last7days")}</div>
                          {/* Proportion bar */}
                          <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-muted/30">
                            {entries.map(([key, meta]) => (
                              <div
                                key={key}
                                style={{ width: `${total > 0 ? ((grouped[key] || 0) / total) * 100 : 0}%`, backgroundColor: meta.color }}
                                className="transition-all"
                                title={`${meta.label}: ${grouped[key]?.toLocaleString()}`}
                              />
                            ))}
                          </div>
                          <div className="space-y-1">
                            {entries.map(([key, meta]) => (
                              <div key={key} className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                                  <span className="font-medium text-muted-foreground">{meta.label}</span>
                                </div>
                                <span className="font-bold font-mono">{(grouped[key] || 0).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40">
                        <Shield className="h-8 w-8 mb-1 opacity-20" />
                        <span className="text-[10px] font-bold uppercase">{t("dashboard.noEvents")}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent Alerts - 6 cols */}
                <Card className="col-span-12 md:col-span-6 border-border/50 shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5" /> {t("dashboard.fleetIncidents")}
                      </CardDescription>
                      <Link href="/alerts" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">
                        {t("dashboard.incidentLog")}
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      {recentAlerts.length > 0 ? recentAlerts.slice(0, 4).map((alert: any) => (
                        <div key={alert.id} className="flex items-center justify-between py-2 px-2 hover:bg-muted/30 rounded-lg transition-colors border-b border-border/10 last:border-0">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full shadow-[0_0_8px] ${
                              alert.event_type === 'node_offline' ? 'bg-red-500 shadow-red-500/50' :
                              alert.event_type === 'node_online' ? 'bg-green-500 shadow-green-500/50' :
                              alert.event_type === 'job_failed' ? 'bg-orange-500 shadow-orange-500/50' :
                              'bg-blue-500 shadow-blue-500/50'
                            }`} />
                            <span className="text-xs font-medium truncate max-w-[280px]">{alert.message || alert.event_type}</span>
                          </div>
                          <span className="text-[10px] font-bold font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {formatTime(alert.sent_at, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )) : (
                        <div className="text-center py-6 text-xs text-muted-foreground/50 italic font-medium uppercase tracking-widest">
                          {t("dashboard.noIncidents")}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* System Health - 6 cols */}
                <Card className="col-span-12 md:col-span-6 border-border/50 shadow-md">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      <Activity className="h-3.5 w-3.5" /> {t("dashboard.infrastructureHealth")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border/30">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${systemHealth?.status === 'ok' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-ping'}`} />
                          <span className="text-xs font-bold uppercase tracking-tighter">Core API</span>{/* i18n-ignore */}
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-black uppercase ${systemHealth?.status === 'ok' ? 'text-green-600 border-green-500/20' : 'text-red-400 border-red-500/20'}`}>
                          {systemHealth?.status || t("common.offline")}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border/30">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${systemHealth?.database === 'connected' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-ping'}`} />
                          <span className="text-xs font-bold uppercase tracking-tighter">{t("dashboard.database")}</span>
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-black uppercase ${systemHealth?.database === 'connected' ? 'text-green-600 border-green-500/20' : 'text-red-400 border-red-500/20'}`}>
                          {systemHealth?.database === 'connected' ? t("common.online") : t("common.error")}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

              </div>
            </div>
            </RoleDashboard>
            )
          }
        </main>
      </div>
    </div>
  );
}
