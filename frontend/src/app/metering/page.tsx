"use client";

import { useEffect, useState, useCallback } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { API_BASE } from "@/lib/api-config";
import {
  Package,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  DollarSign,
  TrendingDown,
  BarChart3,
  PieChart,
  Plus,
  Trash2,
  Edit,
  Search,
  RefreshCw,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Server,
  Tag,
  FileText,
  Eye,
  Wand2,
  TestTube,
  X,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface CatalogEntry {
  id: string;
  canonicalName?: string;
  canonical_name?: string;
  publisher: string | null;
  category: string;
  isTracked?: boolean;
  is_tracked?: boolean;
  notes: string | null;
  installedCount?: number;
  installed_count?: number;
  nodeCount?: number;
  node_count?: number;
  licenseCount?: number;
  licensed_count?: number;
  totalLicenses?: number | null;
  complianceStatus?: string;
  compliance_status?: string;
}

interface License {
  id: string;
  catalog_id: string;
  catalog_name?: string;
  license_type: string;
  total_licenses: number | null;
  cost_per_license: number | null;
  currency: string;
  vendor: string | null;
  contract_id: string | null;
  expires_at: string | null;
  notes: string | null;
  installed_count?: number;
  used_count?: number;
}

interface NormRule {
  id: number;
  pattern: string;
  match_type: string;
  catalog_id: string;
  catalog_name?: string;
  priority: number;
  match_count?: number;
}

interface ComplianceSummary {
  compliant: number;
  over_licensed?: number;
  overLicensed?: number;
  under_licensed?: number;
  underLicensed?: number;
  untracked: number;
  total_cost?: number;
  totalCost?: number;
  potential_savings?: number;
  potentialSavings?: number;
  total_installed?: number;
  totalInstalled?: number;
  total_licensed?: number;
  totalLicensed?: number;
}

interface DashboardData {
  top_installed: { name: string; count: number; nodeCount?: number; publisher: string }[];
  top_unused: { name: string; node_count: number; days_unused: number }[];
  compliance_summary: ComplianceSummary;
  cost_by_category: { category: string; cost: number }[];
  recent_changes: { name: string; change_type: string; node: string; date: string }[];
}

interface ReclaimCandidate {
  software_name: string;
  catalog_name: string;
  node_hostname: string;
  node_id: string;
  last_used: string | null;
  days_unused: number;
  license_cost: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const CATEGORIES = ["Productivity", "Development", "Security", "System", "Communication", "Browser", "Media", "Other"];
const LICENSE_TYPES = [
  { value: "per_device", label: "Per Device" },
  { value: "per_user", label: "Per User" },
  { value: "site", label: "Site License" },
  { value: "unlimited", label: "Unlimited" },
  { value: "subscription", label: "Subscription" },
];

function complianceBadge(status?: string) {
  const s = status?.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase→snake_case
  switch (s) {
    case "compliant":
      return <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded"><CheckCircle2 className="h-3 w-3" />Compliant</span>;
    case "over_licensed":
      return <span className="flex items-center gap-1 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded"><TrendingDown className="h-3 w-3" />Over-licensed</span>;
    case "under_licensed":
      return <span className="flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded"><ShieldAlert className="h-3 w-3" />Under-licensed</span>;
    default:
      return <span className="text-xs bg-zinc-500/20 text-zinc-400 px-2 py-0.5 rounded">Untracked</span>;
  }
}

function formatCurrency(amount: number | null, currency = "EUR") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
}

// Helpers for camelCase/snake_case field access
function catName(c: CatalogEntry): string { return c.canonicalName || c.canonical_name || ""; }
function catNodes(c: CatalogEntry): number | undefined { return c.nodeCount ?? c.node_count ?? (c as any).installedCount ?? (c as any).installed_count; }
function catLicenses(c: CatalogEntry): number | undefined { return c.licenseCount ?? catLicenses(c) ?? c.totalLicenses ?? undefined; }
function catCompliance(c: CatalogEntry): string | undefined { return c.complianceStatus || c.compliance_status; }

// ─── Component ───────────────────────────────────────────────────────

export default function SoftwareMeteringPage() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "catalog" | "licenses" | "rules" | "usage" | "reports">("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dashboard
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [compliance, setCompliance] = useState<ComplianceSummary | null>(null);

  // Catalog
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [showCatalogForm, setShowCatalogForm] = useState(false);
  const [editingCatalog, setEditingCatalog] = useState<CatalogEntry | null>(null);
  const [catalogForm, setCatalogForm] = useState({ canonical_name: "", publisher: "", category: "Other", notes: "" });

  // Licenses
  const [licenses, setLicenses] = useState<License[]>([]);
  const [showLicenseForm, setShowLicenseForm] = useState(false);
  const [licenseForm, setLicenseForm] = useState({
    catalog_id: "", license_type: "per_device", total_licenses: "", cost_per_license: "", currency: "EUR", vendor: "", contract_id: "", expires_at: "", notes: ""
  });

  // Rules
  const [rules, setRules] = useState<NormRule[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState({ pattern: "", match_type: "like", catalog_id: "", priority: "0" });
  const [ruleTestResult, setRuleTestResult] = useState<string[] | null>(null);

  // Usage / Reclaim
  const [reclaimCandidates, setReclaimCandidates] = useState<ReclaimCandidate[]>([]);

  // True-up report
  const [trueUp, setTrueUp] = useState<any[] | null>(null);

  // ─── API helpers ─────────────────────────────────────────────────

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const res = await fetch(`${API_BASE}/metering${path}`, {
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
      const [dash, comp] = await Promise.all([
        api("/dashboard"),
        api("/compliance"),
      ]);
      // Normalize camelCase keys from backend
      setDashboard({
        top_installed: dash.topInstalled || dash.top_installed || [],
        top_unused: dash.topUnused || dash.top_unused || [],
        compliance_summary: dash.compliance || dash.compliance_summary || comp,
        cost_by_category: (() => {
          const raw = dash.costByCategory || dash.cost_by_category || {};
          if (Array.isArray(raw)) return raw;
          return Object.entries(raw).map(([category, cost]) => ({ category, cost: cost as number }));
        })(),
        recent_changes: dash.recentChanges || dash.recent_changes || [],
      });
      setCompliance(comp);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [api]);

  const loadCatalog = useCallback(async () => {
    try { const res = await api("/catalog"); setCatalog(res.catalog || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadLicenses = useCallback(async () => {
    try { const res = await api("/licenses"); setLicenses(res.licenses || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadRules = useCallback(async () => {
    try { const res = await api("/rules"); setRules(res.rules || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadReclaim = useCallback(async () => {
    try { const res = await api("/usage/reclaim"); setReclaimCandidates(res.candidates || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadTrueUp = useCallback(async () => {
    try { const res = await api("/reports/true-up"); setTrueUp(res.report || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === "catalog") loadCatalog();
    if (activeTab === "licenses") { loadLicenses(); loadCatalog(); }
    if (activeTab === "rules") { loadRules(); loadCatalog(); }
    if (activeTab === "usage") loadReclaim();
    if (activeTab === "reports") loadTrueUp();
  }, [activeTab, loadCatalog, loadLicenses, loadRules, loadReclaim, loadTrueUp]);

  // ─── CRUD ────────────────────────────────────────────────────────

  const saveCatalog = async () => {
    try {
      if (editingCatalog) {
        await api(`/catalog/${editingCatalog.id}`, { method: "PUT", body: JSON.stringify({ canonicalName: catalogForm.canonical_name, publisher: catalogForm.publisher, category: catalogForm.category, notes: catalogForm.notes }) });
      } else {
        await api("/catalog", { method: "POST", body: JSON.stringify({ canonicalName: catalogForm.canonical_name, publisher: catalogForm.publisher, category: catalogForm.category, notes: catalogForm.notes }) });
      }
      setShowCatalogForm(false);
      setEditingCatalog(null);
      setCatalogForm({ canonical_name: "", publisher: "", category: "Other", notes: "" });
      loadCatalog();
    } catch (e: any) { setError(e.message); }
  };

  const deleteCatalog = async (id: string) => {
    if (!confirm("Delete this catalog entry and all associated licenses/rules?")) return;
    try { await api(`/catalog/${id}`, { method: "DELETE" }); loadCatalog(); } catch (e: any) { setError(e.message); }
  };

  const autoDiscover = async () => {
    setLoading(true);
    try {
      const res = await api("/catalog/auto-discover", { method: "POST" });
      setError(null);
      loadCatalog();
      alert(`Auto-discovered ${res.created || 0} new software entries!`);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const saveLicense = async () => {
    try {
      await api("/licenses", {
        method: "POST",
        body: JSON.stringify({
          ...licenseForm,
          total_licenses: licenseForm.total_licenses ? parseInt(licenseForm.total_licenses) : null,
          cost_per_license: licenseForm.cost_per_license ? parseFloat(licenseForm.cost_per_license) : null,
          expires_at: licenseForm.expires_at || null,
        }),
      });
      setShowLicenseForm(false);
      setLicenseForm({ catalog_id: "", license_type: "per_device", total_licenses: "", cost_per_license: "", currency: "EUR", vendor: "", contract_id: "", expires_at: "", notes: "" });
      loadLicenses();
    } catch (e: any) { setError(e.message); }
  };

  const deleteLicense = async (id: string) => {
    if (!confirm("Delete this license?")) return;
    try { await api(`/licenses/${id}`, { method: "DELETE" }); loadLicenses(); } catch (e: any) { setError(e.message); }
  };

  const saveRule = async () => {
    try {
      await api("/rules", {
        method: "POST",
        body: JSON.stringify({ ...ruleForm, priority: parseInt(ruleForm.priority) || 0 }),
      });
      setShowRuleForm(false);
      setRuleForm({ pattern: "", match_type: "like", catalog_id: "", priority: "0" });
      loadRules();
    } catch (e: any) { setError(e.message); }
  };

  const testRule = async () => {
    try {
      const res = await api("/rules/test", {
        method: "POST",
        body: JSON.stringify({ pattern: ruleForm.pattern, match_type: ruleForm.match_type }),
      });
      setRuleTestResult(res.matches || []);
    } catch (e: any) { setError(e.message); }
  };

  const deleteRule = async (id: number) => {
    try { await api(`/rules/${id}`, { method: "DELETE" }); loadRules(); } catch (e: any) { setError(e.message); }
  };

  // ─── Render ──────────────────────────────────────────────────────

  const filteredCatalog = (Array.isArray(catalog) ? catalog : []).filter((c) =>
        !catalogSearch || catName(c).toLowerCase().includes(catalogSearch.toLowerCase()) || (c.publisher || "").toLowerCase().includes(catalogSearch.toLowerCase())
      );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-[1600px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Package className="h-8 w-8 text-violet-400" />
              Software Metering & Licenses
            </h1>
            <p className="text-zinc-400 mt-1">Track usage, manage licenses, save money</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
          {([
            { id: "dashboard", label: "Dashboard", icon: BarChart3 },
            { id: "catalog", label: "Software Catalog", icon: Package },
            { id: "licenses", label: "Licenses", icon: FileText },
            { id: "rules", label: "Normalization", icon: Wand2 },
            { id: "usage", label: "Reclamation", icon: TrendingDown },
            { id: "reports", label: "True-Up Report", icon: PieChart },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id ? "bg-violet-500/20 text-violet-400" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
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

        {/* ═══ Dashboard Tab ═══ */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            {compliance && (
              <div className="grid grid-cols-6 gap-4">
                {[
                  { label: "Compliant", value: compliance.compliant, icon: ShieldCheck, color: "green" },
                  { label: "Over-licensed", value: compliance.overLicensed ?? compliance.over_licensed ?? 0, icon: TrendingDown, color: "blue" },
                  { label: "Under-licensed", value: compliance.underLicensed ?? compliance.under_licensed ?? 0, icon: ShieldAlert, color: "red" },
                  { label: "Untracked", value: compliance.untracked, icon: ShieldX, color: "zinc" },
                  { label: "Total Cost", value: formatCurrency(compliance.totalCost ?? compliance.total_cost ?? 0), icon: DollarSign, color: "amber" },
                  { label: "Potential Savings", value: formatCurrency(compliance.potentialSavings ?? compliance.potential_savings ?? 0), icon: TrendingDown, color: "emerald" },
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

            {dashboard && (
              <div className="grid grid-cols-2 gap-6">
                {/* Top Installed */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <Package className="h-4 w-4 text-violet-400" />
                    <span className="text-sm font-semibold">Top Installed Software</span>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {(dashboard.top_installed || []).slice(0, 10).map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2">
                        <div>
                          <span className="text-sm text-zinc-200">{s.name}</span>
                          <span className="text-xs text-zinc-600 ml-2">{s.publisher}</span>
                        </div>
                        <span className="text-sm font-mono text-violet-400">{s.count || s.nodeCount} nodes</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cost by Category */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-semibold">Cost by Category</span>
                  </div>
                  <div className="p-4 space-y-3">
                    {(dashboard.cost_by_category || []).map((c, i) => {
                      const maxCost = Math.max(...(dashboard.cost_by_category || []).map((x) => x.cost), 1);
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-zinc-300">{c.category}</span>
                            <span className="text-zinc-400">{formatCurrency(c.cost)}</span>
                          </div>
                          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${(c.cost / maxCost) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {(!dashboard.cost_by_category || dashboard.cost_by_category.length === 0) && (
                      <p className="text-sm text-zinc-600 text-center py-4">No license costs tracked yet</p>
                    )}
                  </div>
                </div>

                {/* Reclamation Candidates */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-semibold">Unused Software (Reclaim Candidates)</span>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {(dashboard.top_unused || []).slice(0, 8).map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2">
                        <span className="text-sm text-zinc-200">{s.name}</span>
                        <div className="text-right">
                          <span className="text-xs text-red-400">{s.days_unused}d unused</span>
                          <span className="text-xs text-zinc-600 ml-2">{s.node_count} nodes</span>
                        </div>
                      </div>
                    ))}
                    {(!dashboard.top_unused || dashboard.top_unused.length === 0) && (
                      <p className="text-sm text-zinc-600 text-center py-4">No usage data yet — agents need to report</p>
                    )}
                  </div>
                </div>

                {/* Recent Changes */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-cyan-400" />
                    <span className="text-sm font-semibold">Recent Software Changes</span>
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {(dashboard.recent_changes || []).slice(0, 8).map((c, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2">
                        <div>
                          <span className={`text-xs px-1.5 py-0.5 rounded mr-2 ${c.change_type === "install" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                            {c.change_type}
                          </span>
                          <span className="text-sm text-zinc-200">{c.name}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-zinc-500">{c.node}</span>
                          <span className="text-xs text-zinc-600 ml-2">{new Date(c.date).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                    {(!dashboard.recent_changes || dashboard.recent_changes.length === 0) && (
                      <p className="text-sm text-zinc-600 text-center py-4">No recent changes detected</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
              </div>
            )}
          </div>
        )}

        {/* ═══ Catalog Tab ═══ */}
        {activeTab === "catalog" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search software..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-zinc-200"
                />
              </div>
              <button onClick={autoDiscover} disabled={loading} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Auto-Discover
              </button>
              <button onClick={() => { setShowCatalogForm(true); setEditingCatalog(null); setCatalogForm({ canonical_name: "", publisher: "", category: "Other", notes: "" }); }} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2.5 rounded-lg text-sm">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            {/* Catalog Form */}
            {showCatalogForm && (
              <div className="bg-zinc-900 border border-violet-500/30 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold">{editingCatalog ? "Edit" : "New"} Catalog Entry</h3>
                <div className="grid grid-cols-4 gap-3">
                  <input type="text" placeholder="Software Name" value={catalogForm.canonical_name} onChange={(e) => setCatalogForm({ ...catalogForm, canonical_name: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="text" placeholder="Publisher" value={catalogForm.publisher} onChange={(e) => setCatalogForm({ ...catalogForm, publisher: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <select value={catalogForm.category} onChange={(e) => setCatalogForm({ ...catalogForm, category: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type="text" placeholder="Notes" value={catalogForm.notes} onChange={(e) => setCatalogForm({ ...catalogForm, notes: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveCatalog} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded text-sm">Save</button>
                  <button onClick={() => setShowCatalogForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                </div>
              </div>
            )}

            {/* Catalog Table */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-800/50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs text-zinc-400 font-medium">Software</th>
                      <th className="px-4 py-2.5 text-left text-xs text-zinc-400 font-medium">Publisher</th>
                      <th className="px-4 py-2.5 text-left text-xs text-zinc-400 font-medium">Category</th>
                      <th className="px-4 py-2.5 text-center text-xs text-zinc-400 font-medium">Installed</th>
                      <th className="px-4 py-2.5 text-center text-xs text-zinc-400 font-medium">Licensed</th>
                      <th className="px-4 py-2.5 text-center text-xs text-zinc-400 font-medium">Compliance</th>
                      <th className="px-4 py-2.5 text-right text-xs text-zinc-400 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {filteredCatalog.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-800/30">
                        <td className="px-4 py-2.5 text-zinc-200 font-medium">{catName(c)}</td>
                        <td className="px-4 py-2.5 text-zinc-400">{c.publisher || "—"}</td>
                        <td className="px-4 py-2.5"><span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{c.category}</span></td>
                        <td className="px-4 py-2.5 text-center font-mono">{catNodes(c) ?? "—"}</td>
                        <td className="px-4 py-2.5 text-center font-mono">{catLicenses(c) ?? "—"}</td>
                        <td className="px-4 py-2.5 text-center">{complianceBadge(catCompliance(c))}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => { setEditingCatalog(c); setCatalogForm({ canonical_name: catName(c), publisher: c.publisher || "", category: c.category, notes: c.notes || "" }); setShowCatalogForm(true); }} className="text-zinc-500 hover:text-zinc-300 p-1"><Edit className="h-3.5 w-3.5" /></button>
                          <button onClick={() => deleteCatalog(c.id)} className="text-zinc-500 hover:text-red-400 p-1 ml-1"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredCatalog.length === 0 && (
                <div className="py-12 text-center">
                  <Package className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500">No software in catalog yet</p>
                  <p className="text-xs text-zinc-600 mt-1">Click "Auto-Discover" to populate from inventory</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ Licenses Tab ═══ */}
        {activeTab === "licenses" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowLicenseForm(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                <Plus className="h-4 w-4" /> Add License
              </button>
            </div>

            {showLicenseForm && (
              <div className="bg-zinc-900 border border-violet-500/30 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold">New License</h3>
                <div className="grid grid-cols-3 gap-3">
                  <select value={licenseForm.catalog_id} onChange={(e) => setLicenseForm({ ...licenseForm, catalog_id: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Select software...</option>
                    {(Array.isArray(catalog) ? catalog : []).map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
                  </select>
                  <select value={licenseForm.license_type} onChange={(e) => setLicenseForm({ ...licenseForm, license_type: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    {LICENSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input type="number" placeholder="Total licenses" value={licenseForm.total_licenses} onChange={(e) => setLicenseForm({ ...licenseForm, total_licenses: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="number" step="0.01" placeholder="Cost per license" value={licenseForm.cost_per_license} onChange={(e) => setLicenseForm({ ...licenseForm, cost_per_license: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="text" placeholder="Vendor" value={licenseForm.vendor} onChange={(e) => setLicenseForm({ ...licenseForm, vendor: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="text" placeholder="Contract ID" value={licenseForm.contract_id} onChange={(e) => setLicenseForm({ ...licenseForm, contract_id: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="date" placeholder="Expires" value={licenseForm.expires_at} onChange={(e) => setLicenseForm({ ...licenseForm, expires_at: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <input type="text" placeholder="Notes" value={licenseForm.notes} onChange={(e) => setLicenseForm({ ...licenseForm, notes: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 col-span-2" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveLicense} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded text-sm">Save</button>
                  <button onClick={() => setShowLicenseForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                </div>
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Software</th>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Type</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Licenses</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Installed</th>
                    <th className="px-4 py-2.5 text-right text-xs text-zinc-400">Cost</th>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Vendor</th>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Expires</th>
                    <th className="px-4 py-2.5 text-right text-xs text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {licenses.map((l) => (
                    <tr key={l.id} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-2.5 text-zinc-200">{l.catalog_name || l.catalog_id}</td>
                      <td className="px-4 py-2.5"><span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{l.license_type}</span></td>
                      <td className="px-4 py-2.5 text-center font-mono">{l.total_licenses ?? "∞"}</td>
                      <td className="px-4 py-2.5 text-center font-mono">{l.installed_count ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(l.cost_per_license, l.currency)}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{l.vendor || "—"}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => deleteLicense(l.id)} className="text-zinc-500 hover:text-red-400 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {licenses.length === 0 && (
                <div className="py-12 text-center">
                  <FileText className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500">No licenses defined yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ Normalization Rules Tab ═══ */}
        {activeTab === "rules" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowRuleForm(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                <Plus className="h-4 w-4" /> Add Rule
              </button>
            </div>

            {showRuleForm && (
              <div className="bg-zinc-900 border border-violet-500/30 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-semibold">New Normalization Rule</h3>
                <p className="text-xs text-zinc-500">Map software name patterns to catalog entries. Use % as wildcard for LIKE patterns.</p>
                <div className="grid grid-cols-4 gap-3">
                  <input type="text" placeholder="Pattern (e.g. %Chrome%)" value={ruleForm.pattern} onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                  <select value={ruleForm.match_type} onChange={(e) => setRuleForm({ ...ruleForm, match_type: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="like">LIKE (% wildcard)</option>
                    <option value="regex">Regex</option>
                    <option value="exact">Exact Match</option>
                  </select>
                  <select value={ruleForm.catalog_id} onChange={(e) => setRuleForm({ ...ruleForm, catalog_id: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                    <option value="">Map to catalog entry...</option>
                    {(Array.isArray(catalog) ? catalog : []).map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
                  </select>
                  <input type="number" placeholder="Priority" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveRule} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded text-sm">Save</button>
                  <button onClick={testRule} className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded text-sm"><TestTube className="h-3.5 w-3.5" />Test</button>
                  <button onClick={() => { setShowRuleForm(false); setRuleTestResult(null); }} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                </div>
                {ruleTestResult && (
                  <div className="bg-zinc-800 rounded p-3 mt-2">
                    <p className="text-xs text-zinc-400 mb-2">Matches ({ruleTestResult.length}):</p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {ruleTestResult.map((m, i) => <div key={i} className="text-xs text-zinc-300 font-mono">{m}</div>)}
                      {ruleTestResult.length === 0 && <p className="text-xs text-zinc-600">No matches found</p>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Pattern</th>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Type</th>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Maps To</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Priority</th>
                    <th className="px-4 py-2.5 text-right text-xs text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {rules.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-2.5 font-mono text-cyan-400">{r.pattern}</td>
                      <td className="px-4 py-2.5"><span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{r.match_type}</span></td>
                      <td className="px-4 py-2.5 text-zinc-200">{r.catalog_name || r.catalog_id}</td>
                      <td className="px-4 py-2.5 text-center font-mono">{r.priority}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => deleteRule(r.id)} className="text-zinc-500 hover:text-red-400 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rules.length === 0 && (
                <div className="py-12 text-center">
                  <Wand2 className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500">No normalization rules yet</p>
                  <p className="text-xs text-zinc-600 mt-1">Rules map software variants (e.g. "Google Chrome", "Chrome") to a single catalog entry</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ Reclamation Tab ═══ */}
        {activeTab === "usage" && (
          <div className="space-y-4">
            <div className="bg-zinc-900 border border-amber-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-5 w-5 text-amber-400" />
                <h2 className="text-lg font-semibold">License Reclamation</h2>
              </div>
              <p className="text-xs text-zinc-500">Software installed but unused for 90+ days. Reclaim these licenses to save costs.</p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Software</th>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Node</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Days Unused</th>
                    <th className="px-4 py-2.5 text-right text-xs text-zinc-400">License Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {reclaimCandidates.map((r, i) => (
                    <tr key={i} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-2.5 text-zinc-200">{r.catalog_name || r.software_name}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{r.node_hostname}</td>
                      <td className="px-4 py-2.5 text-center"><span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">{r.days_unused}d</span></td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(r.license_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reclaimCandidates.length === 0 && (
                <div className="py-12 text-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500/30 mx-auto mb-3" />
                  <p className="text-zinc-500">No reclamation candidates found</p>
                  <p className="text-xs text-zinc-600 mt-1">All tracked software appears to be in use</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ True-Up Report Tab ═══ */}
        {activeTab === "reports" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">True-Up Report</h2>
              <button onClick={() => {
                if (!trueUp) return;
                const csv = ["Software,Purchased,Installed,Used,Status,Cost"].concat(
                  trueUp.map((r: any) => `"${r.name}",${r.purchased},${r.installed},${r.used},${r.status},${r.total_cost}`)
                ).join("\n");
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `true-up-${Date.now()}.csv`; a.click();
              }} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-sm">
                <Download className="h-4 w-4" /> Export CSV
              </button>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs text-zinc-400">Software</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Purchased</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Installed</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Used</th>
                    <th className="px-4 py-2.5 text-center text-xs text-zinc-400">Status</th>
                    <th className="px-4 py-2.5 text-right text-xs text-zinc-400">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {(trueUp || []).map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-zinc-800/30">
                      <td className="px-4 py-2.5 text-zinc-200 font-medium">{r.name}</td>
                      <td className="px-4 py-2.5 text-center font-mono">{r.purchased ?? "∞"}</td>
                      <td className="px-4 py-2.5 text-center font-mono">{r.installed}</td>
                      <td className="px-4 py-2.5 text-center font-mono">{r.used ?? "—"}</td>
                      <td className="px-4 py-2.5 text-center">{complianceBadge(r.status)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(r.total_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!trueUp || trueUp.length === 0) && (
                <div className="py-12 text-center">
                  <PieChart className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-500">No licensed software to report on</p>
                  <p className="text-xs text-zinc-600 mt-1">Add licenses in the Licenses tab first</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
