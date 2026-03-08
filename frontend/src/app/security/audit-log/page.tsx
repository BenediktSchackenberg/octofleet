"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Users } from "lucide-react";

interface AuditEvent { id: string; ts: string; actor_user_id: string; action: string; object_type: string; object_id: string; details: Record<string, unknown>; }

export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const { token } = useAuth();

  useEffect(() => {
    if (!token) return;
    apiClient.get(`/audit/ui-events`, { showErrorToast: false })
      .then(d => setEvents(d.events || [])).catch(console.error).finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center gap-3 mb-6"><Users className="h-8 w-8 text-pink-400" /><div><h1 className="text-2xl font-bold">Access Audit</h1><p className="text-zinc-400 text-sm">Audit the auditor — who viewed or exported what data</p></div></div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-500"></div></div> :
        events.length === 0 ? <div className="text-center py-20"><Users className="h-16 w-16 text-zinc-700 mx-auto mb-4" /><h3 className="text-lg font-semibold">No audit events</h3><p className="text-zinc-400 text-sm mt-2">Actions like evidence exports and data access will be logged here</p></div> :
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-800 text-zinc-400">
              <th className="text-left p-3">Time</th><th className="text-left p-3">Actor</th><th className="text-left p-3">Action</th><th className="text-left p-3">Object</th><th className="text-left p-3">Details</th>
            </tr></thead>
            <tbody>{events.map((e, i) => (
              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/50">
                <td className="p-3 text-xs text-zinc-400 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                <td className="p-3 text-xs font-medium">{e.actor_user_id}</td>
                <td className="p-3 text-xs font-mono">{e.action}</td>
                <td className="p-3 text-xs">{e.object_type} / {e.object_id?.substring(0, 8)}</td>
                <td className="p-3 text-xs text-zinc-500 max-w-xs truncate">{JSON.stringify(e.details).substring(0, 80)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
