"use client";
import { useState, useEffect } from "react";
import { API_BASE } from "@/lib/api-config";
import { useAuth } from "@/lib/auth-context";
import { Breadcrumb } from "@/components/ui-components";
import { Download, Plus, Package } from "lucide-react";

interface Export { id: string; scope: string; filter_criteria: Record<string, unknown>; manifest_hash: string; created_by: string; created_at: string; }

export default function EvidencePage() {
  const [exports, setExports] = useState<Export[]>([]);
  const [loading, setLoading] = useState(true);
  const { token, user } = useAuth();

  async function fetchExports() {
    const res = await fetch(`${API_BASE}/evidence/exports`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setExports(data.exports || []);
    setLoading(false);
  }
  useEffect(() => { if (token) fetchExports(); }, [token]);

  async function createExport() {
    await fetch(`${API_BASE}/evidence/export`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "manual", created_by: user?.username || "admin", filter: { type: "full_export", timestamp: new Date().toISOString() } }) });
    fetchExports();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
        <Breadcrumb items={[{ label: "Security & Compliance", href: "/security" }, { label: "Evidence & Exports" }]} />
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3"><Download className="h-8 w-8 text-cyan-400" /><div><h1 className="text-2xl font-bold">Evidence & Exports</h1><p className="text-zinc-400 text-sm">Create audit-ready evidence packs for compliance</p></div></div>
          <button onClick={createExport} className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-sm font-medium"><Plus className="h-4 w-4" /> New Export</button>
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div></div> :
        exports.length === 0 ? <div className="text-center py-20"><Package className="h-16 w-16 text-zinc-700 mx-auto mb-4" /><h3 className="text-lg font-semibold">No exports yet</h3><p className="text-zinc-400 text-sm mt-2">Create an evidence pack for audit or compliance needs</p></div> :
        <div className="space-y-3">{exports.map(e => (
          <div key={e.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
            <Package className="h-8 w-8 text-cyan-400" />
            <div className="flex-1"><div className="font-semibold">{e.scope}</div><div className="text-zinc-400 text-xs">by {e.created_by} · {new Date(e.created_at).toLocaleString()}</div></div>
            {e.manifest_hash && <span className="text-xs font-mono text-zinc-500">{e.manifest_hash.substring(0, 16)}...</span>}
          </div>
        ))}</div>}
      </div>
    </div>
  );
}
