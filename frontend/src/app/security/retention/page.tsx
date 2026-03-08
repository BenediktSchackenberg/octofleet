"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Database, Save, Lock } from "lucide-react";

interface RetentionRule { id: string; category: string; hot_days: number; warm_days: number; cold_days: number; legal_hold: boolean; }

export default function RetentionPage() {
  const [rules, setRules] = useState<RetentionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const { token } = useAuth();

  async function fetchRules() {
    const data = await apiClient.get(`/retention`, { showErrorToast: false });
    setRules(data.retention || []);
    setLoading(false);
  }
  useEffect(() => { if (token) fetchRules(); }, [token]);

  async function updateRule(category: string, field: string, value: number | boolean) {
    setSaving(category);
    await apiClient.put(`/retention/${category}`, { [field]: value }, { showErrorToast: false });
    await fetchRules();
    setSaving(null);
  }

  const categoryLabels: Record<string, string> = { file_events: "File Audit Events", security_events: "Security Events", findings: "Findings & Alerts", evidence_exports: "Evidence Exports", ui_audit_events: "UI Access Audit" };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center gap-3 mb-6"><Database className="h-8 w-8 text-blue-400" /><div><h1 className="text-2xl font-bold">Retention & Data Lifecycle</h1><p className="text-zinc-400 text-sm">Manage data retention, archiving, and legal hold settings</p></div></div>
        <div className="bg-zinc-900/50 border border-blue-500/20 rounded-xl p-4 mb-6 text-sm text-blue-300">
          <strong>Hot</strong> = fast queryable · <strong>Warm</strong> = compressed, slower queries · <strong>Cold</strong> = archived, export only · <strong>Legal Hold</strong> = prevents all deletion
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div> :
        <div className="space-y-4">
          {rules.map(r => (
            <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">{categoryLabels[r.category] || r.category}</h3>
                <button onClick={() => updateRule(r.category, "legal_hold", !r.legal_hold)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${r.legal_hold ? "bg-red-500/20 text-red-300 border border-red-500/30" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}>
                  <Lock className="h-3 w-3" /> {r.legal_hold ? "Legal Hold ON" : "Legal Hold Off"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[{ label: "Hot (days)", field: "hot_days", value: r.hot_days, color: "text-green-400" },
                  { label: "Warm (days)", field: "warm_days", value: r.warm_days, color: "text-yellow-400" },
                  { label: "Cold (days)", field: "cold_days", value: r.cold_days, color: "text-blue-400" }].map(({ label, field, value, color }) => (
                  <div key={field}>
                    <label className={`text-xs ${color}`}>{label}</label>
                    <input type="number" value={value} onChange={e => updateRule(r.category, field, parseInt(e.target.value))}
                      className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm" />
                  </div>
                ))}
              </div>
              {saving === r.category && <div className="text-xs text-blue-400 mt-2 flex items-center gap-1"><Save className="h-3 w-3" /> Saving...</div>}
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
