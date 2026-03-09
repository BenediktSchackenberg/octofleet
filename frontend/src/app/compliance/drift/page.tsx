"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/ui-components";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";

interface DriftEvent {
  id: string; node_id: string; expected: any; actual: any; severity: string;
  status: string; detected_at: string; rule_name?: string; baseline_name?: string; waive_reason?: string;
}

export default function DriftEvents() {
  const [events, setEvents] = useState<DriftEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: "", severity: "" });
  const [waiveModal, setWaiveModal] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [remediating, setRemediating] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.set("status", filter.status);
      if (filter.severity) params.set("severity", filter.severity);
      const res = await apiClient.get<DriftEvent[]>(`/baselines/drift?${params}`, { showErrorToast: false });
      if (res) setEvents(res);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [filter]);

  const acknowledge = async (id: string) => {
    await apiClient.post(`/baselines/drift/${id}/acknowledge`, {}, { showErrorToast: false });
    await fetchData();
  };

  const remediate = async (id: string) => {
    setRemediating(id);
    try {
      const res = await apiClient.post(`/baselines/drift/${id}/remediate`, {}, { showErrorToast: false });
      if (!res) {
        alert("Remediation failed");
      }
      await fetchData();
    } finally { setRemediating(null); }
  };

  const waive = async () => {
    if (!waiveModal) return;
    await apiClient.post(`/baselines/drift/${waiveModal}/waive`, { reason: waiveReason }, { showErrorToast: false });
    setWaiveModal(null);
    setWaiveReason("");
    await fetchData();
  };

  const severityColor: Record<string, string> = {
    critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-blue-500", info: "bg-gray-500",
  };
  const statusColor: Record<string, string> = {
    open: "bg-red-500", acknowledged: "bg-yellow-500", resolved: "bg-green-500", waived: "bg-gray-500", remediating: "bg-purple-500",
  };

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/compliance" className="text-blue-500 hover:underline text-sm">← Back to Compliance</Link>
          <h1 className="text-2xl font-bold dark:text-white mt-1">Drift Events</h1>
        </div>
        <div className="flex gap-2">
          <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            className="px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm">
            <option value="">All Status</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="waived">Waived</option>
            <option value="remediating">Remediating</option>
          </select>
          <select value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })}
            className="px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm">
            <option value="">All Severity</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <Card className="dark:bg-zinc-900 dark:border-zinc-700">
        <CardContent className="pt-6">
          {events.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">No drift events found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="dark:border-zinc-700">
                  <TableHead className="dark:text-gray-400">Baseline</TableHead>
                  <TableHead className="dark:text-gray-400">Rule</TableHead>
                  <TableHead className="dark:text-gray-400">Node</TableHead>
                  <TableHead className="dark:text-gray-400">Severity</TableHead>
                  <TableHead className="dark:text-gray-400">Status</TableHead>
                  <TableHead className="dark:text-gray-400">Detected</TableHead>
                  <TableHead className="dark:text-gray-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id} className="dark:border-zinc-700">
                    <TableCell className="dark:text-white">{ev.baseline_name || "—"}</TableCell>
                    <TableCell className="dark:text-gray-300">{ev.rule_name || "—"}</TableCell>
                    <TableCell className="dark:text-gray-300 font-mono text-xs">{ev.node_id?.toString().slice(0, 8)}...</TableCell>
                    <TableCell>
                      <Badge className={`${severityColor[ev.severity] || "bg-gray-500"} text-white text-xs`}>{ev.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${statusColor[ev.status] || "bg-gray-500"} text-white text-xs`}>{ev.status}</Badge>
                    </TableCell>
                    <TableCell className="dark:text-gray-300 text-sm">{new Date(ev.detected_at).toLocaleString()}</TableCell>
                    <TableCell>
                      {(ev.status === "open" || ev.status === "acknowledged") && (
                        <div className="flex gap-1">
                          <button onClick={() => remediate(ev.id)} disabled={remediating === ev.id}
                            className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                            {remediating === ev.id ? "..." : "Remediate"}
                          </button>
                          {ev.status === "open" && (
                            <button onClick={() => acknowledge(ev.id)}
                              className="text-xs px-2 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700">Ack</button>
                          )}
                          <button onClick={() => setWaiveModal(ev.id)}
                            className="text-xs px-2 py-1 bg-gray-600 text-white rounded hover:bg-gray-700">Waive</button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {waiveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 w-96 space-y-4 dark:border dark:border-zinc-700">
            <h2 className="text-lg font-bold dark:text-white">Waive Drift Event</h2>
            <textarea value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} rows={3} placeholder="Reason for waiving..."
              className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-600 dark:text-white" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setWaiveModal(null)} className="px-4 py-2 border rounded-lg dark:border-zinc-600 dark:text-white">Cancel</button>
              <button onClick={waive} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Waive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
