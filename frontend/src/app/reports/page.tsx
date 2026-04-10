"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  BarChart3,
  Calendar,
  Clock,
  Download,
  FileText,
  Mail,
  Play,
  RefreshCw,
  Server,
  Shield,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

import { apiClient } from "@/lib/api-client";
import { API_BASE } from "@/lib/api-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TabKey = "dashboard" | "catalog" | "schedules" | "history";

interface Report {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  outputFormats: string[];
  parameters: Array<{ name: string; label?: string; type?: string; default?: string }>;
}

interface Execution {
  id: string;
  reportId: string;
  reportName?: string;
  status: string;
  outputFormat: string;
  fileSizeBytes: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Schedule {
  id: string;
  reportId: string;
  reportName?: string;
  cronExpression: string;
  deliveryMethod: string;
  outputFormat: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  deliveryConfig?: Record<string, string>;
}

interface Delivery {
  id: string;
  deliveredAt: string;
  deliveryStatus: string;
  errorMessage?: string | null;
  executionStatus?: string;
}

interface DashboardData {
  kpis: {
    totalNodes: number;
    onlineNodes: number;
    criticalVulns: number;
    openFindings: number;
    activeAlerts: number;
    patchCompliancePct: number;
  };
  trend7d: Array<{ date: string; online: number; alerts: number }>;
  topVulnerabilities: Array<{ cve: string; severity: string; affectedNodes: number }>;
  patchStatus: { upToDate: number; updatesAvailable: number; criticalUpdates: number };
  recentJobs: Array<{ name: string; status: string; nodeCount: number; createdAt: string }>;
}

const TABS: Array<{ id: TabKey; label: string; icon: React.ReactNode }> = [
  { id: "dashboard", label: "Executive Dashboard", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "catalog", label: "Report Catalog", icon: <FileText className="h-4 w-4" /> },
  { id: "schedules", label: "Scheduled Reports", icon: <Calendar className="h-4 w-4" /> },
  { id: "history", label: "History", icon: <Clock className="h-4 w-4" /> },
];

const CATEGORIES = ["All", "Fleet", "Security", "Compliance", "Operations", "Executive"];

const PIE_COLORS = ["#22c55e", "#f59e0b", "#ef4444"];

const fmtDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "—");
const fmtBytes = (b?: number | null) => (!b ? "—" : b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const cronHint = (cron: string) => {
  if (cron === "0 8 * * *") return "Täglich um 08:00";
  if (cron === "0 8 * * 1") return "Wöchentlich montags";
  if (cron === "0 8 1 * *") return "Monatlich am 1.";
  return "Custom";
};

export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});

  const [selectedCategory, setSelectedCategory] = useState("All");
  const [search, setSearch] = useState("");

  const [runDialog, setRunDialog] = useState<Report | null>(null);
  const [runFormat, setRunFormat] = useState("csv");
  const [runParams, setRunParams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    reportId: "",
    name: "",
    cron: "0 8 * * *",
    outputFormat: "pdf",
    deliveryMethod: "email",
    email: "",
    enabled: true,
  });

  const [historyPage, setHistoryPage] = useState(1);
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyReport, setHistoryReport] = useState("all");

  const loadAll = useCallback(async () => {
    const [dash, catalog, execs, sched] = await Promise.all([
      apiClient.get<DashboardData>("/reports/executive-dashboard", { camelCase: true }),
      apiClient.get<Report[]>("/reports/catalog", { camelCase: true }),
      apiClient.get<Execution[]>("/reports/executions", { camelCase: true }),
      apiClient.get<Schedule[]>("/reports/schedules", { camelCase: true }),
    ]);
    if (dash) setDashboard(dash);
    if (catalog) setReports(catalog);
    if (execs) setExecutions(execs);
    if (sched) setSchedules(sched);
    setLoading(false);
  }, []);

  useEffect(() => {
    const run = async () => {
      await loadAll();
    };
    void run();
  }, [loadAll]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const dash = await apiClient.get<DashboardData>("/reports/executive-dashboard", { camelCase: true, showErrorToast: false });
      if (dash) setDashboard(dash);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const catOk = selectedCategory === "All" || r.category === selectedCategory;
      const s = search.toLowerCase();
      const searchOk = !s || r.name.toLowerCase().includes(s) || r.description?.toLowerCase().includes(s);
      return catOk && searchOk;
    });
  }, [reports, selectedCategory, search]);

  const openRun = (r: Report) => {
    setRunDialog(r);
    setRunFormat(r.outputFormats?.includes("pdf") ? "pdf" : "csv");
    setRunParams({});
  };

  const executeReport = async () => {
    if (!runDialog) return;
    setRunning(true);
    const created = await apiClient.post<{ id: string; status: string }>("/reports/execute", {
      slug: runDialog.slug,
      output_format: runFormat,
      parameters: runParams,
    });
    if (!created) {
      setRunning(false);
      return;
    }

    toast.info("Report wird generiert...");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const exec = await apiClient.get<Execution>(`/reports/executions/${created.id}`, { camelCase: true, showErrorToast: false });
      if (!exec) continue;
      if (exec.status === "completed") {
        toast.success("Report fertig — Download startet");
        window.open(`${API_BASE}/reports/executions/${exec.id}/download`, "_blank");
        break;
      }
      if (exec.status === "failed") {
        toast.error("Report fehlgeschlagen");
        break;
      }
    }

    setRunDialog(null);
    setRunning(false);
    const execs = await apiClient.get<Execution[]>("/reports/executions", { camelCase: true, showErrorToast: false });
    if (execs) setExecutions(execs);
  };

  const createSchedule = async () => {
    const body = {
      report_id: scheduleForm.reportId,
      name: scheduleForm.name || "Scheduled Report",
      cron_expression: scheduleForm.cron,
      output_format: scheduleForm.outputFormat,
      delivery_method: scheduleForm.deliveryMethod,
      delivery_config: scheduleForm.deliveryMethod === "email" ? { email: scheduleForm.email } : {},
      enabled: scheduleForm.enabled,
      parameters: {},
    };
    const res = await apiClient.post("/reports/schedules", body);
    if (res) {
      toast.success("Schedule erstellt");
      setScheduleDialog(false);
      const sched = await apiClient.get<Schedule[]>("/reports/schedules", { camelCase: true });
      if (sched) setSchedules(sched);
    }
  };

  const runNow = async (id: string) => {
    const ok = await apiClient.post(`/reports/schedules/${id}/run-now`, {});
    if (ok) toast.success("Run now gestartet");
  };

  const toggleSchedule = async (s: Schedule) => {
    const updated = await apiClient.put<Schedule>(`/reports/schedules/${s.id}`, { enabled: !s.enabled }, { camelCase: true });
    if (updated) {
      setSchedules((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
      toast.success(`Schedule ${updated.enabled ? "aktiviert" : "deaktiviert"}`);
    }
  };

  const loadDeliveries = async (id: string) => {
    const rows = await apiClient.get<Delivery[]>(`/reports/schedules/${id}/deliveries`, { camelCase: true, showErrorToast: false });
    if (rows) setDeliveries((prev) => ({ ...prev, [id]: rows }));
  };

  const historyFiltered = useMemo(() => {
    const out = executions.filter((e) => {
      if (historyStatus !== "all" && e.status !== historyStatus) return false;
      if (historyReport !== "all" && e.reportId !== historyReport) return false;
      return true;
    });
    return out;
  }, [executions, historyReport, historyStatus]);

  const paged = historyFiltered.slice((historyPage - 1) * 20, historyPage * 20);

  if (loading) {
    return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 rounded-xl bg-zinc-900 animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Enterprise Reporting Suite</h1>
          <p className="text-zinc-400">E35 Dashboard, Catalog, Schedules & History</p>
        </div>
        <Button variant="outline" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.id} variant={tab === t.id ? "default" : "outline"} onClick={() => setTab(t.id)}>
            {t.icon}<span className="ml-2">{t.label}</span>
          </Button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
          {tab === "dashboard" && dashboard && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[{ l: "Total Nodes", v: dashboard.kpis.totalNodes, i: <Server className="h-4 w-4" /> }, { l: "Online", v: dashboard.kpis.onlineNodes, i: <Zap className="h-4 w-4" /> }, { l: "Critical Vulns", v: dashboard.kpis.criticalVulns, i: <Shield className="h-4 w-4" /> }, { l: "Open Findings", v: dashboard.kpis.openFindings, i: <FileText className="h-4 w-4" /> }, { l: "Patch Compliance", v: `${dashboard.kpis.patchCompliancePct}%`, i: <TrendingUp className="h-4 w-4" /> }].map((k) => (
                  <Card key={k.l}><CardContent className="p-4"><div className="text-zinc-400">{k.i}</div><div className="text-xl font-bold">{k.v}</div><div className="text-xs text-zinc-400">{k.l}</div></CardContent></Card>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card><CardHeader><CardTitle>7-Day Trend</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={dashboard.trend7d}><XAxis dataKey="date" /><YAxis /><Tooltip /><Line dataKey="online" stroke="#22c55e" strokeWidth={2} /><Line dataKey="alerts" stroke="#ef4444" strokeWidth={2} /></LineChart></ResponsiveContainer></CardContent></Card>
                <Card><CardHeader><CardTitle>Patch Status</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: "Up to date", value: dashboard.patchStatus.upToDate }, { name: "Updates", value: dashboard.patchStatus.updatesAvailable }, { name: "Critical", value: dashboard.patchStatus.criticalUpdates }]} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95}>
                  {[0, 1, 2].map((i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie><Tooltip /></PieChart></ResponsiveContainer></CardContent></Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card><CardHeader><CardTitle>Top Vulnerabilities</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>CVE</TableHead><TableHead>Severity</TableHead><TableHead>Affected</TableHead></TableRow></TableHeader><TableBody>{dashboard.topVulnerabilities.map((v) => <TableRow key={v.cve}><TableCell>{v.cve}</TableCell><TableCell><Badge>{v.severity}</Badge></TableCell><TableCell>{v.affectedNodes}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
                <Card><CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader><CardContent><div className="space-y-2">{dashboard.recentJobs.map((j, i) => <div key={`${j.name}-${i}`} className="p-2 rounded border border-zinc-800"><div className="font-medium">{j.name}</div><div className="text-xs text-zinc-400">{j.status} • Nodes: {j.nodeCount} • {fmtDate(j.createdAt)}</div></div>)}</div></CardContent></Card>
              </div>
            </div>
          )}

          {tab === "catalog" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => <Button key={c} variant={selectedCategory === c ? "default" : "outline"} onClick={() => setSelectedCategory(c)}>{c}</Button>)}
                <Input className="max-w-sm" placeholder="Search report..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredReports.map((r) => (
                  <Card key={r.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{r.name}</CardTitle>
                      <CardDescription>{r.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <Badge>{r.category}</Badge>
                        <div className="flex gap-1">{r.outputFormats?.map((f) => <Badge key={f} variant="outline">{f.toUpperCase()}</Badge>)}</div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button className="flex-1" onClick={() => openRun(r)}><Play className="h-4 w-4 mr-2" />Generate</Button>
                        <Button variant="outline" className="flex-1" onClick={() => { setScheduleDialog(true); setScheduleForm((x) => ({ ...x, reportId: r.id, outputFormat: r.outputFormats?.[0] || "pdf", name: `${r.name} Schedule` })); }}><Calendar className="h-4 w-4 mr-2" />Schedule</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {tab === "schedules" && (
            <div className="space-y-4">
              <div className="flex justify-end"><Button onClick={() => setScheduleDialog(true)}><Calendar className="h-4 w-4 mr-2" />New Schedule</Button></div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Cron</TableHead><TableHead>Delivery</TableHead><TableHead>Last</TableHead><TableHead>Next</TableHead><TableHead>Enabled</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {schedules.map((s) => (
                        <Fragment key={s.id}>
                          <TableRow>
                            <TableCell>{s.reportName || s.reportId}</TableCell>
                            <TableCell><code>{s.cronExpression}</code><div className="text-xs text-zinc-400">{cronHint(s.cronExpression)}</div></TableCell>
                            <TableCell className="capitalize flex items-center gap-1">{s.deliveryMethod === "email" && <Mail className="h-3 w-3" />}{s.deliveryMethod}</TableCell>
                            <TableCell>{fmtDate(s.lastRunAt)}</TableCell>
                            <TableCell>{fmtDate(s.nextRunAt)}</TableCell>
                            <TableCell><input type="checkbox" checked={s.enabled} onChange={() => toggleSchedule(s)} /></TableCell>
                            <TableCell className="space-x-2">
                              <Button size="sm" variant="outline" onClick={() => runNow(s.id)}>Run now</Button>
                              <Button size="sm" variant="ghost" onClick={() => loadDeliveries(s.id)}>History</Button>
                            </TableCell>
                          </TableRow>
                          {deliveries[s.id]?.length ? (
                            <TableRow key={`${s.id}-deliveries`}>
                              <TableCell colSpan={7}>
                                <div className="space-y-1 text-sm">
                                  {deliveries[s.id].slice(0, 10).map((d) => (
                                    <div key={d.id} className="flex justify-between border-b border-zinc-800 py-1">
                                      <span>{fmtDate(d.deliveredAt)}</span>
                                      <span>{d.deliveryStatus}</span>
                                      <span className="text-zinc-400">{d.executionStatus}</span>
                                      <span className="text-red-400">{d.errorMessage || ""}</span>
                                    </div>
                                  ))}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Select value={historyStatus} onValueChange={setHistoryStatus}><SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="running">Running</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select>
                <Select value={historyReport} onValueChange={setHistoryReport}><SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Reports</SelectItem>{reports.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
                <Button variant="outline" onClick={() => toast.info("Bulk delete kommt als nächster Schritt")}>Bulk delete old</Button>
              </div>
              <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Status</TableHead><TableHead>Format</TableHead><TableHead>Size</TableHead><TableHead>Generated</TableHead><TableHead /></TableRow></TableHeader><TableBody>{paged.map((e) => <TableRow key={e.id}><TableCell>{e.reportName || e.reportId}</TableCell><TableCell><Badge>{e.status}</Badge></TableCell><TableCell>{e.outputFormat}</TableCell><TableCell>{fmtBytes(e.fileSizeBytes)}</TableCell><TableCell>{fmtDate(e.createdAt)}</TableCell><TableCell>{e.status === "completed" ? <Button size="sm" variant="outline" onClick={() => window.open(`${API_BASE}/reports/executions/${e.id}/download`, "_blank")}><Download className="h-4 w-4" /></Button> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
              <div className="flex justify-end gap-2"><Button variant="outline" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)}>Prev</Button><Button variant="outline" disabled={historyPage * 20 >= historyFiltered.length} onClick={() => setHistoryPage((p) => p + 1)}>Next</Button></div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <Dialog open={!!runDialog} onOpenChange={(v) => !v && setRunDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Run Report</DialogTitle><DialogDescription>{runDialog?.name}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Output format</Label><Select value={runFormat} onValueChange={setRunFormat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pdf">PDF</SelectItem><SelectItem value="csv">CSV</SelectItem></SelectContent></Select></div>
            {runDialog?.parameters?.map((p) => (
              <div key={p.name}><Label>{p.label || p.name}</Label><Input value={runParams[p.name] || ""} onChange={(e) => setRunParams((prev) => ({ ...prev, [p.name]: e.target.value }))} /></div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRunDialog(null)}>Cancel</Button><Button onClick={executeReport} disabled={running}><Play className="h-4 w-4 mr-2" />Generate</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleDialog} onOpenChange={setScheduleDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Schedule</DialogTitle><DialogDescription>Create recurring report delivery</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Report</Label><Select value={scheduleForm.reportId} onValueChange={(v) => setScheduleForm((s) => ({ ...s, reportId: v }))}><SelectTrigger><SelectValue placeholder="Select report" /></SelectTrigger><SelectContent>{reports.map((r) => <SelectItem value={r.id} key={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Name</Label><Input value={scheduleForm.name} onChange={(e) => setScheduleForm((s) => ({ ...s, name: e.target.value }))} /></div>
            <div><Label>Cron Expression</Label><Input value={scheduleForm.cron} onChange={(e) => setScheduleForm((s) => ({ ...s, cron: e.target.value }))} /></div>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setScheduleForm((s) => ({ ...s, cron: "0 8 * * *" }))}>Daily</Button><Button type="button" variant="outline" onClick={() => setScheduleForm((s) => ({ ...s, cron: "0 8 * * 1" }))}>Weekly</Button><Button type="button" variant="outline" onClick={() => setScheduleForm((s) => ({ ...s, cron: "0 8 1 * *" }))}>Monthly</Button></div>
            <div><Label>Output</Label><Select value={scheduleForm.outputFormat} onValueChange={(v) => setScheduleForm((s) => ({ ...s, outputFormat: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pdf">PDF</SelectItem><SelectItem value="csv">CSV</SelectItem></SelectContent></Select></div>
            <div><Label>Delivery</Label><Select value={scheduleForm.deliveryMethod} onValueChange={(v) => setScheduleForm((s) => ({ ...s, deliveryMethod: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="download">Download</SelectItem></SelectContent></Select></div>
            {scheduleForm.deliveryMethod === "email" && <div><Label>Email</Label><Input type="email" value={scheduleForm.email} onChange={(e) => setScheduleForm((s) => ({ ...s, email: e.target.value }))} /></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setScheduleDialog(false)}>Cancel</Button><Button onClick={createSchedule}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
