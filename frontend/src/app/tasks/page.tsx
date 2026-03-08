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
  RefreshCw, ShieldAlert, Briefcase, Wifi, WifiOff, UserCheck, Bug, AlertTriangle, Bell, CheckCircle2, Clock,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  type: string;
  typeLabel: string;
  object: string;
  description: string;
  since: string;
  timestamp: number;
  link: string;
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-zinc-600 text-zinc-200",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  approval: <UserCheck className="h-4 w-4" />,
  finding: <ShieldAlert className="h-4 w-4" />,
  job_failed: <Briefcase className="h-4 w-4" />,
  offline: <WifiOff className="h-4 w-4" />,
  cve: <Bug className="h-4 w-4" />,
  remediation_failed: <AlertTriangle className="h-4 w-4" />,
  alert: <Bell className="h-4 w-4" />,
};

const FILTER_MAP: Record<string, string[]> = {
  all: [],
  critical: [], // special: priority-based
  security: ["finding", "cve"],
  jobs: ["job_failed", "remediation_failed"],
  devices: ["offline"],
  approvals: ["approval"],
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ─── Data fetching helpers ───────────────────────────────────────────

async function fetchTasks(): Promise<{ tasks: TaskItem[]; counts: Record<string, number> }> {
  const tasks: TaskItem[] = [];
  const counts = { approvals: 0, findings: 0, failedJobs: 0, offline: 0, cves: 0, remediationFailed: 0 };

  const results = await Promise.allSettled([
    apiClient.get<{ pending: Array<{ hostname?: string; node_id?: string; created_at?: string }> }>("/pending-nodes"),
    apiClient.get<{ jobs: Array<{ id: string; name?: string; job_name?: string; created_at?: string; updated_at?: string; failed_count?: number }> }>("/jobs?status=failed&limit=20"),
    apiClient.get<{ vulnerabilities: Array<{ cve_id?: string; id?: string; severity?: string; cvss_score?: number; affected_count?: number; created_at?: string }> }>("/vulnerabilities?severity=critical&limit=20"),
    apiClient.get<{ job_counts: { failed: number }; recent_jobs: Array<{ id: string; name?: string; status?: string; created_at?: string }> }>("/remediation/summary"),
    apiClient.get<{ findings: Array<{ id: string; title?: string; severity?: string; node_hostname?: string; hostname?: string; created_at?: string }>; total: number }>("/security/findings?severity=critical&limit=20"),
    apiClient.get<{ nodes: Array<{ id: string; hostname?: string; status?: string; last_seen?: string }> }>("/nodes"),
    apiClient.get<{ alerts?: Array<{ id: string; title?: string; severity?: string; created_at?: string; message?: string }> }>("/alert-history?limit=20"),
  ]);

  // Pending approvals
  const pendingRes = results[0].status === "fulfilled" ? results[0].value : null;
  if (pendingRes?.pending) {
    counts.approvals = pendingRes.pending.length;
    for (const p of pendingRes.pending) {
      tasks.push({
        id: `approval-${p.node_id || p.hostname}`,
        priority: "high",
        type: "approval",
        typeLabel: "Approval",
        object: p.hostname || p.node_id || "Unknown",
        description: "Agent awaiting approval",
        since: p.created_at ? timeAgo(new Date(p.created_at).getTime()) : "?",
        timestamp: p.created_at ? new Date(p.created_at).getTime() : 0,
        link: "/admin/agents",
      });
    }
  }

  // Failed jobs
  const jobsRes = results[1].status === "fulfilled" ? results[1].value : null;
  if (jobsRes?.jobs) {
    counts.failedJobs = jobsRes.jobs.length;
    for (const j of jobsRes.jobs) {
      tasks.push({
        id: `job-${j.id}`,
        priority: "high",
        type: "job_failed",
        typeLabel: "Failed Job",
        object: j.name || j.job_name || j.id,
        description: j.failed_count ? `Failed on ${j.failed_count} nodes` : "Job failed",
        since: timeAgo(new Date(j.updated_at || j.created_at || 0).getTime()),
        timestamp: new Date(j.updated_at || j.created_at || 0).getTime(),
        link: "/jobs",
      });
    }
  }

  // Critical vulnerabilities
  const vulnRes = results[2].status === "fulfilled" ? results[2].value : null;
  if (vulnRes?.vulnerabilities) {
    counts.cves = vulnRes.vulnerabilities.length;
    for (const v of vulnRes.vulnerabilities) {
      const cvss = v.cvss_score || 0;
      tasks.push({
        id: `cve-${v.cve_id || v.id}`,
        priority: cvss >= 9 ? "critical" : "high",
        type: "cve",
        typeLabel: "CVE",
        object: v.cve_id || v.id || "Unknown",
        description: v.affected_count ? `Critical on ${v.affected_count} nodes` : "Critical vulnerability",
        since: v.created_at ? timeAgo(new Date(v.created_at).getTime()) : "?",
        timestamp: v.created_at ? new Date(v.created_at).getTime() : 0,
        link: "/vulnerabilities",
      });
    }
  }

  // Remediation failures
  const remRes = results[3].status === "fulfilled" ? results[3].value : null;
  if (remRes) {
    counts.remediationFailed = remRes.job_counts?.failed || 0;
    const failedJobs = (remRes.recent_jobs || []).filter((j) => j.status === "failed");
    for (const j of failedJobs) {
      tasks.push({
        id: `rem-${j.id}`,
        priority: "high",
        type: "remediation_failed",
        typeLabel: "Remediation",
        object: j.name || j.id,
        description: "Remediation failed",
        since: j.created_at ? timeAgo(new Date(j.created_at).getTime()) : "?",
        timestamp: j.created_at ? new Date(j.created_at).getTime() : 0,
        link: "/remediation",
      });
    }
  }

  // Critical findings
  const findRes = results[4].status === "fulfilled" ? results[4].value : null;
  if (findRes?.findings) {
    counts.findings = findRes.total || findRes.findings.length;
    for (const f of findRes.findings) {
      tasks.push({
        id: `finding-${f.id}`,
        priority: f.severity === "critical" ? "critical" : "high",
        type: "finding",
        typeLabel: "Finding",
        object: f.node_hostname || f.hostname || f.title || "Unknown",
        description: f.title || "Security finding",
        since: f.created_at ? timeAgo(new Date(f.created_at).getTime()) : "?",
        timestamp: f.created_at ? new Date(f.created_at).getTime() : 0,
        link: "/security/findings",
      });
    }
  }

  // Offline nodes
  const nodesRes = results[5].status === "fulfilled" ? results[5].value : null;
  if (nodesRes?.nodes) {
    const TEN_MINUTES = 10 * 60 * 1000;
    const offlineNodes = nodesRes.nodes.filter((n) => {
      if (n.status === "online") return false;
      if (n.last_seen && (Date.now() - new Date(n.last_seen).getTime()) < TEN_MINUTES) return false;
      return true;
    });
    counts.offline = offlineNodes.length;
    for (const n of offlineNodes) {
      const lastSeen = n.last_seen ? new Date(n.last_seen).getTime() : 0;
      const hoursOffline = lastSeen ? (Date.now() - lastSeen) / 3600000 : 999;
      tasks.push({
        id: `offline-${n.id}`,
        priority: hoursOffline > 72 ? "high" : "medium",
        type: "offline",
        typeLabel: "Offline",
        object: n.hostname || n.id,
        description: `Offline${hoursOffline < 999 ? ` >${Math.floor(hoursOffline)}h` : ""}`,
        since: lastSeen ? timeAgo(lastSeen) : "?",
        timestamp: lastSeen || 0,
        link: `/nodes/${n.id}`,
      });
    }
  }

  // Alerts
  const alertRes = results[6].status === "fulfilled" ? results[6].value : null;
  if (alertRes?.alerts) {
    for (const a of alertRes.alerts) {
      const sev = (a.severity || "").toLowerCase();
      tasks.push({
        id: `alert-${a.id}`,
        priority: sev === "critical" ? "critical" : sev === "high" ? "high" : "medium",
        type: "alert",
        typeLabel: "Alert",
        object: a.title || "Alert",
        description: a.message || a.title || "Alert triggered",
        since: a.created_at ? timeAgo(new Date(a.created_at).getTime()) : "?",
        timestamp: a.created_at ? new Date(a.created_at).getTime() : 0,
        link: "/alerts",
      });
    }
  }

  // Sort: priority first, then recency
  tasks.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    return b.timestamp - a.timestamp;
  });

  return { tasks, counts };
}

// ─── Component ───────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTasks();
      setTasks(result.tasks);
      setCounts(result.counts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "critical") return tasks.filter((t) => t.priority === "critical");
    const types = FILTER_MAP[filter] || [];
    return tasks.filter((t) => types.includes(t.type));
  }, [tasks, filter]);

  const summaryCards = [
    { label: "Pending Approvals", value: counts.approvals || 0, icon: <UserCheck className="h-4 w-4" /> },
    { label: "Critical Findings", value: counts.findings || 0, icon: <ShieldAlert className="h-4 w-4" /> },
    { label: "Failed Jobs", value: counts.failedJobs || 0, icon: <Briefcase className="h-4 w-4" /> },
    { label: "Offline Devices", value: counts.offline || 0, icon: <WifiOff className="h-4 w-4" /> },
    { label: "Unpatched CVEs", value: counts.cves || 0, icon: <Bug className="h-4 w-4" /> },
    { label: "Failed Remediations", value: counts.remediationFailed || 0, icon: <AlertTriangle className="h-4 w-4" /> },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Tasks</h1>
          <p className="text-muted-foreground text-sm">Your action items across the system</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {summaryCards.map((c) => (
          <Card key={c.label} className="border-zinc-800">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="text-muted-foreground">{c.icon}</div>
              <div>
                <div className="text-2xl font-bold">{loading ? "…" : c.value}</div>
                <div className="text-xs text-muted-foreground">{c.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={setFilter} className="mb-4">
        <TabsList>
          <TabsTrigger value="all">All ({tasks.length})</TabsTrigger>
          <TabsTrigger value="critical">Critical</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Task Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-zinc-900 rounded animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-zinc-800">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
            <p className="text-lg font-semibold">All clear!</p>
            <p className="text-muted-foreground text-sm">No tasks matching this filter.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Priority</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead>Object</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-20">Since</TableHead>
                <TableHead className="w-24">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Badge className={`${PRIORITY_COLORS[t.priority]} text-xs`}>
                      {t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      {TYPE_ICONS[t.type]} {t.typeLabel}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{t.object}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{t.description}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {t.since}</div>
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={t.link}>View</Link>
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
