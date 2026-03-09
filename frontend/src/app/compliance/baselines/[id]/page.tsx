"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/ui-components";
import { Play, Trash2, ShieldCheck, ShieldAlert, Zap } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface BaselineDetail {
  id: string; name: string; description: string; baseline_type: string; version: number;
  rules: any[]; assignments: any[]; created_at: string; updated_at: string;
}

interface Evaluation {
  id: string; node_id: string; evaluated_at: string; compliant: boolean;
  total_rules: number; passed: number; failed: number; skipped: number; details: any[];
}

export default function BaselineDetail() {
  const params = useParams();
  const id = params.id as string;
  const [baseline, setBaseline] = useState<BaselineDetail | null>(null);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [remediating, setRemediating] = useState(false);

  const fetchData = async () => {
    try {
      const [bRes, eRes] = await Promise.all([
        apiClient.get<BaselineDetail>(`/baselines/${id}`, { showErrorToast: false }),
        apiClient.get<Evaluation[]>(`/baselines/${id}/evaluations`, { showErrorToast: false }),
      ]);
      if (bRes) setBaseline(bRes);
      if (eRes) setEvaluations(eRes);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  const evaluate = async () => {
    setEvaluating(true);
    try {
      await apiClient.post(`/baselines/${id}/evaluate`, {}, { showErrorToast: false });
      await fetchData();
    } finally { setEvaluating(false); }
  };

  const deleteRule = async (ruleId: string) => {
    await apiClient.delete(`/baselines/rules/${ruleId}`, { showErrorToast: false });
    await fetchData();
  };

  const remediateAll = async () => {
    setRemediating(true);
    try {
      await apiClient.post(`/baselines/${id}/remediate-all`, {}, { showErrorToast: false });
      await fetchData();
    } finally { setRemediating(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>;
  if (!baseline) return <div className="p-6 dark:text-white">Baseline not found</div>;

  const latestEvals = evaluations.slice(0, 20);
  const compliancePct = latestEvals.length > 0
    ? Math.round(latestEvals.filter((e) => e.compliant).length / latestEvals.length * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/compliance" className="text-blue-500 hover:underline text-sm">← Back to Compliance</Link>
          <h1 className="text-2xl font-bold dark:text-white mt-1">{baseline.name}</h1>
          <p className="text-gray-500 dark:text-gray-400">{baseline.description}</p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant="outline" className="dark:border-zinc-600 dark:text-gray-300">{baseline.baseline_type}</Badge>
          <Badge variant="outline" className="dark:border-zinc-600 dark:text-gray-300">v{baseline.version}</Badge>
          <button onClick={evaluate} disabled={evaluating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            <Play className="w-4 h-4" /> {evaluating ? "Evaluating..." : "Evaluate Now"}
          </button>
          <button onClick={remediateAll} disabled={remediating}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
            <Zap className="w-4 h-4" /> {remediating ? "Remediating..." : "Remediate All Drifts"}
          </button>
        </div>
      </div>

      {/* Compliance Gauge */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm dark:text-gray-400">Compliance</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="text-4xl font-bold dark:text-white">{compliancePct}%</div>
              {compliancePct >= 80 ? <ShieldCheck className="w-8 h-8 text-green-500" /> : <ShieldAlert className="w-8 h-8 text-red-500" />}
            </div>
          </CardContent>
        </Card>
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm dark:text-gray-400">Rules</CardTitle></CardHeader>
          <CardContent><div className="text-4xl font-bold dark:text-white">{baseline.rules.length}</div></CardContent>
        </Card>
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader className="pb-2"><CardTitle className="text-sm dark:text-gray-400">Assignments</CardTitle></CardHeader>
          <CardContent><div className="text-4xl font-bold dark:text-white">{baseline.assignments.length}</div></CardContent>
        </Card>
      </div>

      {/* Rules */}
      <Card className="dark:bg-zinc-900 dark:border-zinc-700">
        <CardHeader><CardTitle className="dark:text-white">Rules</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="dark:border-zinc-700">
                <TableHead className="dark:text-gray-400">Name</TableHead>
                <TableHead className="dark:text-gray-400">Type</TableHead>
                <TableHead className="dark:text-gray-400">Expected</TableHead>
                <TableHead className="dark:text-gray-400">Severity</TableHead>
                <TableHead className="dark:text-gray-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {baseline.rules.map((r: any) => (
                <TableRow key={r.id} className="dark:border-zinc-700">
                  <TableCell className="dark:text-white font-medium">{r.rule_name}</TableCell>
                  <TableCell><Badge variant="outline" className="dark:border-zinc-600 dark:text-gray-300">{r.rule_type}</Badge></TableCell>
                  <TableCell className="dark:text-gray-300 text-xs font-mono">{JSON.stringify(r.expected_value)}</TableCell>
                  <TableCell>
                    <Badge className={`text-white text-xs ${r.severity === "critical" ? "bg-red-500" : r.severity === "high" ? "bg-orange-500" : r.severity === "medium" ? "bg-yellow-500" : "bg-blue-500"}`}>
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <button onClick={() => deleteRule(r.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Evaluation History */}
      <Card className="dark:bg-zinc-900 dark:border-zinc-700">
        <CardHeader><CardTitle className="dark:text-white">Evaluation History</CardTitle></CardHeader>
        <CardContent>
          {evaluations.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-4">No evaluations yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="dark:border-zinc-700">
                  <TableHead className="dark:text-gray-400">Node</TableHead>
                  <TableHead className="dark:text-gray-400">Date</TableHead>
                  <TableHead className="dark:text-gray-400">Status</TableHead>
                  <TableHead className="dark:text-gray-400">Passed</TableHead>
                  <TableHead className="dark:text-gray-400">Failed</TableHead>
                  <TableHead className="dark:text-gray-400">Skipped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evaluations.map((ev) => (
                  <TableRow key={ev.id} className="dark:border-zinc-700">
                    <TableCell className="dark:text-gray-300 font-mono text-xs">{ev.node_id?.toString().slice(0, 8)}...</TableCell>
                    <TableCell className="dark:text-gray-300">{new Date(ev.evaluated_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {ev.compliant
                        ? <Badge className="bg-green-500 text-white">Compliant</Badge>
                        : <Badge className="bg-red-500 text-white">Non-Compliant</Badge>}
                    </TableCell>
                    <TableCell className="text-green-500">{ev.passed}</TableCell>
                    <TableCell className="text-red-500">{ev.failed}</TableCell>
                    <TableCell className="text-gray-500">{ev.skipped}</TableCell>
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
