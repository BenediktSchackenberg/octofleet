"use client";

import { useState, useEffect } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { API_BASE } from "@/lib/api-config";
import Link from "next/link";

export default function ActivityPage() {
  const [tab, setTab] = useState<"files" | "users">("files");
  const [fileData, setFileData] = useState<any>(null);
  const [userData, setUserData] = useState<any>(null);
  const [hours, setHours] = useState(24);
  const [nodeFilter, setNodeFilter] = useState("");
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/nodes`, { headers: getAuthHeader() })
      .then(r => r.json()).then(d => setNodes(Array.isArray(d) ? d : d.nodes || [])).catch(() => {});
  }, []);

  const loadData = async () => {
    setLoading(true);
    const params = new URLSearchParams({ hours: String(hours) });
    if (nodeFilter) params.set("node_id", nodeFilter);
    
    const [fRes, uRes] = await Promise.all([
      fetch(`${API_BASE}/security/activity/files?${params}`, { headers: getAuthHeader() }),
      fetch(`${API_BASE}/security/activity/users?${params}`, { headers: getAuthHeader() })
    ]);
    setFileData(await fRes.json());
    setUserData(await uRes.json());
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [hours, nodeFilter]);

  const exportCsv = () => {
    const params = new URLSearchParams({ hours: String(hours), format: "csv" });
    if (nodeFilter) params.set("node_id", nodeFilter);
    window.open(`${API_BASE}/security/activity/export?${params}`, "_blank");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/security" className="hover:text-white">Security Center</Link><span>/</span><span className="text-white">Activity</span>
      </div>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Activity Dashboards</h1>
        <button onClick={exportCsv} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm">Export CSV</button>
      </div>

      <div className="flex gap-4 items-center">
        <select className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm" value={nodeFilter} onChange={e => setNodeFilter(e.target.value)}>
          <option value="">All nodes</option>
          {nodes.map(n => <option key={n.id || n.node_id} value={n.node_id || n.name}>{n.node_id || n.name}</option>)}
        </select>
        <select className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm" value={hours} onChange={e => setHours(Number(e.target.value))}>
          <option value={1}>Last hour</option><option value={6}>6 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option>
        </select>
        {loading && <span className="text-gray-400 animate-pulse text-sm">Loading...</span>}
      </div>

      <div className="flex gap-1 border-b border-gray-700">
        {(["files", "users"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"}`}>
            {t === "files" ? "File Activity" : "User Activity"}
          </button>
        ))}
      </div>

      {tab === "files" && fileData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Operations Distribution</h3>
              {(fileData.operationsDistribution || []).map((o: any) => (
                <div key={o.operation} className="flex justify-between text-sm py-1 border-b border-gray-700">
                  <span className="text-gray-300">{o.operation}</span>
                  <span className="text-white font-mono">{o.count}</span>
                </div>
              ))}
            </div>
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-400 mb-2">Top Users</h3>
              {(fileData.topUsers || []).map((u: any) => (
                <div key={u.username} className="flex justify-between text-sm py-1 border-b border-gray-700">
                  <span className="text-gray-300">{u.username}</span>
                  <span className="text-white font-mono">{u.count}</span>
                </div>
              ))}
              {(!fileData.topUsers || fileData.topUsers.length === 0) && <p className="text-gray-500 text-sm">No user data yet</p>}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Top Paths</h3>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {(fileData.topPaths || []).map((p: any, i: number) => (
                <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-700">
                  <span className="text-gray-300 font-mono text-xs truncate max-w-[70%]">{p.path}</span>
                  <span className="text-white font-mono">{p.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Recent Events</h3>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-400"><tr><th className="text-left pb-1">Time</th><th className="text-left pb-1">Node</th><th className="text-left pb-1">Type</th><th className="text-left pb-1">Path</th><th className="text-left pb-1">User</th></tr></thead>
                <tbody className="text-gray-300">
                  {(fileData.recentEvents || []).map((e: any) => (
                    <tr key={e.id} className="border-t border-gray-700">
                      <td className="py-1">{new Date(e.ts).toLocaleTimeString()}</td>
                      <td>{e.nodeId}</td>
                      <td>{e.eventType}</td>
                      <td className="font-mono truncate max-w-[200px]">{e.payload?.file?.path || e.payload?.path || ""}</td>
                      <td>{e.payload?.user?.name || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "users" && userData && (
        <div className="space-y-4">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">User Summary</h3>
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-left"><tr><th className="pb-2">User</th><th className="pb-2">Events</th><th className="pb-2">Unique Ops</th><th className="pb-2">Unique Files</th><th className="pb-2">Last Active</th></tr></thead>
              <tbody className="text-gray-300">
                {(userData.users || []).map((u: any) => (
                  <tr key={u.username} className="border-t border-gray-700">
                    <td className="py-1.5 font-medium">{u.username}</td>
                    <td className="font-mono">{u.totalEvents}</td>
                    <td className="font-mono">{u.uniqueOps}</td>
                    <td className="font-mono">{u.uniqueFiles}</td>
                    <td className="text-xs">{new Date(u.lastActivity).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!userData.users || userData.users.length === 0) && <p className="text-gray-500 text-sm py-4 text-center">No user activity data yet</p>}
          </div>

          {userData.afterHoursActivity?.length > 0 && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-red-400 mb-2">⚠️ After-Hours Activity</h3>
              {userData.afterHoursActivity.map((u: any) => (
                <div key={u.username} className="flex justify-between text-sm py-1">
                  <span className="text-gray-300">{u.username}</span>
                  <span className="text-red-300 font-mono">{u.count} events</span>
                </div>
              ))}
            </div>
          )}

          {userData.sensitiveAccess?.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-yellow-400 mb-2">🔒 Sensitive Path Access</h3>
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-left"><tr><th className="pb-1">User</th><th className="pb-1">Path</th><th className="pb-1">Count</th></tr></thead>
                <tbody className="text-gray-300">
                  {userData.sensitiveAccess.map((s: any, i: number) => (
                    <tr key={i} className="border-t border-gray-700">
                      <td className="py-1">{s.username}</td>
                      <td className="font-mono text-xs">{s.path}</td>
                      <td className="font-mono">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
