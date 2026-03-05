"use client";

import { useEffect, useState, useCallback } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { API_BASE } from "@/lib/api-config";
import {
  Archive,
  Box,
  Camera,
  ChevronRight,
  Clock,
  Database,
  FolderSync,
  GitBranch,
  GitCompare,
  Globe,
  History,
  Layers,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Eye,
  Edit,
  Filter,
  Download,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface Repository {
  id: string;
  name: string;
  description: string | null;
  repoType: string;
  upstreamUrl: string | null;
  syncEnabled: boolean;
  syncIntervalHours: number;
  lastSyncedAt: string | null;
  itemCount?: number;
  totalSize?: number;
  createdAt: string;
}

interface ContentItem {
  id: string;
  repositoryId: string;
  name: string;
  version: string;
  architecture: string | null;
  description: string | null;
  fileSize: number | null;
  sha256Hash: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

interface Snapshot {
  id: string;
  repositoryId: string;
  repositoryName?: string;
  name: string;
  description: string | null;
  snapshotType: string;
  itemCount: number;
  totalSize: number;
  createdAt: string;
  createdBy: string | null;
}

interface Environment {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  color: string;
  activeSnapshotId: string | null;
  activeSnapshotName?: string | null;
  promotedAt: string | null;
  promotedBy: string | null;
}

interface DiffResult {
  added: ContentItem[];
  removed: ContentItem[];
  snapshot1: string;
  snapshot2: string;
}

interface DashboardData {
  repositoryCount: number;
  itemCount: number;
  snapshotCount: number;
  totalSize: number;
  environments: Environment[];
  recentPromotions: { environment: string; snapshot: string; promotedAt: string; promotedBy: string }[];
  reposByType: { type: string; count: number }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

const REPO_TYPES = [
  { value: "apt", label: "APT (Debian/Ubuntu)", icon: "🐧" },
  { value: "yum", label: "YUM/DNF (RHEL/CentOS)", icon: "🎩" },
  { value: "chocolatey", label: "Chocolatey", icon: "🍫" },
  { value: "nuget", label: "NuGet", icon: "📦" },
  { value: "winget", label: "WinGet", icon: "🪟" },
  { value: "generic", label: "Generic", icon: "📁" },
];

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function timeAgo(date: string | null): string {
  if (!date) return "Never";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function repoTypeIcon(type: string): string {
  return REPO_TYPES.find((t) => t.value === type)?.icon || "📁";
}

// ─── Component ───────────────────────────────────────────────────────

export default function ContentLifecyclePage() {
  const [activeTab, setActiveTab] = useState<"pipeline" | "repositories" | "snapshots" | "items">("pipeline");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dashboard / Pipeline
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);

  // Repositories
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoForm, setShowRepoForm] = useState(false);
  const [repoForm, setRepoForm] = useState({ name: "", description: "", repo_type: "generic", upstream_url: "", sync_enabled: false, sync_interval_hours: 24 });
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);

  // Items
  const [items, setItems] = useState<ContentItem[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemForm, setItemForm] = useState({ name: "", version: "", architecture: "", description: "", source_url: "" });

  // Snapshots
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [showSnapshotForm, setShowSnapshotForm] = useState(false);
  const [snapshotForm, setSnapshotForm] = useState({ name: "", description: "", repository_id: "" });
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [snapshotItems, setSnapshotItems] = useState<ContentItem[]>([]);

  // Diff
  const [showDiff, setShowDiff] = useState(false);
  const [diffSnapshot1, setDiffSnapshot1] = useState("");
  const [diffSnapshot2, setDiffSnapshot2] = useState("");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  // Promote
  const [showPromote, setShowPromote] = useState(false);
  const [promoteEnvId, setPromoteEnvId] = useState("");
  const [promoteSnapshotId, setPromoteSnapshotId] = useState("");

  // ─── API ─────────────────────────────────────────────────────────

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`${API_BASE}/content${path}`, {
      ...opts,
      headers: { ...getAuthHeader(), "Content-Type": "application/json", ...opts?.headers },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  // ─── Loaders ─────────────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, envs] = await Promise.all([api("/dashboard"), api("/environments")]);
      setDashboard(dash);
      setEnvironments(Array.isArray(envs) ? envs : envs.environments || []);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [api]);

  const loadRepos = useCallback(async () => {
    try {
      const res = await api("/repositories");
      setRepos(Array.isArray(res) ? res : res.repositories || []);
    } catch (e: any) { setError(e.message); }
  }, [api]);

  const loadItems = useCallback(async (repoId: string) => {
    try {
      const res = await api(`/repositories/${repoId}/items`);
      setItems(Array.isArray(res) ? res : res.items || []);
    } catch (e: any) { setError(e.message); }
  }, [api]);

  const loadSnapshots = useCallback(async () => {
    try {
      const res = await api("/snapshots");
      setSnapshots(Array.isArray(res) ? res : res.snapshots || []);
    } catch (e: any) { setError(e.message); }
  }, [api]);

  const loadSnapshotDetail = useCallback(async (id: string) => {
    try {
      const res = await api(`/snapshots/${id}`);
      setSnapshotItems(res.items || []);
    } catch (e: any) { setError(e.message); }
  }, [api]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === "repositories") loadRepos();
    if (activeTab === "snapshots") { loadSnapshots(); loadRepos(); }
    if (activeTab === "pipeline") loadDashboard();
  }, [activeTab, loadRepos, loadSnapshots, loadDashboard]);

  useEffect(() => {
    if (selectedRepo) loadItems(selectedRepo.id);
  }, [selectedRepo, loadItems]);

  // ─── CRUD ────────────────────────────────────────────────────────

  const saveRepo = async () => {
    try {
      await api("/repositories", { method: "POST", body: JSON.stringify(repoForm) });
      setShowRepoForm(false);
      setRepoForm({ name: "", description: "", repo_type: "generic", upstream_url: "", sync_enabled: false, sync_interval_hours: 24 });
      loadRepos();
    } catch (e: any) { setError(e.message); }
  };

  const deleteRepo = async (id: string) => {
    if (!confirm("Delete this repository and all its content?")) return;
    try { await api(`/repositories/${id}`, { method: "DELETE" }); loadRepos(); setSelectedRepo(null); } catch (e: any) { setError(e.message); }
  };

  const syncRepo = async (id: string) => {
    try { await api(`/repositories/${id}/sync`, { method: "POST" }); loadRepos(); } catch (e: any) { setError(e.message); }
  };

  const saveItem = async () => {
    if (!selectedRepo) return;
    try {
      await api(`/repositories/${selectedRepo.id}/items`, { method: "POST", body: JSON.stringify(itemForm) });
      setShowItemForm(false);
      setItemForm({ name: "", version: "", architecture: "", description: "", source_url: "" });
      loadItems(selectedRepo.id);
    } catch (e: any) { setError(e.message); }
  };

  const deleteItem = async (id: string) => {
    if (!selectedRepo) return;
    try { await api(`/items/${id}`, { method: "DELETE" }); loadItems(selectedRepo.id); } catch (e: any) { setError(e.message); }
  };

  const createSnapshot = async () => {
    try {
      await api(`/repositories/${snapshotForm.repository_id}/snapshots`, {
        method: "POST",
        body: JSON.stringify({ name: snapshotForm.name, description: snapshotForm.description }),
      });
      setShowSnapshotForm(false);
      setSnapshotForm({ name: "", description: "", repository_id: "" });
      loadSnapshots();
    } catch (e: any) { setError(e.message); }
  };

  const deleteSnapshot = async (id: string) => {
    if (!confirm("Delete this snapshot?")) return;
    try { await api(`/snapshots/${id}`, { method: "DELETE" }); loadSnapshots(); } catch (e: any) { setError(e.message); }
  };

  const runDiff = async () => {
    try {
      const res = await api(`/snapshots/${diffSnapshot1}/diff/${diffSnapshot2}`);
      setDiffResult(res);
    } catch (e: any) { setError(e.message); }
  };

  const promote = async () => {
    try {
      await api(`/environments/${promoteEnvId}/promote`, {
        method: "POST",
        body: JSON.stringify({ snapshot_id: promoteSnapshotId }),
      });
      setShowPromote(false);
      loadDashboard();
    } catch (e: any) { setError(e.message); }
  };

  const rollback = async (envId: string) => {
    if (!confirm("Rollback to previous snapshot?")) return;
    try { await api(`/environments/${envId}/rollback`, { method: "POST" }); loadDashboard(); } catch (e: any) { setError(e.message); }
  };

  // ─── Render ──────────────────────────────────────────────────────

  const filteredRepos = (Array.isArray(repos) ? repos : []).filter(
    (r) => !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const filteredItems = (Array.isArray(items) ? items : []).filter(
    (i) => !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-[1600px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Layers className="h-8 w-8 text-amber-400" />
              Content Lifecycle
            </h1>
            <p className="text-zinc-400 mt-1">Repository management, snapshots & environment promotion</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
          {([
            { id: "pipeline", label: "Pipeline", icon: GitBranch },
            { id: "repositories", label: "Repositories", icon: Database },
            { id: "snapshots", label: "Snapshots", icon: Camera },
            { id: "items", label: "Browse", icon: Package },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id ? "bg-amber-500/20 text-amber-400" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* ═══ Pipeline Tab ═══ */}
        {activeTab === "pipeline" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            {dashboard && (
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: "Repositories", value: dashboard.repositoryCount, icon: Database, color: "amber" },
                  { label: "Content Items", value: dashboard.itemCount, icon: Package, color: "blue" },
                  { label: "Snapshots", value: dashboard.snapshotCount, icon: Camera, color: "violet" },
                  { label: "Total Size", value: formatSize(dashboard.totalSize), icon: Archive, color: "emerald" },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <kpi.icon className={`h-4 w-4 text-${kpi.color}-400`} />
                      <span className="text-xs text-zinc-500">{kpi.label}</span>
                    </div>
                    <div className="text-2xl font-bold">{kpi.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Environment Pipeline */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-semibold">Environment Pipeline</span>
                </div>
                <button onClick={() => { setShowPromote(true); loadSnapshots(); }} className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-medium">
                  <Rocket className="h-3.5 w-3.5" /> Promote
                </button>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-4">
                  {environments.map((env, i) => (
                    <div key={env.id} className="flex items-center gap-4 flex-1">
                      <div className="flex-1 bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 relative">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: env.color }} />
                          <span className="font-semibold">{env.name}</span>
                        </div>
                        {env.activeSnapshotName || env.activeSnapshotId ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Camera className="h-3.5 w-3.5 text-zinc-500" />
                              <span className="text-sm text-zinc-300">{env.activeSnapshotName || env.activeSnapshotId?.slice(0, 8)}</span>
                            </div>
                            {env.promotedAt && (
                              <div className="flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                                <span className="text-xs text-zinc-500">{timeAgo(env.promotedAt)}</span>
                              </div>
                            )}
                            <button onClick={() => rollback(env.id)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-amber-400 mt-2">
                              <RotateCcw className="h-3 w-3" /> Rollback
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-600">No snapshot promoted</p>
                        )}
                      </div>
                      {i < environments.length - 1 && (
                        <ArrowRight className="h-5 w-5 text-zinc-600 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Repos by Type + Recent Promotions */}
            {dashboard && (
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <Database className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-semibold">Repositories by Type</span>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {(dashboard.reposByType || []).map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm">{repoTypeIcon(r.type)} {r.type}</span>
                        <span className="text-sm font-mono text-amber-400">{r.count}</span>
                      </div>
                    ))}
                    {(!dashboard.reposByType || dashboard.reposByType.length === 0) && (
                      <p className="text-sm text-zinc-600 text-center py-4">No repositories created yet</p>
                    )}
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <History className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-semibold">Recent Promotions</span>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {(dashboard.recentPromotions || []).map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded mr-2">{p.environment}</span>
                          <span className="text-sm text-zinc-300">{p.snapshot}</span>
                        </div>
                        <span className="text-xs text-zinc-500">{timeAgo(p.promotedAt)}</span>
                      </div>
                    ))}
                    {(!dashboard.recentPromotions || dashboard.recentPromotions.length === 0) && (
                      <p className="text-sm text-zinc-600 text-center py-4">No promotions yet</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
              </div>
            )}
          </div>
        )}

        {/* ═══ Repositories Tab ═══ */}
        {activeTab === "repositories" && (
          <div className="grid grid-cols-12 gap-6">
            {/* Repo List */}
            <div className={selectedRepo ? "col-span-5" : "col-span-12"}>
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-zinc-200"
                  />
                </div>
                <button onClick={() => setShowRepoForm(true)} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                  <Plus className="h-4 w-4" /> New Repo
                </button>
              </div>

              {showRepoForm && (
                <div className="bg-zinc-900 border border-amber-500/30 rounded-lg p-4 mb-4 space-y-3">
                  <h3 className="text-sm font-semibold">New Repository</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" placeholder="Name" value={repoForm.name} onChange={(e) => setRepoForm({ ...repoForm, name: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                    <select value={repoForm.repo_type} onChange={(e) => setRepoForm({ ...repoForm, repo_type: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                      {REPO_TYPES.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
                    </select>
                    <input type="text" placeholder="Upstream URL (optional)" value={repoForm.upstream_url} onChange={(e) => setRepoForm({ ...repoForm, upstream_url: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 col-span-2" />
                    <input type="text" placeholder="Description" value={repoForm.description} onChange={(e) => setRepoForm({ ...repoForm, description: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 col-span-2" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveRepo} className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-sm">Create</button>
                    <button onClick={() => setShowRepoForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {filteredRepos.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRepo(r)}
                    className={`bg-zinc-900 border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedRepo?.id === r.id ? "border-amber-500/50 bg-amber-500/5" : "border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{repoTypeIcon(r.repoType)}</span>
                        <div>
                          <div className="font-medium text-zinc-200">{r.name}</div>
                          <div className="text-xs text-zinc-500">{r.description || r.repoType}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <div className="text-sm font-mono">{r.itemCount ?? 0}</div>
                          <div className="text-xs text-zinc-600">items</div>
                        </div>
                        <div>
                          <div className="text-sm font-mono">{formatSize(r.totalSize)}</div>
                          <div className="text-xs text-zinc-600">size</div>
                        </div>
                        <div className="flex gap-1">
                          {r.syncEnabled && (
                            <button onClick={(e) => { e.stopPropagation(); syncRepo(r.id); }} className="text-zinc-500 hover:text-amber-400 p-1" title="Sync">
                              <FolderSync className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); deleteRepo(r.id); }} className="text-zinc-500 hover:text-red-400 p-1">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {r.lastSyncedAt && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
                        <RefreshCw className="h-3 w-3" /> Synced {timeAgo(r.lastSyncedAt)}
                      </div>
                    )}
                  </div>
                ))}
                {filteredRepos.length === 0 && (
                  <div className="py-12 text-center">
                    <Database className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
                    <p className="text-zinc-500">No repositories yet</p>
                    <p className="text-xs text-zinc-600 mt-1">Create a repository to start managing content</p>
                  </div>
                )}
              </div>
            </div>

            {/* Repo Detail / Items */}
            {selectedRepo && (
              <div className="col-span-7">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{repoTypeIcon(selectedRepo.repoType)}</span>
                      <span className="font-semibold">{selectedRepo.name}</span>
                      <span className="text-xs text-zinc-500">— {items.length} items</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setShowItemForm(true)} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs">
                        <Plus className="h-3.5 w-3.5" /> Add Item
                      </button>
                      <button onClick={() => setSelectedRepo(null)} className="text-zinc-500 hover:text-zinc-300 p-1">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {showItemForm && (
                    <div className="p-4 border-b border-zinc-800 bg-zinc-800/30 space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <input type="text" placeholder="Package name" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                        <input type="text" placeholder="Version" value={itemForm.version} onChange={(e) => setItemForm({ ...itemForm, version: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                        <input type="text" placeholder="Architecture (x64, arm64...)" value={itemForm.architecture} onChange={(e) => setItemForm({ ...itemForm, architecture: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveItem} className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-sm">Add</button>
                        <button onClick={() => setShowItemForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className="p-2">
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={(e) => setItemSearch(e.target.value)}
                        placeholder="Filter items..."
                        className="w-full bg-zinc-800 border border-zinc-700 rounded pl-9 pr-3 py-1.5 text-xs text-zinc-200"
                      />
                    </div>
                  </div>

                  <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-800/50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs text-zinc-400">Package</th>
                          <th className="px-4 py-2 text-left text-xs text-zinc-400">Version</th>
                          <th className="px-4 py-2 text-left text-xs text-zinc-400">Arch</th>
                          <th className="px-4 py-2 text-right text-xs text-zinc-400">Size</th>
                          <th className="px-4 py-2 text-right text-xs text-zinc-400"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {filteredItems.map((item) => (
                          <tr key={item.id} className="hover:bg-zinc-800/30">
                            <td className="px-4 py-2 text-zinc-200">{item.name}</td>
                            <td className="px-4 py-2 font-mono text-xs text-zinc-400">{item.version}</td>
                            <td className="px-4 py-2 text-xs text-zinc-500">{item.architecture || "—"}</td>
                            <td className="px-4 py-2 text-right text-xs text-zinc-500">{formatSize(item.fileSize)}</td>
                            <td className="px-4 py-2 text-right">
                              <button onClick={() => deleteItem(item.id)} className="text-zinc-600 hover:text-red-400 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredItems.length === 0 && (
                      <div className="py-8 text-center">
                        <Package className="h-8 w-8 text-zinc-700 mx-auto mb-2" />
                        <p className="text-xs text-zinc-600">No items in this repository</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ Snapshots Tab ═══ */}
        {activeTab === "snapshots" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button onClick={() => { setShowSnapshotForm(true); loadRepos(); }} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                  <Camera className="h-4 w-4" /> Create Snapshot
                </button>
                <button onClick={() => { setShowDiff(true); }} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-sm">
                  <GitCompare className="h-4 w-4" /> Compare
                </button>
              </div>
            </div>

            {showSnapshotForm && (
              <div className="bg-zinc-900 border border-amber-500/30 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold">Create Snapshot</h3>
                <div className="grid grid-cols-3 gap-3">
                  <select value={snapshotForm.repository_id} onChange={(e) => setSnapshotForm({ ...snapshotForm, repository_id: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Select repository...</option>
                    {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <input type="text" placeholder="Snapshot name" value={snapshotForm.name} onChange={(e) => setSnapshotForm({ ...snapshotForm, name: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="text" placeholder="Description" value={snapshotForm.description} onChange={(e) => setSnapshotForm({ ...snapshotForm, description: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                </div>
                <div className="flex gap-2">
                  <button onClick={createSnapshot} className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-sm">Create</button>
                  <button onClick={() => setShowSnapshotForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                </div>
              </div>
            )}

            {showDiff && (
              <div className="bg-zinc-900 border border-violet-500/30 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold">Compare Snapshots</h3>
                <div className="grid grid-cols-3 gap-3">
                  <select value={diffSnapshot1} onChange={(e) => setDiffSnapshot1(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Snapshot A...</option>
                    {snapshots.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.repositoryName})</option>)}
                  </select>
                  <select value={diffSnapshot2} onChange={(e) => setDiffSnapshot2(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Snapshot B...</option>
                    {snapshots.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.repositoryName})</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={runDiff} disabled={!diffSnapshot1 || !diffSnapshot2} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm">Compare</button>
                    <button onClick={() => { setShowDiff(false); setDiffResult(null); }} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Close</button>
                  </div>
                </div>
                {diffResult && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <h4 className="text-xs text-green-400 font-medium mb-2">+ Added ({diffResult.added.length})</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {diffResult.added.map((i) => (
                          <div key={i.id} className="text-xs text-zinc-300 bg-green-500/10 rounded px-2 py-1">{i.name} {i.version}</div>
                        ))}
                        {diffResult.added.length === 0 && <p className="text-xs text-zinc-600">No additions</p>}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs text-red-400 font-medium mb-2">− Removed ({diffResult.removed.length})</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {diffResult.removed.map((i) => (
                          <div key={i.id} className="text-xs text-zinc-300 bg-red-500/10 rounded px-2 py-1">{i.name} {i.version}</div>
                        ))}
                        {diffResult.removed.length === 0 && <p className="text-xs text-zinc-600">No removals</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Snapshot List */}
            <div className="grid grid-cols-3 gap-4">
              {snapshots.map((s) => (
                <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4 text-violet-400" />
                      <span className="font-medium">{s.name}</span>
                    </div>
                    <button onClick={() => deleteSnapshot(s.id)} className="text-zinc-600 hover:text-red-400 p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {s.repositoryName && <p className="text-xs text-zinc-500 mb-2">{s.repositoryName}</p>}
                  <div className="flex items-center gap-4 text-xs text-zinc-400">
                    <span>{s.itemCount} items</span>
                    <span>{formatSize(s.totalSize)}</span>
                    <span className={`px-1.5 py-0.5 rounded ${s.snapshotType === "auto" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-800 text-zinc-400"}`}>{s.snapshotType}</span>
                  </div>
                  <div className="mt-2 text-xs text-zinc-600">
                    {timeAgo(s.createdAt)} {s.createdBy && `by ${s.createdBy}`}
                  </div>
                  <button
                    onClick={() => { setSelectedSnapshot(s); loadSnapshotDetail(s.id); }}
                    className="mt-3 flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
                  >
                    <Eye className="h-3 w-3" /> View Items
                  </button>
                </div>
              ))}
            </div>

            {snapshots.length === 0 && (
              <div className="py-12 text-center">
                <Camera className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-500">No snapshots yet</p>
                <p className="text-xs text-zinc-600 mt-1">Create a snapshot to freeze a repository's state</p>
              </div>
            )}

            {/* Snapshot Detail Modal */}
            {selectedSnapshot && (
              <div className="bg-zinc-900 border border-violet-500/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Camera className="h-4 w-4 text-violet-400" />
                    {selectedSnapshot.name} — {snapshotItems.length} items
                  </h3>
                  <button onClick={() => setSelectedSnapshot(null)} className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-800/50">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-zinc-400">Package</th>
                        <th className="px-3 py-1.5 text-left text-zinc-400">Version</th>
                        <th className="px-3 py-1.5 text-left text-zinc-400">Arch</th>
                        <th className="px-3 py-1.5 text-right text-zinc-400">Size</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {snapshotItems.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-1.5 text-zinc-200">{item.name}</td>
                          <td className="px-3 py-1.5 font-mono text-zinc-400">{item.version}</td>
                          <td className="px-3 py-1.5 text-zinc-500">{item.architecture || "—"}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-500">{formatSize(item.fileSize)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ Browse Tab ═══ */}
        {activeTab === "items" && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">Select a repository in the Repositories tab to browse its content.</p>
            <button onClick={() => setActiveTab("repositories")} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-sm">
              <Database className="h-4 w-4" /> Go to Repositories
            </button>
          </div>
        )}

        {/* ═══ Promote Modal ═══ */}
        {showPromote && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowPromote(false)}>
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[480px] space-y-4" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Rocket className="h-5 w-5 text-amber-400" />
                Promote Snapshot
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Target Environment</label>
                  <select value={promoteEnvId} onChange={(e) => setPromoteEnvId(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Select environment...</option>
                    {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Snapshot</label>
                  <select value={promoteSnapshotId} onChange={(e) => setPromoteSnapshotId(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Select snapshot...</option>
                    {snapshots.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.repositoryName}) — {s.itemCount} items</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowPromote(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                <button onClick={promote} disabled={!promoteEnvId || !promoteSnapshotId} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm">Promote</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
