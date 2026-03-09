"use client";
import { apiClient } from "@/lib/api-client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/ui-components";
import { Shield, ShieldCheck, ShieldAlert, AlertTriangle, Plus, Play, ArrowRight, TrendingUp } from "lucide-react";

interface Baseline {
  id: string;
  name: string;
  description: string;
  baseline_type: string;
  version: number;
  enabled: boolean;
  rule_count: number;
  assignment_count: number;
  created_at: string;
}

interface DriftSummary {
  total_baselines: number;
  compliance_pct: number;
  total_open_drifts: number;
  drifts_by_severity: Record<string, number>;
  top_noncompliant_nodes: { node_id: string; drift_count: number }[];
  last_evaluation: string | null;
}

interface TrendPoint {
  date: string;
  total: number;
  compliant: number;
  pct: number;
}

export default function ComplianceDashboard() {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [summary, setSummary] = useState<DriftSummary | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [bRes, sRes, tRes] = await Promise.all([
        apiClient.get<Baseline[]>(`/baselines`, { showErrorToast: false }),
        apiClient.get<DriftSummary>(`/baselines/drift/summary`, { showErrorToast: false }),
        apiClient.get<TrendPoint[]>(`/baselines/compliance/trends`, { showErrorToast: false }),
      ]);
      if (bRes) setBaselines(bRes);
      if (sRes) setSummary(sRes);
      if (tRes) setTrends(tRes);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const evaluateBaseline = async (id: string) => {
    setEvaluating(id);
    try {
      await apiClient.post(`/baselines/${id}/evaluate`, {}, { showErrorToast: false });
      await fetchData();
    } finally {
      setEvaluating(null);
    }
  };

  const evaluateAll = async () => {
    setEvaluating("all");
    try {
      for (const b of baselines) {
        await apiClient.post(`/baselines/${b.id}/evaluate`, {}, { showErrorToast: false });
      }
      await fetchData();
    } finally {
      setEvaluating(null);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>;

  const severityColor: Record<string, string> = {
    critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-blue-500", info: "bg-gray-500",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-white">Compliance Dashboard</h1>
        <div className="flex gap-2">
          <button onClick={evaluateAll} disabled={!!evaluating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Play className="w-4 h-4" /> {evaluating === "all" ? "Evaluating..." : "Evaluate All"}
          </button>
          <Link href="/compliance/baselines/new"
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            <Plus className="w-4 h-4" /> Create Baseline
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500 dark:text-gray-400">Total Baselines</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold dark:text-white">{summary?.total_baselines ?? 0}</div></CardContent>
        </Card>
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500 dark:text-gray-400">Compliance</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold dark:text-white flex items-center gap-2">
              {summary?.compliance_pct ?? 0}%
              {(summary?.compliance_pct ?? 0) >= 80 ? <ShieldCheck className="w-6 h-6 text-green-500" /> : <ShieldAlert className="w-6 h-6 text-red-500" />}
            </div>
          </CardContent>
        </Card>
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500 dark:text-gray-400">Open Drifts</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold dark:text-white">{summary?.total_open_drifts ?? 0}</div>
            <div className="flex gap-1 mt-1">
              {summary?.drifts_by_severity && Object.entries(summary.drifts_by_severity).map(([sev, count]) => (
                <Badge key={sev} className={`${severityColor[sev] || "bg-gray-500"} text-white text-xs`}>{sev}: {count}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-gray-500 dark:text-gray-400">Last Evaluation</CardTitle></CardHeader>
          <CardContent>
            <div className="text-lg dark:text-white">
              {summary?.last_evaluation ? new Date(summary.last_evaluation).toLocaleString() : "Never"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="flex gap-2">
        <Link href="/compliance/drift" className="text-blue-500 hover:underline flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> View Drift Events <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Compliance Trends */}
      {trends.length > 0 && (
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader>
            <CardTitle className="dark:text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" /> Compliance Trend (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 flex items-end gap-1">
              {trends.map((t, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${t.date}: ${t.pct}% (${t.compliant}/${t.total})`}>
                  <div className="w-full rounded-t"
                    style={{
                      height: `${Math.max(4, t.pct * 1.2)}px`,
                      backgroundColor: t.pct >= 80 ? '#22c55e' : t.pct >= 50 ? '#eab308' : '#ef4444',
                    }}
                  />
                  {i % Math.max(1, Math.floor(trends.length / 7)) === 0 && (
                    <span className="text-[9px] text-gray-500 dark:text-gray-500">{t.date.slice(5)}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Baselines Table */}
      <Card className="dark:bg-zinc-900 dark:border-zinc-700">
        <CardHeader><CardTitle className="dark:text-white">Baselines</CardTitle></CardHeader>
        <CardContent>
          {baselines.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">No baselines yet. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="dark:border-zinc-700">
                  <TableHead className="dark:text-gray-400">Name</TableHead>
                  <TableHead className="dark:text-gray-400">Type</TableHead>
                  <TableHead className="dark:text-gray-400">Rules</TableHead>
                  <TableHead className="dark:text-gray-400">Assignments</TableHead>
                  <TableHead className="dark:text-gray-400">Version</TableHead>
                  <TableHead className="dark:text-gray-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baselines.map((b) => (
                  <TableRow key={b.id} className="dark:border-zinc-700">
                    <TableCell>
                      <Link href={`/compliance/baselines/${b.id}`} className="text-blue-500 hover:underline font-medium">{b.name}</Link>
                      {b.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{b.description}</p>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="dark:border-zinc-600 dark:text-gray-300">{b.baseline_type}</Badge></TableCell>
                    <TableCell className="dark:text-gray-300">{b.rule_count}</TableCell>
                    <TableCell className="dark:text-gray-300">{b.assignment_count}</TableCell>
                    <TableCell className="dark:text-gray-300">v{b.version}</TableCell>
                    <TableCell>
                      <button onClick={() => evaluateBaseline(b.id)} disabled={!!evaluating}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                        {evaluating === b.id ? "..." : "Evaluate"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
