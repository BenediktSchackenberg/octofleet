"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import {
  Shield, AlertCircle, Monitor, Activity, FileText, ClipboardCheck,
  Server, Wrench, Eye, ChevronDown, CheckCircle, XCircle,
  Bug, Bell, Zap, BarChart3, Clock, Download, LucideIcon,
} from "lucide-react";
import {
  StatCard,
  QuickActionCard,
  ActivityFeed,
  ComplianceGauge,
  type ActivityItem,
} from "./DashboardWidgets";

// ─── Types ───────────────────────────────────────────────────────────

export type DashboardRole = "admin" | "operator" | "auditor" | "viewer";

interface RoleDashboardProps {
  role: DashboardRole;
  onRoleSwitch?: (role: DashboardRole) => void;
  /** If provided, render children as the main content (used for admin to keep existing dashboard) */
  children?: React.ReactNode;
}

interface DashboardSummary {
  counts: { total: number; online: number; away: number; offline: number; unassigned: number };
  vulnerabilities?: { critical: number; high: number; medium: number; low: number };
  jobs?: { pending: number; running: number; completed: number; failed: number; success: number };
}

interface TaskCounts {
  approvals: number;
  findings: number;
  failedJobs: number;
  offline: number;
}

interface SystemHealth {
  status: string;
  database: string;
}

interface EventLogEntry {
  id: string;
  event_type: string;
  subject: string;
  timestamp: string;
}

// ─── Role labels ─────────────────────────────────────────────────────

const roleLabels: Record<DashboardRole, { labelKey: string; icon: LucideIcon }> = {
  admin: { labelKey: "dashboard.roles.admin", icon: Shield },
  operator: { labelKey: "dashboard.roles.operator", icon: Wrench },
  auditor: { labelKey: "dashboard.roles.auditor", icon: FileText },
  viewer: { labelKey: "dashboard.roles.viewer", icon: Eye },
};

const allRoles: DashboardRole[] = ["admin", "operator", "auditor", "viewer"];

// ─── Role Banner ─────────────────────────────────────────────────────

function RoleBanner({ role, onSwitch }: { role: DashboardRole; onSwitch: (r: DashboardRole) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { labelKey, icon: RoleIcon } = roleLabels[role];

  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-border/40">
        <RoleIcon className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-zinc-200 font-medium">{t("dashboard.viewingAs")} <span className="font-bold">{t(labelKey)}</span></span>
        <span className="text-zinc-500">·</span>
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-0.5"
          >
            {t("dashboard.switchRole")} <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-border rounded-lg shadow-xl z-50 min-w-[140px]">
              {allRoles.filter(r => r !== role).map(r => {
                const { labelKey: rl, icon: RI } = roleLabels[r];
                return (
                  <button
                    key={r}
                    onClick={() => { onSwitch(r); setOpen(false); }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-zinc-800 text-sm text-zinc-200 first:rounded-t-lg last:rounded-b-lg"
                  >
                    <RI className="h-3.5 w-3.5 text-zinc-400" />
                    {t(rl)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ─────────────────────────────────────────────────

function AdminDashboard() {
  // Admin renders the existing full dashboard passed as children — see RoleDashboard
  return null;
}

// ─── Operator Dashboard ──────────────────────────────────────────────

function OperatorDashboard() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [taskCounts, setTaskCounts] = useState<TaskCounts | null>(null);
  const [alerts, setAlerts] = useState<Array<{ id: string; severity: string; title: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.get<DashboardSummary>("/dashboard/summary"),
      apiClient.get<TaskCounts>("/dashboard/tasks", { showErrorToast: false }),
      apiClient.get<Array<{ id: string; severity: string; title: string; created_at: string }>>("/alerts?limit=10", { showErrorToast: false }),
    ]).then(([s, t, a]) => {
      if (s) setSummary(s);
      if (t) setTaskCounts(t);
      if (a) setAlerts(Array.isArray(a) ? a : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardLoadingSkeleton />;

  const jobs = summary?.jobs;
  const criticalNodes = summary?.counts.offline ?? 0;
  const totalVulns = summary?.vulnerabilities
    ? summary.vulnerabilities.critical + summary.vulnerabilities.high + summary.vulnerabilities.medium + summary.vulnerabilities.low
    : 0;
  const patchCompliance = totalVulns > 0
    ? Math.round(((summary?.vulnerabilities?.low ?? 0) / totalVulns) * 100)
    : 100;

  const alertItems: ActivityItem[] = alerts.slice(0, 8).map((a, i) => ({
    id: a.id || String(i),
    icon: a.severity === "critical" ? XCircle : a.severity === "high" ? AlertCircle : Bell,
    description: a.title,
    timestamp: new Date(a.created_at).toLocaleString(),
    variant: (a.severity === "critical" ? "danger" : a.severity === "high" ? "warning" : "default") as "danger" | "warning" | "default",
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={XCircle} label={t("dashboard.failedJobs")} value={jobs?.failed ?? 0} trend={jobs?.failed ? "down" : "neutral"} />
        <StatCard icon={Activity} label={t("dashboard.runningJobs")} value={jobs?.running ?? 0} trend="neutral" />
        <StatCard icon={Monitor} label={t("dashboard.offlineNodesStat")} value={criticalNodes} trend={criticalNodes > 0 ? "down" : "up"} />
        <StatCard icon={Bug} label={t("dashboard.openFindings")} value={taskCounts?.findings ?? 0} trend={taskCounts?.findings ? "down" : "neutral"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ComplianceGauge percentage={patchCompliance} label={t("dashboard.patchCompliance")} />
        <ActivityFeed items={alertItems} title={t("dashboard.recentAlerts")} emptyMessage={t("dashboard.noRecentAlerts")} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <QuickActionCard icon={Zap} title={t("dashboard.quickScan")} description={t("dashboard.quickScanDescription")} onClick={() => {}} />
        <QuickActionCard icon={Server} title={t("dashboard.viewNodes")} description={t("dashboard.viewNodesDescription")} onClick={() => window.location.href = "/nodes"} />
        <QuickActionCard icon={BarChart3} title={t("dashboard.jobHistory")} description={t("dashboard.jobHistoryDescription")} onClick={() => window.location.href = "/jobs"} />
      </div>
    </div>
  );
}

// ─── Auditor Dashboard ───────────────────────────────────────────────

function AuditorDashboard() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.get<DashboardSummary>("/dashboard/summary"),
      apiClient.get<EventLogEntry[]>("/eventlog?limit=15", { showErrorToast: false }),
    ]).then(([s, e]) => {
      if (s) setSummary(s);
      if (e) setEvents(Array.isArray(e) ? e : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardLoadingSkeleton />;

  const vulns = summary?.vulnerabilities;
  const totalFindings = vulns ? vulns.critical + vulns.high + vulns.medium + vulns.low : 0;
  const complianceScore = totalFindings > 0
    ? Math.round(100 - ((vulns?.critical ?? 0) * 4 + (vulns?.high ?? 0) * 2 + (vulns?.medium ?? 0)) / totalFindings * 10)
    : 100;

  const auditItems: ActivityItem[] = events.slice(0, 10).map((e, i) => ({
    id: e.id || String(i),
    icon: ClipboardCheck,
    description: `${e.event_type}: ${e.subject}`,
    timestamp: e.timestamp ? new Date(e.timestamp).toLocaleString() : "—",
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Shield} label={t("dashboard.criticalFindings")} value={vulns?.critical ?? 0} trend={vulns?.critical ? "down" : "up"} trendLabel={vulns?.critical ? t("dashboard.needsAttention") : t("dashboard.clean")} />
        <StatCard icon={AlertCircle} label={t("dashboard.highFindings")} value={vulns?.high ?? 0} trend="neutral" />
        <StatCard icon={Bug} label={t("dashboard.totalFindings")} value={totalFindings} trend="neutral" />
        <StatCard icon={FileText} label={t("dashboard.auditEvents")} value={events.length} trend="neutral" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ComplianceGauge percentage={Math.max(0, complianceScore)} label={t("dashboard.securityPosture")} size="lg" />
        <ActivityFeed items={auditItems} title={t("dashboard.recentAuditLog")} emptyMessage={t("dashboard.noAuditEntries")} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <QuickActionCard icon={Download} title={t("dashboard.exportReport")} description={t("dashboard.exportReportDescription")} onClick={() => {}} />
        <QuickActionCard icon={ClipboardCheck} title={t("dashboard.auditLog")} description={t("dashboard.auditLogDescription")} onClick={() => window.location.href = "/eventlog"} />
        <QuickActionCard icon={Shield} title={t("dashboard.securityFindings")} description={t("dashboard.securityFindingsDescription")} onClick={() => window.location.href = "/security"} />
      </div>
    </div>
  );
}

// ─── Viewer Dashboard (read-only summary) ────────────────────────────

function ViewerDashboard() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get<DashboardSummary>("/dashboard/summary").then(s => {
      if (s) setSummary(s);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardLoadingSkeleton />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Monitor} label={t("dashboard.totalNodes")} value={summary?.counts.total ?? 0} trend="neutral" />
        <StatCard icon={CheckCircle} label={t("common.online")} value={summary?.counts.online ?? 0} trend="up" />
        <StatCard icon={Clock} label={t("nodeDetail.away")} value={summary?.counts.away ?? 0} trend="neutral" />
        <StatCard icon={XCircle} label={t("common.offline")} value={summary?.counts.offline ?? 0} trend={summary?.counts.offline ? "down" : "neutral"} />
      </div>
      <Card className="border-border/50 shadow-md">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Eye className="h-8 w-8 mx-auto mb-2 text-zinc-500" />
          <p className="text-sm">{t("dashboard.readOnly")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────

function DashboardLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4">
              <div className="animate-pulse space-y-2">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-8 w-12 bg-muted rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function RoleDashboard({ role: initialRole, onRoleSwitch, children }: RoleDashboardProps) {
  const [activeRole, setActiveRole] = useState<DashboardRole>(initialRole);

  const handleSwitch = useCallback((r: DashboardRole) => {
    setActiveRole(r);
    onRoleSwitch?.(r);
  }, [onRoleSwitch]);

  return (
    <div>
      <RoleBanner role={activeRole} onSwitch={handleSwitch} />
      {activeRole === "admin" && children ? children : (
        activeRole === "admin" ? <AdminDashboard /> :
        activeRole === "operator" ? <OperatorDashboard /> :
        activeRole === "auditor" ? <AuditorDashboard /> :
        <ViewerDashboard />
      )}
    </div>
  );
}
