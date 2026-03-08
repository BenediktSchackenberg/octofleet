import { apiClient } from "@/lib/api-client";
"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { FileSearch, Search } from "lucide-react";

interface FileEvent { event_id: string; ts: string; node_id: string; user_id: string; op: string; path: string; old_path: string; process_name: string; file_size: number; success: boolean; }

export default function FileAuditPage() {
  const [events, setEvents] = useState<FileEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ node_id: "", user_id: "", path: "", op: "" });
  const { token } = useAuth();

  async function fetchEvents() {
    const params = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) params.set(k, v); });
    const res = await apiClient.get(`/events/files?${params}`, { showErrorToast: false });
    const data = await res.json();
    setEvents(data.events || []);
    setTotal(data.total || 0);
    setLoading(false);
  }
  useEffect(() => { if (token) fetchEvents(); }, [token, filter]);

  const opColors: Record<string, string> = { "file.create": "text-green-400", "file.write": "text-blue-400", "file.delete": "text-red-400", "file.rename": "text-yellow-400", "file.read": "text-zinc-400" };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center gap-3 mb-6"><FileSearch className="h-8 w-8 text-green-400" /><div><h1 className="text-2xl font-bold">File & Document Audit</h1><p className="text-zinc-400 text-sm">{total.toLocaleString()} file events — who changed what, when</p></div></div>
        <div className="flex gap-3 mb-6 flex-wrap">
          <input placeholder="Search path..." value={filter.path} onChange={e => setFilter({...filter, path: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm w-64" />
          <input placeholder="Node ID..." value={filter.node_id} onChange={e => setFilter({...filter, node_id: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm w-48" />
          <input placeholder="User..." value={filter.user_id} onChange={e => setFilter({...filter, user_id: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm w-48" />
          <select value={filter.op} onChange={e => setFilter({...filter, op: e.target.value})} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm">
            <option value="">All Operations</option>{["file.create","file.write","file.read","file.delete","file.rename","file.move","file.permission_change"].map(s => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div></div> :
        events.length === 0 ? <div className="text-center py-20"><FileSearch className="h-16 w-16 text-zinc-700 mx-auto mb-4" /><h3 className="text-lg font-semibold">No file events</h3><p className="text-zinc-400 text-sm mt-2">Enable file audit sensor in a monitoring profile to start tracking</p></div> :
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-800 text-zinc-400">
              <th className="text-left p-3">Time</th><th className="text-left p-3">Operation</th><th className="text-left p-3">Path</th><th className="text-left p-3">Node</th><th className="text-left p-3">User</th><th className="text-left p-3">Process</th><th className="text-left p-3">Size</th>
            </tr></thead>
            <tbody>{events.map((e, i) => (
              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/50">
                <td className="p-3 text-xs text-zinc-400 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                <td className={`p-3 font-mono text-xs font-bold ${opColors[e.op] || "text-zinc-400"}`}>{e.op}</td>
                <td className="p-3 text-xs font-mono max-w-sm truncate">{e.path}</td>
                <td className="p-3 text-xs">{e.node_id}</td>
                <td className="p-3 text-xs">{e.user_id || "—"}</td>
                <td className="p-3 text-xs text-zinc-500">{e.process_name || "—"}</td>
                <td className="p-3 text-xs text-zinc-500">{e.file_size ? `${(e.file_size/1024).toFixed(1)} KB` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
