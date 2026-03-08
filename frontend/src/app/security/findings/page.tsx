"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AlertTriangle, CheckCircle, XCircle, Eye } from "lucide-react";

interface Finding { id: string; type: string; title: string; description: string; severity: string; score: number; status: string; first_seen: string; last_seen: string; node_id: string; user_id: string; }

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ severity: "", status: "" });
  const { token } = useAuth();

  async function fetchFindings() {
    const params = new URLSearchParams();
    if (filter.severity) params.set("severity", filter.severity);
    if (filter.status) params.set("status", filter.status);
    const data = await apiClient.get(`/findings?${params}`, { showErrorToast: false });
    setFindings(data.findings || []);
    setTotal(data.total || 0);
    setLoading(false);
  }

  useEffect(() => { if (token) fetchFindings(); }, [token, filter]);

  async function updateStatus(id: string, status: string) {
    await apiClient.put(`/findings/${id}`, { status }, { showErrorToast: false });
    fetchFindings();
  }

  const sevColors: Record<string, string> = { critical: "text-red-400 bg-red-500/20", high: "text-orange-400 bg-orange-500/20", medium: "text-yellow-400 bg-yellow-500/20", low: "text-blue-400 bg-blue-500/20", info: "text-zinc-400 bg-zinc-500/20" };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center gap-3 mb-6">
          <AlertTriangle className="h-8 w-8 text-orange-400" />
          <div><h1 className="text-2xl font-bold">Findings & Alerts</h1><p className="text-zinc-400 text-sm">{total} findings — triage and manage security issues</p></div>
        </div>
        <div className="flex gap-3 mb-6">
          <select value={filter.severity} onChange={e => setFilter({...filter, severity: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm">
            <option value="">All Severities</option>
            {["critical","high","medium","low","info"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filter.status} onChange={e => setFilter({...filter, status: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm">
            <option value="">All Statuses</option>
            {["open","acknowledged","resolved","false_positive"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div></div> :
        findings.length === 0 ? <div className="text-center py-20"><AlertTriangle className="h-16 w-16 text-zinc-700 mx-auto mb-4" /><h3 className="text-lg font-semibold mb-2">No findings</h3><p className="text-zinc-400 text-sm">Your fleet is looking clean — no security issues detected.</p></div> :
        <div className="space-y-3">
          {findings.map(f => (
            <div key={f.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
              <div className={`px-2 py-1 rounded text-xs font-bold ${sevColors[f.severity] || sevColors.info}`}>{f.severity.toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{f.title}</div>
                <div className="text-zinc-400 text-xs">{f.type} · {f.node_id || "Fleet-wide"} · Score: {f.score ?? "—"}</div>
              </div>
              <div className="text-xs text-zinc-500">{new Date(f.last_seen).toLocaleString()}</div>
              <div className="flex gap-1">
                {f.status === "open" && <button onClick={() => updateStatus(f.id, "acknowledged")} title="Acknowledge" className="p-1.5 text-zinc-500 hover:text-yellow-400"><Eye className="h-4 w-4" /></button>}
                {f.status !== "resolved" && <button onClick={() => updateStatus(f.id, "resolved")} title="Resolve" className="p-1.5 text-zinc-500 hover:text-green-400"><CheckCircle className="h-4 w-4" /></button>}
                {f.status !== "false_positive" && <button onClick={() => updateStatus(f.id, "false_positive")} title="False Positive" className="p-1.5 text-zinc-500 hover:text-red-400"><XCircle className="h-4 w-4" /></button>}
              </div>
              <span className={`px-2 py-1 rounded text-xs ${f.status === "open" ? "bg-red-500/20 text-red-300" : f.status === "resolved" ? "bg-green-500/20 text-green-300" : "bg-zinc-700 text-zinc-300"}`}>{f.status}</span>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
