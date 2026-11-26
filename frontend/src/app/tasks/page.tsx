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
  RefreshCw, ShieldAlert, Briefcase, WifiOff, UserCheck, Bug, AlertTriangle, Bell, CheckCircle2, Clock, Check, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format";
import { useTabParam } from "@/hooks/useTabParam";
import { nodeVulnerabilitiesHref } from "@/components/node-vulnerabilities";
import { JOB_FAILURES_PATH, withinTaskWindow } from "@/lib/tasks";

// ─── Types ───────────────────────────────────────────────────────────

type Priority = "critical" | "high" | "medium";
type TaskType = "approval" | "job_failed" | "cve" | "remediation_failed" | "finding" | "offline" | "alert_failed";

/** One action item. `status`, `description` and `since` are shown as they are (already translated). */
interface TaskItem {
  id: string;
  priority: Priority;
  type: TaskType;
  /** Shown instead of the type's name, e.g. the job type ("Search for updates") */
  typeLabel?: string;
  object: string;
  /** The object's own page (e.g. the node), if it is not `link` */
  objectLink?: string;
  status: string;
  /** Resolved since (a later run succeeded): shown dimmed */
  resolved?: boolean;
  description: string;
  /** When it happened (ISO); null if the source has no time */
  at: string | null;
  link: string;
  /** An agent waiting for approval: approve or reject it right in the row */
  pending?: { id: string; hostname: string; ipAddress?: string };
}

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

/** The lines that say why a job failed: its output without the agent's progress lines */
function lastLines(text?: string | null): string {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const failing = lines.filter((l) => /fail|error|denied|refused|not |cannot|unable|users/i.test(l));
  return (failing.length ? failing : lines).slice(0, 2).join(" – ");
}

// ─── Data ────────────────────────────────────────────────────────────

interface Counts { approvals: number; criticalCves: number; findings: number; failedJobs: number; offline: number; remediationFailed: number }

interface JobFailure {
  node_id: string; hostname?: string | null; command_type: string; job_id: string; job_name?: string | null;
  failures: number; first_failed_at: string; last_failed_at: string; last_success_at?: string | null;
  resolved: boolean; reason?: string | null;
}

/** Job types whose jobs differ by what they run (the server groups their failures by job name too) */
const VARIANT_TYPES = new Set(["run", "script", "install_package", "uninstall_package", "update_package"]);

/** The job type's name ("Search for updates"); the job's name for types without one */
function jobTypeLabel(t: T, f: JobFailure): string {
  const key = `tasksPage.jobTypes.${f.command_type}`;
  const label = t(key);
  return label === key ? f.job_name || f.command_type : label;
}

async function fetchTasks(t: T, showResolved: boolean): Promise<{ tasks: TaskItem[]; counts: Counts; resolvedJobs: number }> {
  const tasks: TaskItem[] = [];
  const counts: Counts = { approvals: 0, criticalCves: 0, findings: 0, failedJobs: 0, offline: 0, remediationFailed: 0 };
  const quiet = { showErrorToast: false };

  const [pending, jobs, vulnSummary, vulnNodes, remediation, findings, nodes, alerts] = await Promise.allSettled([
    apiClient.get<{ pending: { id: string; hostname?: string; ipAddress?: string; agentVersion?: string; createdAt?: string }[] }>("/pending-nodes", quiet),
    apiClient.get<{ failures: JobFailure[]; total: number; resolved: number }>(
      `${JOB_FAILURES_PATH}&limit=100${showResolved ? "&include_resolved=true" : ""}`, quiet),
    apiClient.get<{ severity_counts?: Record<string, number>; last_completed_scan?: { completed_at?: string } }>("/vulnerabilities/summary", quiet),
    apiClient.get<{ nodes: { id: string; hostname?: string; critical: number; max_cvss?: number; max_cvss_cve?: string }[] }>("/vulnerabilities/by-node?severity=critical&limit=50", quiet),
    apiClient.get<{ job_counts?: Record<string, number>; recent_jobs?: { id: string; software_name?: string; software_version?: string; cve_id?: string; status?: string; error_message?: string; completed_at?: string; updated_at?: string; created_at?: string }[] }>("/remediation/summary", quiet),
    apiClient.get<{ findings: { id: string; title?: string; status?: string; nodeId?: string; closedAt?: string | null; lastSeen?: string; createdAt?: string; severity?: string }[]; total: number }>("/security/findings?severity=critical&limit=50", quiet),
    apiClient.get<{ nodes: { id: string; hostname?: string; status?: string; last_seen?: string }[] }>("/nodes", quiet),
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
      at: p.createdAt ?? null, link: "/nodes", // Approve/Reject are in the Nodes page's pending section
      pending: { id: p.id, hostname: p.hostname || p.id, ipAddress: p.ipAddress },
    });
  }

  // Failed jobs of the last 7 days, one entry per node and job type (repeats counted), newest failure
  // first; gone once a later run of the same kind succeeded on that node (shown as resolved on request)
  const jobsRes = value(jobs);
  counts.failedJobs = jobsRes?.total ?? 0;
  for (const f of jobsRes?.failures ?? []) {
    const repeated = f.failures > 1 ? t("tasksPage.repeatedSince", { time: formatDateTime(f.first_failed_at) }) : null;
    tasks.push({
      id: `job-${f.node_id}-${f.command_type}-${f.job_id}`, priority: f.resolved ? "medium" : "high", type: "job_failed",
      typeLabel: jobTypeLabel(t, f),
      object: f.hostname || f.node_id,
      objectLink: `/nodes/${f.node_id}`,
      status: f.resolved
        ? t("tasksPage.status.resolved", { time: formatDateTime(f.last_success_at) })
        : f.failures > 1 ? t("tasksPage.status.failedTimes", { count: f.failures }) : t("tasksPage.status.failed"),
      resolved: f.resolved,
      // commands, scripts and packages: the job's name says which one
      description: [VARIANT_TYPES.has(f.command_type) ? f.job_name : null, firstLine(lastLines(f.reason)), repeated]
        .filter(Boolean).join(" · "),
      at: f.last_failed_at, link: `/jobs/${f.job_id}`,
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
  for (const r of (rem?.recent_jobs ?? []).filter((x) => x.status === "failed" && withinTaskWindow(x.completed_at || x.updated_at || x.created_at))) {
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

  // Offline nodes: no contact for an hour (the server's node status, as on the dashboard's Fleet
  // status card). is_online is not used: it stays true once a node reported.
  for (const n of nodeList.filter((x) => x.status === "offline")) {
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
  for (const a of (Array.isArray(alertRows) ? alertRows : []).filter((x) => x.status === "failed" && withinTaskWindow(x.created_at))) {
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
  return { tasks, counts, resolvedJobs: jobsRes?.resolved ?? 0 };
}

// ─── Page ────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useTabParam<Filter>("all", FILTERS);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvedJobs, setResolvedJobs] = useState(0);
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("nodes:write");
  /** The pending agent being approved or rejected */
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTasks(t, showResolved);
      setTasks(result.tasks);
      setCounts(result.counts);
      setResolvedJobs(result.resolvedJobs);
    } finally {
      setLoading(false);
    }
  }, [t, showResolved]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  // Approve or reject a waiting agent here (same routes as the Nodes page), then reload the list
  const decide = async (pending: NonNullable<TaskItem["pending"]>, approve: boolean) => {
    const who = pending.ipAddress ? `${pending.hostname} (${pending.ipAddress})` : pending.hostname;
    if (!confirm(t(approve ? "tasksPage.approveConfirm" : "tasksPage.rejectConfirm", { agent: who }))) return;
    setActing(pending.id);
    try {
      if (approve) await apiClient.post(`/pending-nodes/${pending.id}/approve`, {});
      else await apiClient.delete(`/pending-nodes/${pending.id}/reject`);
      await load();
    } catch {
      // the API client shows the error
    } finally {
      setActing(null);
    }
  };

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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("tasksPage.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("tasksPage.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> {t("tasksPage.refresh")}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted-foreground">{t("tasksPage.window")}</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          {t("tasksPage.showResolved", { count: resolvedJobs })}
        </label>
      </div>

      <Tabs value={filter} onValueChange={setFilter}>
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
                <TableHead className="w-20 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((task) => (
                <TableRow key={task.id} className={task.resolved ? "opacity-60" : ""}>
                  <TableCell>
                    <Badge className={`${PRIORITY_COLORS[task.priority]} text-xs`}>{t(`tasksPage.priority.${task.priority}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm" title={t(`tasksPage.types.${task.type}`)}>{TYPE_ICONS[task.type]} {task.typeLabel ?? t(`tasksPage.types.${task.type}`)}</div>
                  </TableCell>
                  <TableCell className="font-medium whitespace-normal break-words max-w-[280px]">
                    {task.objectLink ? <Link href={task.objectLink} className="text-blue-400 hover:underline">{task.object}</Link> : task.object}
                  </TableCell>
                  <TableCell className="text-sm">{task.status}</TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-normal break-words max-w-[360px]">{task.description || "-"}</TableCell>
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
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      {task.pending && canApprove && (
                        <>
                          <Button size="sm" className="bg-green-600 hover:bg-green-500 text-white" disabled={acting === task.pending.id}
                            onClick={() => decide(task.pending!, true)}>
                            <Check className="h-4 w-4 mr-1" /> {t("tasksPage.approve")}
                          </Button>
                          <Button variant="outline" size="sm" className="hover:bg-red-600 hover:text-white" disabled={acting === task.pending.id}
                            onClick={() => decide(task.pending!, false)}>
                            <X className="h-4 w-4 mr-1" /> {t("tasksPage.reject")}
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link href={task.link}>{t("tasksPage.open")}</Link>
                      </Button>
                    </div>
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
