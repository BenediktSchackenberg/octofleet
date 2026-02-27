"use client";

import { useState, useEffect } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { API_URL } from "@/lib/api-config";
import Link from "next/link";

export default function RulesPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", ruleType: "threshold", severity: "medium", enabled: true, cooldownSeconds: 300, conditions: "{}", actions: "[]" });
  const [evalResult, setEvalResult] = useState<any>(null);

  const load = () => fetch(`${API_URL}/api/v1/security/rules`, { headers: getAuthHeader() })
    .then(r => r.json()).then(d => setRules(d.rules || [])).catch(() => {});

  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      const body = { ...form, conditions: JSON.parse(form.conditions), actions: JSON.parse(form.actions) };
      await fetch(`${API_URL}/api/v1/security/rules`, { method: "POST", headers: { ...getAuthHeader(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setShowForm(false);
      setForm({ name: "", description: "", ruleType: "threshold", severity: "medium", enabled: true, cooldownSeconds: 300, conditions: "{}", actions: "[]" });
      load();
    } catch (e) { alert("Invalid JSON in conditions or actions"); }
  };

  const deleteRule = async (id: string) => {
    await fetch(`${API_URL}/api/v1/security/rules/${id}`, { method: "DELETE", headers: getAuthHeader() });
    load();
  };

  const evaluate = async () => {
    const res = await fetch(`${API_URL}/api/v1/security/rules/evaluate`, { method: "POST", headers: { ...getAuthHeader(), "Content-Type": "application/json" }, body: "{}" });
    setEvalResult(await res.json());
  };

  const sevColor = (s: string) => ({ critical: "bg-red-600", high: "bg-red-500", medium: "bg-yellow-600", low: "bg-blue-600" }[s] || "bg-gray-600") + " text-white";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/security" className="hover:text-white">Security Center</Link><span>/</span><span className="text-white">Behavior Rules</span>
      </div>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Behavior Rules</h1>
        <div className="flex gap-2">
          <button onClick={evaluate} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm">Evaluate Rules Now</button>
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm">+ New Rule</button>
        </div>
      </div>

      {evalResult && (
        <div className="bg-gray-800 border border-gray-700 rounded p-3 text-sm">
          Evaluated {evalResult.evaluated} rules → {evalResult.findingsCreated} new findings created
        </div>
      )}

      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white" placeholder="Rule name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white" value={form.ruleType} onChange={e => setForm({ ...form, ruleType: e.target.value })}>
              <option value="threshold">Threshold</option><option value="pattern">Pattern</option><option value="time">Time-based</option>
            </select>
            <input className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white col-span-2" placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <select className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
              <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
            <input type="number" className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white" placeholder="Cooldown (sec)" value={form.cooldownSeconds} onChange={e => setForm({ ...form, cooldownSeconds: parseInt(e.target.value) })} />
          </div>
          <textarea className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white font-mono text-sm h-24" placeholder='Conditions JSON, e.g. {"eventType":"file.deleted","threshold":100,"timeWindowSeconds":600}' value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} />
          <textarea className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white font-mono text-sm h-16" placeholder='Actions JSON, e.g. [{"type":"create_finding","title":"Mass deletion detected"}]' value={form.actions} onChange={e => setForm({ ...form, actions: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={save} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm">Save Rule</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rules.map(r => (
          <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${sevColor(r.severity)}`}>{r.severity}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${r.enabled ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-400"}`}>{r.enabled ? "Active" : "Disabled"}</span>
                  <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded">{r.ruleType}</span>
                </div>
                <h3 className="text-white font-medium mt-1">{r.name}</h3>
                {r.description && <p className="text-gray-400 text-sm">{r.description}</p>}
              </div>
              <button onClick={() => deleteRule(r.id)} className="text-red-400 hover:text-red-300 text-sm">Delete</button>
            </div>
            <div className="mt-2 text-xs text-gray-500 font-mono">
              Conditions: {JSON.stringify(r.conditions)} | Cooldown: {r.cooldownSeconds}s
            </div>
          </div>
        ))}
        {rules.length === 0 && <div className="text-center text-gray-400 py-8">No behavior rules defined yet</div>}
      </div>
    </div>
  );
}
