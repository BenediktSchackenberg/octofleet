import { apiClient } from "@/lib/api-client";
"use client";

import { useState, useEffect } from "react";
import { API_BASE } from "@/lib/api-config";
import { useAuth } from "@/lib/auth-context";
import { Eye, Plus, Edit, Trash2, Shield } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  description: string;
  version: number;
  sensors: Record<string, boolean>;
  sampling: Record<string, unknown>;
  include_paths: string[];
  exclude_paths: string[];
  created_at: string;
}

export default function MonitoringProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: "", description: "", sensors: {} as Record<string, boolean>, include_paths: "", exclude_paths: "" });
  const { token } = useAuth();

  const defaultSensors = ["file_audit", "process_monitor", "network_monitor", "registry_monitor", "logon_events", "service_changes"];

  async function fetchProfiles() {
    const res = await apiClient.get(`/monitoring/profiles`, { showErrorToast: false });
    const data = await res.json();
    setProfiles(data.profiles || []);
    setLoading(false);
  }

  useEffect(() => { if (token) fetchProfiles(); }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      description: form.description,
      sensors: form.sensors,
      include_paths: form.include_paths.split("\n").filter(Boolean),
      exclude_paths: form.exclude_paths.split("\n").filter(Boolean),
    };
    const url = editProfile ? `${API_BASE}/monitoring/profiles/${editProfile.id}` : `${API_BASE}/monitoring/profiles`;
    const method = editProfile ? "PUT" : "POST";
    await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setShowCreate(false);
    setEditProfile(null);
    setForm({ name: "", description: "", sensors: {}, include_paths: "", exclude_paths: "" });
    fetchProfiles();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this profile?")) return;
    await apiClient.delete(`/monitoring/profiles/${id}`, { showErrorToast: false });
    fetchProfiles();
  }

  function openEdit(p: Profile) {
    setEditProfile(p);
    setForm({
      name: p.name,
      description: p.description || "",
      sensors: p.sensors || {},
      include_paths: (p.include_paths || []).join("\n"),
      exclude_paths: (p.exclude_paths || []).join("\n"),
    });
    setShowCreate(true);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Eye className="h-8 w-8 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold">Monitoring Profiles</h1>
              <p className="text-zinc-400 text-sm">Configure what to monitor — sensors, sampling rates, and file paths</p>
            </div>
          </div>
          <button onClick={() => { setEditProfile(null); setForm({ name: "", description: "", sensors: {}, include_paths: "", exclude_paths: "" }); setShowCreate(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors">
            <Plus className="h-4 w-4" /> New Profile
          </button>
        </div>

        {/* Create/Edit Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-bold mb-4">{editProfile ? "Edit Profile" : "New Monitoring Profile"}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm text-zinc-400">Name</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-sm text-zinc-400">Description</label>
                  <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm" rows={2} />
                </div>
                <div>
                  <label className="text-sm text-zinc-400 mb-2 block">Sensors</label>
                  <div className="grid grid-cols-2 gap-2">
                    {defaultSensors.map(sensor => (
                      <label key={sensor} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.sensors[sensor] || false}
                          onChange={e => setForm({...form, sensors: {...form.sensors, [sensor]: e.target.checked}})}
                          className="rounded" />
                        {sensor.replace(/_/g, " ")}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm text-zinc-400">Include Paths (one per line)</label>
                  <textarea value={form.include_paths} onChange={e => setForm({...form, include_paths: e.target.value})}
                    placeholder="C:\Users\**\Documents\**&#10;/home/*/Documents/**"
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono" rows={3} />
                </div>
                <div>
                  <label className="text-sm text-zinc-400">Exclude Paths (one per line)</label>
                  <textarea value={form.exclude_paths} onChange={e => setForm({...form, exclude_paths: e.target.value})}
                    placeholder="C:\Windows\Temp\**&#10;/tmp/**"
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono" rows={3} />
                </div>
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
                  <button type="submit"
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors">
                    {editProfile ? "Update" : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-20">
            <Shield className="h-16 w-16 text-zinc-700 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No monitoring profiles yet</h3>
            <p className="text-zinc-400 text-sm mb-4">Create your first profile to start monitoring your fleet</p>
            <button onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors">
              Create First Profile
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {profiles.map((p) => (
              <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-purple-500/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="text-zinc-400 text-xs">v{p.version}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(p)} className="p-1.5 text-zinc-500 hover:text-white transition-colors">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {p.description && <p className="text-zinc-400 text-sm mb-3">{p.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(p.sensors || {}).filter(([, v]) => v).map(([key]) => (
                    <span key={key} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs">
                      {key.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-zinc-600 mt-3">
                  Created {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
