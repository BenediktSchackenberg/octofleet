"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────

interface BackupDatabase {
  name: string;
  lastFull: string | null;
  lastLog: string | null;
  rpoSeconds: number | null;
  status: "green" | "yellow" | "red";
  logCount24h: number;
}

interface BackupInstance {
  nodeId: string;
  hostname: string;
  instanceName: string;
  version: string;
  status: "green" | "yellow" | "red";
  databases: BackupDatabase[];
}

interface AmpelSummary {
  green: number;
  yellow: number;
  red: number;
  totalDatabases: number;
  backedUpDatabases: number;
  volumeGb24h: number;
}

interface AmpelReport {
  summary: AmpelSummary;
  instances: BackupInstance[];
}

interface HistogramBucket {
  label: string;
  count: number;
}

interface Distributions {
  rpoDistribution: HistogramBucket[];
  fullAgeDistribution: HistogramBucket[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

const STATUS_COLORS = {
  green: { bg: "bg-emerald-500", text: "text-emerald-400", hex: "#10b981", label: "Grün" },
  yellow: { bg: "bg-amber-500", text: "text-amber-400", hex: "#f59e0b", label: "Gelb" },
  red: { bg: "bg-red-500", text: "text-red-400", hex: "#ef4444", label: "Rot" },
};

function formatRpo(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  return formatRpo(diff);
}

function overallStatus(s: AmpelSummary): "green" | "yellow" | "red" {
  if (s.red > 0) return "red";
  if (s.yellow > 0) return "yellow";
  return "green";
}

// ─── Component ───────────────────────────────────────────────────────

export default function BackupAmpelPage() {
  const [report, setReport] = useState<AmpelReport | null>(null);
  const [distributions, setDistributions] = useState<Distributions | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const [r, d] = await Promise.all([
      apiClient.get<AmpelReport>("/api/v1/mssql/backup-ampel", { camelCase: true }),
      apiClient.get<Distributions>("/api/v1/mssql/backup-ampel/distributions", { camelCase: true }),
    ]);
    if (r) setReport(r);
    if (d) setDistributions(d);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const s = report?.summary;
  const total = s ? s.green + s.yellow + s.red : 0;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  const os = s ? overallStatus(s) : "green";

  const pieData = s
    ? [
        { name: "Grün", value: s.green, color: STATUS_COLORS.green.hex },
        { name: "Gelb", value: s.yellow, color: STATUS_COLORS.yellow.hex },
        { name: "Rot", value: s.red, color: STATUS_COLORS.red.hex },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-zinc-400" />
          <h1 className="text-2xl font-bold">Backup Ampel Report</h1>
          {s && (
            <Badge
              className={`${STATUS_COLORS[os].bg} text-white ml-2`}
            >
              {STATUS_COLORS[os].label}
            </Badge>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </button>
      </div>

      {/* Ampel Rules Legend */}
      <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500" />
          Grün: Full ≤24h &amp; Log ≤15min
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          Gelb: Full ≤48h &amp; Log ≤30min
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          Rot: Alles andere / keine Backups
        </span>
      </div>

      {/* Summary Cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {(["green", "yellow", "red"] as const).map((key) => (
            <Card key={key} className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4 pb-4 text-center">
                <div className={`text-3xl font-bold ${STATUS_COLORS[key].text}`}>{s[key]}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  {STATUS_COLORS[key].label} · {pct(s[key])}%
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-3xl font-bold text-zinc-200">
                {s.backedUpDatabases}/{s.totalDatabases}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Datenbanken gesichert</div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-3xl font-bold text-blue-400">{s.volumeGb24h}</div>
              <div className="text-xs text-zinc-500 mt-1">Volumen (24h) GB</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts Row */}
      {distributions && s && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Ampel-Verteilung Donut */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-400">Ampel-Verteilung</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#27272a", border: "none", borderRadius: 8 }}
                    itemStyle={{ color: "#e4e4e7" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* RPO Distribution */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-400">RPO-Verteilung</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={distributions.rpoDistribution}>
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#27272a", border: "none", borderRadius: 8 }}
                    itemStyle={{ color: "#e4e4e7" }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Full Backup Age */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-400">Alter Full-Backups</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={distributions.fullAgeDistribution}>
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#27272a", border: "none", borderRadius: 8 }}
                    itemStyle={{ color: "#e4e4e7" }}
                  />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Instance Table */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-sm text-zinc-400">Instanz-Übersicht</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800">
                <TableHead className="text-zinc-400">STATUS</TableHead>
                <TableHead className="text-zinc-400">INSTANZ</TableHead>
                <TableHead className="text-zinc-400">VERSION</TableHead>
                <TableHead className="text-zinc-400">DBS</TableHead>
                <TableHead className="text-zinc-400">LETZTE FULL</TableHead>
                <TableHead className="text-zinc-400">LETZTE LOG</TableHead>
                <TableHead className="text-zinc-400">RPO</TableHead>
                <TableHead className="text-zinc-400">LOG (24h)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!report || report.instances.length === 0 ? (
                <TableRow className="border-zinc-800">
                  <TableCell colSpan={8} className="text-center text-zinc-500 py-8">
                    Keine Daten verfügbar
                  </TableCell>
                </TableRow>
              ) : (
                report.instances.map((inst) => {
                  // Find best/worst values across databases
                  const lastFull = inst.databases
                    .map((d) => d.lastFull)
                    .filter(Boolean)
                    .sort()
                    .reverse()[0] || null;
                  const lastLog = inst.databases
                    .map((d) => d.lastLog)
                    .filter(Boolean)
                    .sort()
                    .reverse()[0] || null;
                  const worstRpo = inst.databases.reduce(
                    (max, d) => (d.rpoSeconds !== null && (max === null || d.rpoSeconds > max) ? d.rpoSeconds : max),
                    null as number | null
                  );
                  const totalLogs = inst.databases.reduce((s, d) => s + d.logCount24h, 0);

                  return (
                    <TableRow key={`${inst.nodeId}-${inst.instanceName}`} className="border-zinc-800">
                      <TableCell>
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${STATUS_COLORS[inst.status].bg}`}
                        />
                      </TableCell>
                      <TableCell className="text-zinc-200 font-medium">
                        {inst.hostname}\{inst.instanceName}
                      </TableCell>
                      <TableCell className="text-zinc-400">{inst.version || "—"}</TableCell>
                      <TableCell className="text-zinc-300">{inst.databases.length}</TableCell>
                      <TableCell className="text-zinc-300">{formatAge(lastFull)}</TableCell>
                      <TableCell className="text-zinc-300">{formatAge(lastLog)}</TableCell>
                      <TableCell className="text-zinc-300">{formatRpo(worstRpo)}</TableCell>
                      <TableCell className="text-zinc-300">{totalLogs}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
