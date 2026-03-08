"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Activity, Search } from "lucide-react";

interface Event { event_id: string; ts: string; node_id: string; user_id: string; event_type: string; severity: string; payload: Record<string, unknown>; }

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ node_id: "", event_type: "", severity: "", since: "" });
  const { token } = useAuth();

  async function fetchEvents() {
    const params = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) params.set(k, v); });
    const data = await apiClient.get(`/events?${params}`, { showErrorToast: false });
    setEvents(data.events || []);
    setTotal(data.total || 0);
    setLoading(false);
  }
  useEffect(() => { if (token) fetchEvents(); }, [token, filter]);

  const sevColors: Record<string, string> = { critical: "text-red-400", high: "text-orange-400", medium: "text-yellow-400", low: "text-blue-400", info: "text-zinc-500" };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center gap-3 mb-6"><Activity className="h-8 w-8 text-blue-400" /><div><h1 className="text-2xl font-bold">Security Events</h1><p className="text-zinc-400 text-sm">{total.toLocaleString()} events</p></div></div>
        <div className="flex gap-3 mb-6 flex-wrap">
          <input placeholder="Node ID..." value={filter.node_id} onChange={e => setFilter({...filter, node_id: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm w-48" />
          <input placeholder="Event type..." value={filter.event_type} onChange={e => setFilter({...filter, event_type: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm w-48" />
          <select value={filter.severity} onChange={e => setFilter({...filter, severity: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm">
            <option value="">All Severities</option>{["critical","high","medium","low","info"].map(s => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div> :
        events.length === 0 ? <div className="text-center py-20"><Activity className="h-16 w-16 text-zinc-700 mx-auto mb-4" /><h3 className="text-lg font-semibold">No events</h3><p className="text-zinc-400 text-sm mt-2">Events will appear here once agents start reporting</p></div> :
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-800 text-zinc-400">
              <th className="text-left p-3">Time</th><th className="text-left p-3">Type</th><th className="text-left p-3">Node</th><th className="text-left p-3">User</th><th className="text-left p-3">Severity</th><th className="text-left p-3">Details</th>
            </tr></thead>
            <tbody>{events.map((e, i) => (
              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/50">
                <td className="p-3 text-xs text-zinc-400 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                <td className="p-3 font-mono text-xs">{e.event_type}</td>
                <td className="p-3 text-xs">{e.node_id}</td>
                <td className="p-3 text-xs">{e.user_id || "—"}</td>
                <td className={`p-3 text-xs font-bold ${sevColors[e.severity] || ""}`}>{e.severity}</td>
                <td className="p-3 text-xs text-zinc-500 max-w-xs truncate">{JSON.stringify(e.payload).substring(0, 80)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
