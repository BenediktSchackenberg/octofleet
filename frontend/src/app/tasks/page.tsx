"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import {
  RefreshCw, ShieldAlert, Briefcase, WifiOff, UserCheck, Bug, AlertTriangle, Bell, CheckCircle2, Clock,
} from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format";
import { useTabParam } from "@/hooks/useTabParam";
import { nodeVulnerabilitiesHref } from "@/components/node-vulnerabilities";

// ─── Types ───────────────────────────────────────────────────────────

type Priority = "critical" | "high" | "medium";
type TaskType = "approval" | "job_failed" | "cve" | "remediation_failed" | "finding" | "offline" | "alert_failed";

/** One action item. `status`, `description` and `since` are shown as they are (already translated). */
interface TaskItem {
  id: string;
  priority: Priority;
  type: TaskType;
  object: string;
  status: string;
  description: string;
  /** When it happened (ISO); null if the source has no time */
  at: string | null;
  link: string;
}

/** Failed jobs, remediations and alert deliveries: the last 7 days (the dashboard counts the last 24 hours) */
const RECENT_HOURS = 7 * 24;

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, medium: 2 };

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
};

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  approval: <UserCheck className="h-4 w-4" />,
  job_failed: <Briefcase className="h-4 w-4" />,
  cve: <Bug className="h-4 w-4" />,
  remediation_failed: <AlertTriangle className="h-4 w-4" />,
  finding: <ShieldAlert className="h-4 w-4" />,
  offline: <WifiOff className="h-4 w-4" />,
  alert_failed: <Bell className="h-4 w-4" />,
};

const FILTERS = ["all", "critical", "security", "jobs", "devices", "approvals"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_TYPES: Record<Filter, TaskType[]> = {
  all: [],
  critical: [], // by priority
  security: ["cve", "finding"],
  jobs: ["job_failed", "remediation_failed", "alert_failed"],
  devices: ["offline"],
  approvals: ["approval"],
};

type T = (key: string, params?: Record<string, string | number>) => string;

function isRecent(iso: string | null | undefined): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() <= RECENT_HOURS * 3600_000;
}

/** "3 min ago", "5 h ago", "2 d ago" */
function ago(t: T, iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t("tasksPage.ago.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("tasksPage.ago.hours", { count: hours });
  return t("tasksPage.ago.days", { count: Math.floor(hours / 24) });
}

function firstLine(text?: string | null): string {
  return (text || "").trim().split("\n")[0].slice(0, 160);
}

// ─── Data ────────────────────────────────────────────────────────────

interface Counts { approvals: number; criticalCves: number; findings: number; failedJobs: number; offline: number; remediationFailed: number }

async function fetchTasks(t: T): Promise<{ tasks: TaskItem[]; counts: Counts }> {
  const tasks: TaskItem[] = [];
  const counts: Counts = { approvals: 0, criticalCves: 0, findings: 0, failedJobs: 0, offline: 0, remediationFailed: 0 };
  const quiet = { showErrorToast: false };

  const [pending, jobs, vulnSummary, vulnNodes, remediation, findings, nodes, alerts] = await Promise.allSettled([
    apiClient.get<{ pending: { id: string; hostname?: string; ipAddress?: string; agentVersion?: string; createdAt?: string }[] }>("/pending-nodes", quiet),
    apiClient.get<{ jobs: { job_id: string; name?: string; target_name?: string; failed: number; total_instances: number; last_failed_at?: string; last_error?: string }[]; total: number }>(
      `/jobs?status=failed&since_hours=${RECENT_HOURS}&limit=50`, quiet),
    apiClient.get<{ severity_counts?: Record<string, number>; last_completed_scan?: { completed_at?: string } }>("/vulnerabilities/summary", quiet),
    apiClient.get<{ nodes: { id: string; hostname?: string; critical: number; max_cvss?: number; max_cvss_cve?: string }[] }>("/vulnerabilities/by-node", quiet),
    apiClient.get<{ job_counts?: Record<string, number>; recent_jobs?: { id: string; software_name?: string; software_version?: string; cve_id?: string; status?: string; error_message?: string; completed_at?: string; updated_at?: string; created_at?: string }[] }>("/remediation/summary", quiet),
    apiClient.get<{ findings: { id: string; title?: string; status?: string; nodeId?: string; closedAt?: string | null; lastSeen?: string; createdAt?: string; severity?: string }[]; total: number }>("/security/findings?severity=critical&limit=50", quiet),
    apiClient.get<{ nodes: { id: string; hostname?: string; is_online?: boolean; last_seen?: string }[] }>("/nodes", quiet),
    apiClient.get<{ id: string; rule_name?: string; channel_name?: string; event_type?: string; status?: string; error_message?: string; created_at?: string }[]>("/alert-history?limit=50", quiet),
  ]);
  const value = <V,>(r: PromiseSettledResult<V>): V | null => (r.status === "fulfilled" ? r.value : null);
  const nodeList = value(nodes)?.nodes ?? [];
  const nodeNames = new Map(nodeList.map((n) => [n.id, n.hostname || n.id]));

  // Agents waiting for approval
  for (const p of value(pending)?.pending ?? []) {
    counts.approvals++;
    tasks.push({
      id: `approval-${p.id}`, priority: "high", type: "approval",
      object: p.hostname || p.id,
      status: t("tasksPage.status.waitingApproval"),
      description: [p.ipAddress, p.agentVersion && t("tasksPage.agentVersion", { version: p.agentVersion })].filter(Boolean).join(" · "),
      at: p.createdAt ?? null, link: "/admin/agents",
    });
  }

  // Failed jobs (at least one failed node in the last 7 days), newest failure first
  const jobsRes = value(jobs);
  counts.failedJobs = jobsRes?.total ?? 0;
  for (const j of jobsRes?.jobs ?? []) {
    tasks.push({
      id: `job-${j.job_id}`, priority: "high", type: "job_failed",
      object: j.name || j.job_id,
      status: t("tasksPage.status.failedOn", { failed: j.failed, total: j.total_instances }),
      // the job list shows "—" for jobs without a target (e.g. from the Patch Explorer)
      description: [j.target_name !== "—" ? j.target_name : null, firstLine(j.last_error)].filter(Boolean).join(" · "),
      at: j.last_failed_at ?? null, link: `/jobs/${j.job_id}`,
    });
  }

  // Critical vulnerabilities, per node (same counting as the dashboard and the vulnerabilities page)
  const summary = value(vulnSummary);
  counts.criticalCves = summary?.severity_counts?.CRITICAL ?? 0;
  const scannedAt = summary?.last_completed_scan?.completed_at ?? null;
  for (const n of (value(vulnNodes)?.nodes ?? []).filter((x) => x.critical > 0)) {
    tasks.push({
      id: `cve-${n.id}`, priority: "critical", type: "cve",
      object: n.hostname || n.id,
      status: t("tasksPage.status.open"),
      description: t("tasksPage.criticalCves", { count: n.critical })
        + (n.max_cvss ? ` · ${t("tasksPage.maxCvss", { score: n.max_cvss, cve: n.max_cvss_cve ?? "" })}` : ""),
      at: scannedAt, link: nodeVulnerabilitiesHref(n.id, { severity: "CRITICAL" }),
    });
  }

  // Failed remediation jobs
  const rem = value(remediation);
  for (const r of (rem?.recent_jobs ?? []).filter((x) => x.status === "failed" && isRecent(x.completed_at || x.updated_at || x.created_at))) {
    counts.remediationFailed++;
    tasks.push({
      id: `rem-${r.id}`, priority: "high", type: "remediation_failed",
      object: [r.software_name, r.software_version].filter(Boolean).join(" ") || r.id,
      status: t("tasksPage.status.failed"),
      description: [r.cve_id, firstLine(r.error_message)].filter(Boolean).join(" · "),
      at: r.completed_at || r.updated_at || r.created_at || null, link: "/remediation",
    });
  }

  // Open critical security findings
  for (const f of (value(findings)?.findings ?? []).filter((x) => !x.closedAt)) {
    counts.findings++;
    tasks.push({
      id: `finding-${f.id}`, priority: "critical", type: "finding",
      object: f.title || f.id,
      status: f.status || t("tasksPage.status.open"),
      description: f.nodeId ? t("tasksPage.onNode", { node: nodeNames.get(f.nodeId) ?? f.nodeId }) : "",
      at: f.lastSeen || f.createdAt || null, link: "/security/findings",
    });
  }

  // Nodes not seen for more than 10 minutes
  const TEN_MINUTES = 10 * 60_000;
  for (const n of nodeList.filter((x) =>
    !x.is_online && !(x.last_seen && Date.now() - new Date(x.last_seen).getTime() < TEN_MINUTES))) {
    counts.offline++;
    const hours = n.last_seen ? (Date.now() - new Date(n.last_seen).getTime()) / 3600_000 : Infinity;
    tasks.push({
      id: `offline-${n.id}`, priority: hours > 72 ? "high" : "medium", type: "offline",
      object: n.hostname || n.id,
      status: t("tasksPage.status.offline"),
      description: n.last_seen ? t("tasksPage.lastSeen", { time: formatDateTime(n.last_seen) }) : t("tasksPage.neverSeen"),
      at: n.last_seen ?? null, link: `/nodes/${n.id}`,
    });
  }

  // Alerts that could not be sent (the alert history is a delivery log; only failures need action)
  const alertRows = value(alerts);
  for (const a of (Array.isArray(alertRows) ? alertRows : []).filter((x) => x.status === "failed" && isRecent(x.created_at))) {
    tasks.push({
      id: `alert-${a.id}`, priority: "medium", type: "alert_failed",
      object: a.rule_name || a.event_type || a.id,
      status: t("tasksPage.status.notSent"),
      description: [a.channel_name, firstLine(a.error_message)].filter(Boolean).join(" · "),
      at: a.created_at ?? null, link: "/alerts",
    });
  }

  // Priority first, then the newest
  tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || (b.at ? new Date(b.at).getTime() : 0) - (a.at ? new Date(a.at).getTime() : 0));
  return { tasks, counts };
}

// ─── Page ────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useTabParam<Filter>("all", FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTasks(t);
      setTasks(result.tasks);
      setCounts(result.counts);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "critical") return tasks.filter((x) => x.priority === "critical");
    return tasks.filter((x) => FILTER_TYPES[filter].includes(x.type));
  }, [tasks, filter]);

  const summaryCards: { label: string; value: number; icon: React.ReactNode; tab: Filter }[] = [
    { label: t("tasksPage.cards.approvals"), value: counts?.approvals ?? 0, icon: <UserCheck className="h-4 w-4" />, tab: "approvals" },
    { label: t("tasksPage.cards.criticalCves"), value: counts?.criticalCves ?? 0, icon: <Bug className="h-4 w-4" />, tab: "security" },
    { label: t("tasksPage.cards.findings"), value: counts?.findings ?? 0, icon: <ShieldAlert className="h-4 w-4" />, tab: "security" },
    { label: t("tasksPage.cards.failedJobs"), value: counts?.failedJobs ?? 0, icon: <Briefcase className="h-4 w-4" />, tab: "jobs" },
    { label: t("tasksPage.cards.offline"), value: counts?.offline ?? 0, icon: <WifiOff className="h-4 w-4" />, tab: "devices" },
    { label: t("tasksPage.cards.remediationFailed"), value: counts?.remediationFailed ?? 0, icon: <AlertTriangle className="h-4 w-4" />, tab: "jobs" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{t("tasksPage.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("tasksPage.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> {t("tasksPage.refresh")}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {summaryCards.map((c) => (
          <button key={c.label} type="button" onClick={() => setFilter(c.tab)} className="text-left">
            <Card className="border-zinc-800 hover:border-zinc-600 transition-colors">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="text-muted-foreground">{c.icon}</div>
                <div>
                  <div className="text-2xl font-bold">{loading && !counts ? "…" : c.value}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("tasksPage.window")}</p>

      <Tabs value={filter} onValueChange={setFilter} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">{t("tasksPage.filters.all", { count: tasks.length })}</TabsTrigger>
          <TabsTrigger value="critical">{t("tasksPage.filters.critical")}</TabsTrigger>
          <TabsTrigger value="security">{t("tasksPage.filters.security")}</TabsTrigger>
          <TabsTrigger value="jobs">{t("tasksPage.filters.jobs")}</TabsTrigger>
          <TabsTrigger value="devices">{t("tasksPage.filters.devices")}</TabsTrigger>
          <TabsTrigger value="approvals">{t("tasksPage.filters.approvals")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading && !counts ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-zinc-900 rounded animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-zinc-800">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
            <p className="text-lg font-semibold">{t("tasksPage.empty.title")}</p>
            <p className="text-muted-foreground text-sm">{t("tasksPage.empty.text")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("tasksPage.columns.priority")}</TableHead>
                <TableHead className="w-40">{t("tasksPage.columns.type")}</TableHead>
                <TableHead>{t("tasksPage.columns.object")}</TableHead>
                <TableHead className="w-40">{t("tasksPage.columns.status")}</TableHead>
                <TableHead>{t("tasksPage.columns.details")}</TableHead>
                <TableHead className="w-44">{t("tasksPage.columns.when")}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Badge className={`${PRIORITY_COLORS[task.priority]} text-xs`}>{t(`tasksPage.priority.${task.priority}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">{TYPE_ICONS[task.type]} {t(`tasksPage.types.${task.type}`)}</div>
                  </TableCell>
                  <TableCell className="font-medium break-words max-w-[280px]">{task.object}</TableCell>
                  <TableCell className="text-sm">{task.status}</TableCell>
                  <TableCell className="text-muted-foreground text-sm break-words max-w-[360px]">{task.description || "-"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {task.at ? (
                      <div className="flex items-start gap-1" title={task.at}>
                        <Clock className="h-3 w-3 mt-1 shrink-0" />
                        <div>
                          <div>{formatDateTime(task.at)}</div>
                          <div className="text-xs">{ago(t, task.at)}</div>
                        </div>
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={task.link}>{t("tasksPage.open")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
