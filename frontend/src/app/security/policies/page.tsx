"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Settings, Plus, Edit, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

interface Policy { id: string; name: string; description: string; version: number; definition: Record<string, unknown>; enabled: boolean; severity: string; created_at: string; }

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", severity: "medium", definition: "{}", enabled: true });
  const { token } = useAuth();

  async function fetchPolicies() {
    const data = await apiClient.get<{ policies: Policy[] }>(`/security/policies`, { showErrorToast: false });
    setPolicies(data?.policies || []);
    setLoading(false);
  }
  useEffect(() => { if (token) fetchPolicies(); }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let def = {};
    try { def = JSON.parse(form.definition); } catch { alert("Invalid JSON in definition"); return; }
    await apiClient.post(`/security/policies`, { name: form.name, description: form.description, severity: form.severity, definition: def, enabled: form.enabled }, { showErrorToast: false });
    setShowCreate(false); setForm({ name: "", description: "", severity: "medium", definition: "{}", enabled: true }); fetchPolicies();
  }

  async function togglePolicy(id: string, enabled: boolean) {
    await apiClient.put(`/security/policies/${id}`, { enabled }, { showErrorToast: false });
    fetchPolicies();
  }

  async function deletePolicy(id: string) {
    if (!confirm("Delete this policy?")) return;
    await apiClient.delete(`/security/policies/${id}`, { showErrorToast: false });
    fetchPolicies();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3"><Settings className="h-8 w-8 text-yellow-400" /><div><h1 className="text-2xl font-bold">Security Policies</h1><p className="text-zinc-400 text-sm">Define behavior rules, thresholds, and detection patterns</p></div></div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-sm font-medium transition-colors"><Plus className="h-4 w-4" /> New Policy</button>
        </div>
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg">
              <h2 className="text-lg font-bold mb-4">New Security Policy</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div><label className="text-sm text-zinc-400">Name</label><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm" /></div>
                <div><label className="text-sm text-zinc-400">Description</label><textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm" rows={2} /></div>
                <div><label className="text-sm text-zinc-400">Severity</label><select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})} className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm">
                  {["critical","high","medium","low","info"].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className="text-sm text-zinc-400">Rule Definition (JSON)</label><textarea value={form.definition} onChange={e => setForm({...form, definition: e.target.value})} className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono" rows={5} /></div>
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-sm font-medium">Create</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div></div> :
        policies.length === 0 ? <div className="text-center py-20"><Settings className="h-16 w-16 text-zinc-700 mx-auto mb-4" /><h3 className="text-lg font-semibold mb-2">No policies yet</h3><p className="text-zinc-400 text-sm">Create detection rules to identify suspicious behavior</p></div> :
        <div className="space-y-3">
          {policies.map(p => (
            <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
              <button onClick={() => togglePolicy(p.id, !p.enabled)} className="text-2xl">{p.enabled ? <ToggleRight className="h-6 w-6 text-green-400" /> : <ToggleLeft className="h-6 w-6 text-zinc-600" />}</button>
              <div className="flex-1"><div className="font-semibold">{p.name} <span className="text-xs text-zinc-500">v{p.version}</span></div><div className="text-zinc-400 text-xs">{p.description}</div></div>
              <span className={`px-2 py-1 rounded text-xs ${p.severity === "critical" ? "bg-red-500/20 text-red-300" : p.severity === "high" ? "bg-orange-500/20 text-orange-300" : "bg-yellow-500/20 text-yellow-300"}`}>{p.severity}</span>
              <button onClick={() => deletePolicy(p.id)} className="p-1.5 text-zinc-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
