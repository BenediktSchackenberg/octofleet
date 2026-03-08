"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Eye, Plus, Edit, Trash2, Shield, Link2, Monitor, Server, Users, X, CheckCircle } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  description: string;
  version: number;
  sensors: Record<string, boolean> | string;
  sampling: Record<string, unknown> | string;
  include_paths: string[] | string;
  exclude_paths: string[] | string;
  created_at: string;
}

interface Assignment {
  id: string;
  target_type: string;
  target_id: string;
  profile_id: string;
  profile_name: string;
  priority: number;
  status: string;
  created_at: string;
}

interface Node { id: string; hostname: string; os_name?: string; }
interface Group { id: string; name: string; }

function parseSensors(s: unknown): Record<string, boolean> {
  if (!s) return {};
  if (typeof s === "string") { try { return JSON.parse(s); } catch { return {}; } }
  return s as Record<string, boolean>;
}

function parsePaths(p: unknown): string[] {
  if (!p) return [];
  if (typeof p === "string") { try { return JSON.parse(p); } catch { return []; } }
  return p as string[];
}

const defaultSensors = ["file_audit", "process_monitor", "network_monitor", "registry_monitor", "logon_events", "service_changes"];

const SENSOR_LABELS: Record<string, string> = {
  file_audit: "File Audit",
  process_monitor: "Process Monitor",
  network_monitor: "Network Monitor",
  registry_monitor: "Registry Monitor",
  logon_events: "Logon Events",
  service_changes: "Service Changes",
};

export default function MonitoringProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editProfile, setEditProfile] = useState<Profile | null>(null);
  const [showAssign, setShowAssign] = useState<Profile | null>(null);
  const [assignType, setAssignType] = useState<"node" | "group">("node");
  const [assignTarget, setAssignTarget] = useState("");
  const [tab, setTab] = useState<"profiles" | "assignments">("profiles");
  const [form, setForm] = useState({ name: "", description: "", sensors: {} as Record<string, boolean>, include_paths: "", exclude_paths: "" });
  const { token } = useAuth();

  async function fetchAll() {
    const [profData, assignData, nodeData, groupData] = await Promise.all([
      apiClient.get<{ profiles: Profile[] }>("/monitoring/profiles", { showErrorToast: false }),
      apiClient.get<{ assignments: Assignment[] }>("/monitoring/assignments", { showErrorToast: false }),
      apiClient.get<{ nodes: Node[] }>("/nodes", { showErrorToast: false }),
      apiClient.get<{ groups: Group[] }>("/groups", { showErrorToast: false }),
    ]);
    setProfiles(profData?.profiles || []);
    setAssignments(assignData?.assignments || []);
    setNodes(nodeData?.nodes || []);
    setGroups(groupData?.groups || []);
    setLoading(false);
  }

  useEffect(() => { if (token) fetchAll(); }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      description: form.description,
      sensors: form.sensors,
      include_paths: form.include_paths.split("\n").filter(Boolean),
      exclude_paths: form.exclude_paths.split("\n").filter(Boolean),
    };
    if (editProfile) {
      await apiClient.put(`/monitoring/profiles/${editProfile.id}`, body);
    } else {
      await apiClient.post(`/monitoring/profiles`, body);
    }
    setShowCreate(false);
    setEditProfile(null);
    setForm({ name: "", description: "", sensors: {}, include_paths: "", exclude_paths: "" });
    fetchAll();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this profile?")) return;
    await apiClient.delete(`/monitoring/profiles/${id}`);
    fetchAll();
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!showAssign || !assignTarget) return;
    await apiClient.post("/monitoring/assignments", {
      target_type: assignType,
      target_id: assignTarget,
      profile_id: showAssign.id,
      priority: 0,
      status: "active",
    });
    setShowAssign(null);
    setAssignTarget("");
    fetchAll();
  }

  async function handleUnassign(id: string) {
    if (!confirm("Remove this assignment?")) return;
    await apiClient.delete(`/monitoring/assignments/${id}`);
    fetchAll();
  }

  function openEdit(p: Profile) {
    setEditProfile(p);
    setForm({
      name: p.name,
      description: p.description || "",
      sensors: parseSensors(p.sensors),
      include_paths: parsePaths(p.include_paths).join("\n"),
      exclude_paths: parsePaths(p.exclude_paths).join("\n"),
    });
    setShowCreate(true);
  }

  function openCreate() {
    setEditProfile(null);
    setForm({ name: "", description: "", sensors: {}, include_paths: "", exclude_paths: "" });
    setShowCreate(true);
  }

  function getTargetName(type: string, id: string): string {
    if (type === "node") {
      const n = nodes.find(n => n.id === id || n.hostname === id);
      return n?.hostname || id;
    }
    const g = groups.find(g => g.id === id);
    return g?.name || id;
  }

  const profileAssignments = (profileId: string) => assignments.filter(a => a.profile_id === profileId);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Eye className="h-8 w-8 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold">Monitoring Profiles</h1>
              <p className="text-zinc-400 text-sm">Configure monitoring sensors and assign to nodes or groups</p>
            </div>
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors">
            <Plus className="h-4 w-4" /> New Profile
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
          <button onClick={() => setTab("profiles")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "profiles" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}>
            <Shield className="h-4 w-4 inline mr-1.5" />Profiles ({profiles.length})
          </button>
          <button onClick={() => setTab("assignments")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "assignments" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}>
            <Link2 className="h-4 w-4 inline mr-1.5" />Assignments ({assignments.length})
          </button>
        </div>

        {/* Create/Edit Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold mb-4">{editProfile ? "Edit Profile" : "New Monitoring Profile"}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm text-zinc-400">Name</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none" placeholder="e.g. Production Servers" />
                </div>
                <div>
                  <label className="text-sm text-zinc-400">Description</label>
                  <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none" rows={2} placeholder="What this profile monitors..." />
                </div>
                <div>
                  <label className="text-sm text-zinc-400 mb-2 block">Sensors</label>
                  <div className="grid grid-cols-2 gap-2">
                    {defaultSensors.map(sensor => (
                      <label key={sensor} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                        form.sensors[sensor] ? "bg-green-500/10 border-green-500/30 text-green-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                      }`}>
                        <input type="checkbox" checked={form.sensors[sensor] || false}
                          onChange={e => setForm({...form, sensors: {...form.sensors, [sensor]: e.target.checked}})}
                          className="rounded accent-green-500" />
                        <span className="text-sm">{SENSOR_LABELS[sensor] || sensor}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm text-zinc-400">Include Paths <span className="text-zinc-600">(one per line)</span></label>
                  <textarea value={form.include_paths} onChange={e => setForm({...form, include_paths: e.target.value})}
                    placeholder={"C:\\Users\\**\\Documents\\**\n/home/*/Documents/**"}
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:border-purple-500 focus:outline-none" rows={3} />
                </div>
                <div>
                  <label className="text-sm text-zinc-400">Exclude Paths <span className="text-zinc-600">(one per line)</span></label>
                  <textarea value={form.exclude_paths} onChange={e => setForm({...form, exclude_paths: e.target.value})}
                    placeholder={"C:\\Windows\\Temp\\**\n/tmp/**"}
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm font-mono focus:border-purple-500 focus:outline-none" rows={3} />
                </div>
                <div className="flex gap-3 justify-end pt-2">
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

        {/* Assign Modal */}
        {showAssign && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAssign(null)}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Assign Profile</h2>
                <button onClick={() => setShowAssign(null)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
              </div>
              <p className="text-sm text-zinc-400 mb-4">
                Assign <span className="text-purple-300 font-medium">{showAssign.name}</span> to a node or group
              </p>
              <form onSubmit={handleAssign} className="space-y-4">
                {/* Type toggle */}
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setAssignType("node"); setAssignTarget(""); }}
                    className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
                      assignType === "node" ? "bg-blue-500/10 border-blue-500/30 text-blue-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                    <Monitor className="h-4 w-4 inline mr-1.5" /> Single Node
                  </button>
                  <button type="button" onClick={() => { setAssignType("group"); setAssignTarget(""); }}
                    className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
                      assignType === "group" ? "bg-blue-500/10 border-blue-500/30 text-blue-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                    <Users className="h-4 w-4 inline mr-1.5" /> Group
                  </button>
                </div>

                {/* Target selector */}
                <div>
                  <label className="text-sm text-zinc-400 mb-1 block">
                    {assignType === "node" ? "Select Node" : "Select Group"}
                  </label>
                  <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)} required
                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none">
                    <option value="">Choose...</option>
                    {assignType === "node"
                      ? nodes.map(n => <option key={n.id} value={n.id}>{n.hostname}</option>)
                      : groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
                    }
                  </select>
                </div>

                {/* Already assigned hint */}
                {assignTarget && profileAssignments(showAssign.id).some(a => a.target_id === assignTarget) && (
                  <div className="text-amber-400 text-xs flex items-center gap-1.5 p-2 bg-amber-500/10 rounded-lg">
                    ⚠️ This target already has this profile assigned
                  </div>
                )}

                <div className="flex gap-3 justify-end pt-2">
                  <button type="button" onClick={() => setShowAssign(null)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancel</button>
                  <button type="submit"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
                    Assign
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
        ) : tab === "profiles" ? (
          /* Profiles Tab */
          profiles.length === 0 ? (
            <div className="text-center py-20">
              <Shield className="h-16 w-16 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No monitoring profiles yet</h3>
              <p className="text-zinc-400 text-sm mb-4">Create your first profile to start monitoring your fleet</p>
              <button onClick={openCreate}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors">
                Create First Profile
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {profiles.map((p) => {
                const sensors = parseSensors(p.sensors);
                const pAssignments = profileAssignments(p.id);
                const activeSensors = Object.entries(sensors).filter(([, v]) => v).length;
                return (
                  <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-purple-500/30 transition-colors">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-lg">{p.name}</h3>
                        <p className="text-zinc-500 text-xs">v{p.version} • {activeSensors} sensors active</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setShowAssign(p); setAssignTarget(""); }} title="Assign to node/group"
                          className="p-1.5 text-zinc-500 hover:text-blue-400 transition-colors">
                          <Link2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => openEdit(p)} title="Edit" className="p-1.5 text-zinc-500 hover:text-white transition-colors">
                          <Edit className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(p.id)} title="Delete" className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {p.description && <p className="text-zinc-400 text-sm mb-3">{p.description}</p>}

                    {/* Sensors */}
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {Object.entries(sensors).filter(([, v]) => v).map(([key]) => (
                        <span key={key} className="px-2 py-0.5 bg-green-500/15 text-green-300 rounded text-xs">
                          {SENSOR_LABELS[key] || key.replace(/_/g, " ")}
                        </span>
                      ))}
                      {Object.entries(sensors).filter(([, v]) => !v).map(([key]) => (
                        <span key={key} className="px-2 py-0.5 bg-zinc-800 text-zinc-500 rounded text-xs">
                          {SENSOR_LABELS[key] || key.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>

                    {/* Assignments */}
                    {pAssignments.length > 0 && (
                      <div className="border-t border-zinc-800 pt-3 mt-3">
                        <p className="text-xs text-zinc-500 mb-2">Assigned to:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {pAssignments.map(a => (
                            <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-300 rounded text-xs">
                              {a.target_type === "node" ? <Monitor className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                              {getTargetName(a.target_type, a.target_id)}
                              <button onClick={() => handleUnassign(a.id)} className="ml-1 hover:text-red-400">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-zinc-600 mt-3">
                      Created {new Date(p.created_at).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Assignments Tab */
          assignments.length === 0 ? (
            <div className="text-center py-20">
              <Link2 className="h-16 w-16 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No assignments yet</h3>
              <p className="text-zinc-400 text-sm">Assign monitoring profiles to nodes or groups from the Profiles tab</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                    <th className="text-left p-4">Profile</th>
                    <th className="text-left p-4">Type</th>
                    <th className="text-left p-4">Target</th>
                    <th className="text-left p-4">Status</th>
                    <th className="text-left p-4">Created</th>
                    <th className="text-right p-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="p-4 font-medium">{a.profile_name || a.profile_id.slice(0, 8)}</td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1 text-xs">
                          {a.target_type === "node" ? <Monitor className="h-3 w-3 text-blue-400" /> : <Users className="h-3 w-3 text-purple-400" />}
                          {a.target_type}
                        </span>
                      </td>
                      <td className="p-4">{getTargetName(a.target_type, a.target_id)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-xs ${a.status === "active" ? "bg-green-500/15 text-green-400" : "bg-zinc-700 text-zinc-400"}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="p-4 text-zinc-400">{new Date(a.created_at).toLocaleDateString()}</td>
                      <td className="p-4 text-right">
                        <button onClick={() => handleUnassign(a.id)} className="text-zinc-500 hover:text-red-400 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
