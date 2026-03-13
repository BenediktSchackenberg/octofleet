"use client";

import { apiClient } from "@/lib/api-client";
import { API_BASE } from "@/lib/api-config";
import { useState, useEffect, useCallback } from "react";
import {
  FileText, Download, Calendar, Loader2, Shield, Server, Package,
  BarChart3, Zap, ShieldCheck, Play, Clock, Trash2, Plus, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Types ───────────────────────────────────────────────────────────

interface ReportParameter {
  name: string;
  label: string;
  type: "select" | "date" | "text" | "number";
  options?: { label: string; value: string }[];
  default?: string;
  required?: boolean;
}

interface Report {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  parameters: ReportParameter[];
  output_formats: string[];
}

interface Execution {
  id: string;
  report_id: string;
  report_name?: string;
  status: "running" | "completed" | "failed" | "pending";
  output_format: string;
  file_size_bytes: number | null;
  started_at: string;
  completed_at: string | null;
}

interface Schedule {
  id: string;
  report_id: string;
  report_name?: string;
  name: string;
  cron_expression: string;
  delivery_method: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  output_format?: string;
}

interface Stats {
  totalReports: number;
  totalSchedules: number;
  executionsThisWeek: number;
  avgDuration: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const CATEGORIES = ["All", "Fleet", "Security", "Compliance", "Software", "Operations", "Executive"] as const;

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Fleet: <Server className="h-5 w-5" />,
  Security: <Shield className="h-5 w-5" />,
  Compliance: <ShieldCheck className="h-5 w-5" />,
  Software: <Package className="h-5 w-5" />,
  Operations: <Zap className="h-5 w-5" />,
  Executive: <BarChart3 className="h-5 w-5" />,
};

const CRON_PRESETS = [
  { label: "Daily 8am", value: "0 8 * * *" },
  { label: "Weekly Monday", value: "0 8 * * 1" },
  { label: "Monthly 1st", value: "0 8 1 * *" },
  { label: "Every 6h", value: "0 */6 * * *" },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "running": case "pending": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
    default: return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  }
}

// ─── Page Component ──────────────────────────────────────────────────

export default function ReportsPage() {
  const [tab, setTab] = useState("catalog");
  const [category, setCategory] = useState("All");
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [generateReport, setGenerateReport] = useState<Report | null>(null);
  const [generateParams, setGenerateParams] = useState<Record<string, string>>({});
  const [generateFormat, setGenerateFormat] = useState("");
  const [generating, setGenerating] = useState(false);

  const [scheduleReport, setScheduleReport] = useState<Report | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    name: "", cron: "", delivery: "download", config: "", format: "",
  });
  const [scheduling, setScheduling] = useState(false);

  // ─── Data fetching ─────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const [catalogRes, execRes, schedRes, statsRes] = await Promise.all([
      apiClient.get<{ reports: Report[] }>("/reports/catalog"),
      apiClient.get<{ executions: Execution[] }>("/reports/executions"),
      apiClient.get<{ schedules: Schedule[] }>("/reports/schedules"),
      apiClient.get<Stats>("/reports/stats", { showErrorToast: false }),
    ]);
    if (catalogRes?.reports) setReports(catalogRes.reports);
    if (execRes?.executions) setExecutions(execRes.executions);
    if (schedRes?.schedules) setSchedules(schedRes.schedules);
    if (statsRes) setStats(statsRes);
    setLoading(false);
  }, []);

  const fetchExecutions = useCallback(async () => {
    const res = await apiClient.get<{ executions: Execution[] }>("/reports/executions", { showErrorToast: false });
    if (res?.executions) setExecutions(res.executions);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Poll executions while any are running
  useEffect(() => {
    const hasRunning = executions.some((e) => e.status === "running" || e.status === "pending");
    if (!hasRunning) return;
    const interval = setInterval(fetchExecutions, 3000);
    return () => clearInterval(interval);
  }, [executions, fetchExecutions]);

  // ─── Actions ───────────────────────────────────────────────────────

  const openGenerate = (report: Report) => {
    setGenerateReport(report);
    const defaults: Record<string, string> = {};
    report.parameters?.forEach((p) => { if (p.default) defaults[p.name] = p.default; });
    setGenerateParams(defaults);
    setGenerateFormat(report.output_formats?.[0] || "pdf");
  };

  const executeReport = async () => {
    if (!generateReport) return;
    setGenerating(true);
    const res = await apiClient.post<{ executionId: string; status: string }>("/reports/execute", {
      reportId: generateReport.id,
      parameters: Object.keys(generateParams).length > 0 ? generateParams : undefined,
      outputFormat: generateFormat,
    });
    setGenerating(false);
    if (res) {
      setGenerateReport(null);
      setTab("history");
      fetchExecutions();
    }
  };

  const openSchedule = (report?: Report) => {
    setScheduleReport(report || null);
    setScheduleForm({
      name: "",
      cron: "0 8 * * *",
      delivery: "download",
      config: "",
      format: report?.output_formats?.[0] || "pdf",
    });
  };

  const createSchedule = async () => {
    if (!scheduleReport) return;
    setScheduling(true);
    const body: Record<string, unknown> = {
      report_id: scheduleReport.id,
      name: scheduleForm.name || `${scheduleReport.name} Schedule`,
      cron_expression: scheduleForm.cron,
      delivery_method: scheduleForm.delivery,
      output_format: scheduleForm.format,
    };
    if (scheduleForm.delivery === "email") body.delivery_config = { email: scheduleForm.config };
    if (scheduleForm.delivery === "webhook") body.delivery_config = { url: scheduleForm.config };
    const res = await apiClient.post("/reports/schedules", body);
    setScheduling(false);
    if (res) {
      setScheduleReport(null);
      setTab("schedules");
      const schedRes = await apiClient.get<{ schedules: Schedule[] }>("/reports/schedules");
      if (schedRes?.schedules) setSchedules(schedRes.schedules);
    }
  };

  const deleteSchedule = async (id: string) => {
    await apiClient.delete(`/api/v1/reports/schedules/${id}`);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const downloadExecution = (id: string) => {
    window.open(`${API_BASE}/api/v1/reports/executions/${id}/download`);
  };

  // ─── Filtered reports ──────────────────────────────────────────────

  const filtered = category === "All" ? reports : reports.filter((r) => r.category === category);

  // Report name lookup
  const reportName = (id: string) => reports.find((r) => r.id === id)?.name || id;

  // ─── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <FileText className="h-6 w-6" /> Reports
        </h1>
        <p className="text-zinc-400 mt-1">Enterprise Reporting Suite</p>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Reports", value: stats.totalReports, icon: <FileText className="h-4 w-4" /> },
            { label: "Scheduled", value: stats.totalSchedules, icon: <Calendar className="h-4 w-4" /> },
            { label: "Executions This Week", value: stats.executionsThisWeek, icon: <Play className="h-4 w-4" /> },
            { label: "Avg Duration", value: `${stats.avgDuration}s`, icon: <Clock className="h-4 w-4" /> },
          ].map((s) => (
            <Card key={s.label} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="text-zinc-400">{s.icon}</div>
                <div>
                  <div className="text-xl font-bold text-zinc-100">{s.value}</div>
                  <div className="text-xs text-zinc-400">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-zinc-800 border-zinc-700">
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
        </TabsList>

        {/* ─── Catalog Tab ──────────────────────────────────────────── */}
        <TabsContent value="catalog" className="space-y-4">
          {/* Category filter pills */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant={category === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setCategory(cat)}
                className={category === cat
                  ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                }
              >
                {cat !== "All" && <span className="mr-1">{CATEGORY_ICONS[cat]}</span>}
                {cat}
              </Button>
            ))}
          </div>

          {/* Report cards grid */}
          {filtered.length === 0 ? (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-8 text-center text-zinc-400">
                No reports available in this category.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((report) => (
                <Card key={report.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 text-zinc-300">
                        {CATEGORY_ICONS[report.category] || <FileText className="h-5 w-5" />}
                        <CardTitle className="text-base text-zinc-100">{report.name}</CardTitle>
                      </div>
                    </div>
                    <CardDescription className="text-zinc-400 text-sm mt-1">
                      {report.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1">
                        {report.output_formats?.map((fmt) => (
                          <Badge key={fmt} variant="outline" className="text-xs border-zinc-700 text-zinc-400">
                            {fmt.toUpperCase()}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="border-zinc-700 text-zinc-300 hover:text-zinc-100"
                          onClick={() => openSchedule(report)}>
                          <Calendar className="h-3.5 w-3.5 mr-1" /> Schedule
                        </Button>
                        <Button size="sm" onClick={() => openGenerate(report)}>
                          <Play className="h-3.5 w-3.5 mr-1" /> Generate
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── History Tab ──────────────────────────────────────────── */}
        <TabsContent value="history">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-0">
              {executions.length === 0 ? (
                <div className="p-8 text-center text-zinc-400">
                  No report executions yet. Generate a report from the Catalog tab.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Report</TableHead>
                      <TableHead className="text-zinc-400">Format</TableHead>
                      <TableHead className="text-zinc-400">Status</TableHead>
                      <TableHead className="text-zinc-400">Size</TableHead>
                      <TableHead className="text-zinc-400">Started</TableHead>
                      <TableHead className="text-zinc-400">Duration</TableHead>
                      <TableHead className="text-zinc-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.map((exec) => (
                      <TableRow key={exec.id} className="border-zinc-800">
                        <TableCell className="text-zinc-200">{exec.report_name || reportName(exec.report_id)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                            {exec.output_format?.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={`${statusColor(exec.status)} border`}>
                            {exec.status === "running" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {exec.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-400">{formatBytes(exec.file_size_bytes)}</TableCell>
                        <TableCell className="text-zinc-400">{formatDate(exec.started_at)}</TableCell>
                        <TableCell className="text-zinc-400">{formatDuration(exec.started_at, exec.completed_at)}</TableCell>
                        <TableCell className="text-right">
                          {exec.status === "completed" && (
                            <Button size="sm" variant="ghost" className="text-zinc-400 hover:text-zinc-100"
                              onClick={() => downloadExecution(exec.id)}>
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Schedules Tab ────────────────────────────────────────── */}
        <TabsContent value="schedules" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => openSchedule(reports[0])} disabled={reports.length === 0}>
              <Plus className="h-4 w-4 mr-1" /> New Schedule
            </Button>
          </div>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-0">
              {schedules.length === 0 ? (
                <div className="p-8 text-center text-zinc-400">
                  No schedules configured yet. Create one from the Catalog or use the button above.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">Name</TableHead>
                      <TableHead className="text-zinc-400">Report</TableHead>
                      <TableHead className="text-zinc-400">Cron</TableHead>
                      <TableHead className="text-zinc-400">Delivery</TableHead>
                      <TableHead className="text-zinc-400">Enabled</TableHead>
                      <TableHead className="text-zinc-400">Last Run</TableHead>
                      <TableHead className="text-zinc-400">Next Run</TableHead>
                      <TableHead className="text-zinc-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.map((sched) => (
                      <TableRow key={sched.id} className="border-zinc-800">
                        <TableCell className="text-zinc-200 font-medium">{sched.name}</TableCell>
                        <TableCell className="text-zinc-300">{sched.report_name || reportName(sched.report_id)}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-300">{sched.cron_expression}</code>
                        </TableCell>
                        <TableCell className="text-zinc-400 capitalize">{sched.delivery_method}</TableCell>
                        <TableCell>
                          <Badge className={sched.enabled
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30"
                          }>
                            {sched.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-400">{formatDate(sched.last_run_at)}</TableCell>
                        <TableCell className="text-zinc-400">{formatDate(sched.next_run_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300"
                            onClick={() => deleteSchedule(sched.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Generate Report Dialog ───────────────────────────────────── */}
      <Dialog open={!!generateReport} onOpenChange={(open) => !open && setGenerateReport(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{generateReport?.name}</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Configure parameters and generate this report.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {generateReport?.parameters?.map((param) => (
              <div key={param.name} className="space-y-1.5">
                <Label className="text-zinc-300">{param.label}</Label>
                {param.type === "select" && param.options ? (
                  <Select
                    value={generateParams[param.name] || ""}
                    onValueChange={(v) => setGenerateParams((p) => ({ ...p, [param.name]: v }))}
                  >
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
                      <SelectValue placeholder={`Select ${param.label}`} />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {param.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={param.type === "date" ? "date" : param.type === "number" ? "number" : "text"}
                    value={generateParams[param.name] || ""}
                    onChange={(e) => setGenerateParams((p) => ({ ...p, [param.name]: e.target.value }))}
                    className="bg-zinc-800 border-zinc-700 text-zinc-200"
                    placeholder={param.label}
                  />
                )}
              </div>
            ))}

            {/* Output format */}
            {generateReport && generateReport.output_formats?.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Output Format</Label>
                <div className="flex gap-3">
                  {generateReport.output_formats.map((fmt) => (
                    <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="outputFormat"
                        value={fmt}
                        checked={generateFormat === fmt}
                        onChange={() => setGenerateFormat(fmt)}
                        className="accent-zinc-100"
                      />
                      <span className="text-zinc-300 text-sm">{fmt.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700 text-zinc-300" onClick={() => setGenerateReport(null)}>
              Cancel
            </Button>
            <Button onClick={executeReport} disabled={generating}>
              {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Schedule Dialog ──────────────────────────────────────────── */}
      <Dialog open={!!scheduleReport} onOpenChange={(open) => !open && setScheduleReport(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Report</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {scheduleReport ? `Schedule "${scheduleReport.name}" for automated generation.` : "Configure a report schedule."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Report selector if needed */}
            {reports.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Report</Label>
                <Select
                  value={scheduleReport?.id || ""}
                  onValueChange={(v) => {
                    const r = reports.find((r) => r.id === v);
                    if (r) setScheduleReport(r);
                  }}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {reports.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Schedule Name</Label>
              <Input
                value={scheduleForm.name}
                onChange={(e) => setScheduleForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-zinc-800 border-zinc-700 text-zinc-200"
                placeholder="e.g. Weekly Fleet Report"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Cron Expression</Label>
              <div className="flex gap-2">
                <Input
                  value={scheduleForm.cron}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, cron: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-zinc-200 flex-1"
                  placeholder="0 8 * * *"
                />
                <Select
                  value=""
                  onValueChange={(v) => setScheduleForm((f) => ({ ...f, cron: v }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200 w-[140px]">
                    <SelectValue placeholder="Presets" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {CRON_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300">Delivery Method</Label>
              <Select
                value={scheduleForm.delivery}
                onValueChange={(v) => setScheduleForm((f) => ({ ...f, delivery: v, config: "" }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="download">Download Only</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {scheduleForm.delivery === "email" && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Email Address</Label>
                <Input
                  type="email"
                  value={scheduleForm.config}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, config: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-zinc-200"
                  placeholder="admin@example.com"
                />
              </div>
            )}

            {scheduleForm.delivery === "webhook" && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Webhook URL</Label>
                <Input
                  type="url"
                  value={scheduleForm.config}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, config: e.target.value }))}
                  className="bg-zinc-800 border-zinc-700 text-zinc-200"
                  placeholder="https://hooks.example.com/..."
                />
              </div>
            )}

            {/* Output format */}
            {scheduleReport && scheduleReport.output_formats?.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300">Output Format</Label>
                <div className="flex gap-3">
                  {scheduleReport.output_formats.map((fmt) => (
                    <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scheduleFormat"
                        value={fmt}
                        checked={scheduleForm.format === fmt}
                        onChange={() => setScheduleForm((f) => ({ ...f, format: fmt }))}
                        className="accent-zinc-100"
                      />
                      <span className="text-zinc-300 text-sm">{fmt.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-zinc-700 text-zinc-300" onClick={() => setScheduleReport(null)}>
              Cancel
            </Button>
            <Button onClick={createSchedule} disabled={scheduling}>
              {scheduling ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Calendar className="h-4 w-4 mr-1" />}
              Create Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
