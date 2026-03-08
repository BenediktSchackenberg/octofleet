"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient, ApiResponse } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────────────

export interface TrueUpEntry {
  name: string;
  purchased: number | null;
  installed: number;
  used: number | null;
  status: string;
  total_cost: number;
}

export interface CatalogEntry {
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
  license_count?: number;
  licensed_count?: number;
  totalLicenses?: number | null;
  total_licenses?: number | null;
  complianceStatus?: string;
  compliance_status?: string;
}

export interface License {
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

export interface NormRule {
  id: number;
  pattern: string;
  match_type: string;
  catalog_id: string;
  catalog_name?: string;
  priority: number;
  match_count?: number;
}

export interface ComplianceSummary {
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

export interface DashboardData {
  top_installed: { name: string; count: number; nodeCount?: number; publisher: string }[];
  top_unused: { name: string; node_count: number; days_unused: number }[];
  compliance_summary: ComplianceSummary;
  cost_by_category: { category: string; cost: number }[];
  recent_changes: { name: string; change_type: string; node: string; date: string }[];
}

export interface ReclaimCandidate {
  software_name: string;
  catalog_name: string;
  node_hostname: string;
  node_id: string;
  last_used: string | null;
  days_unused: number;
  license_cost: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

export const CATEGORIES = ["Productivity", "Development", "Security", "System", "Communication", "Browser", "Media", "Other"];
export const LICENSE_TYPES = [
  { value: "per_device", label: "Per Device" },
  { value: "per_user", label: "Per User" },
  { value: "site", label: "Site License" },
  { value: "unlimited", label: "Unlimited" },
  { value: "subscription", label: "Subscription" },
];

export function complianceBadge(status?: string) {
  return status; // badge rendering moved to page component
}

export function formatCurrency(amount: number | null, currency = "EUR") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
}

export function catName(c: CatalogEntry): string { return c.canonicalName || c.canonical_name || ""; }
export function catNodes(c: CatalogEntry): number | undefined { return c.nodeCount ?? c.node_count ?? c.installedCount ?? c.installed_count; }
export function catLicenses(c: CatalogEntry): number | undefined { return c.licenseCount ?? c.license_count ?? c.licensed_count ?? c.totalLicenses ?? c.total_licenses ?? undefined; }
export function catCompliance(c: CatalogEntry): string | undefined { return c.complianceStatus || c.compliance_status; }

// ─── Hook ────────────────────────────────────────────────────────────

export type MeteringTab = "dashboard" | "catalog" | "licenses" | "rules" | "usage" | "reports";

export function useMetering() {
  const [activeTab, setActiveTab] = useState<MeteringTab>("dashboard");
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
  const [trueUp, setTrueUp] = useState<TrueUpEntry[] | null>(null);

  // ─── API helpers ─────────────────────────────────────────────────

  const api = useCallback(async <T = unknown>(path: string, opts?: { method?: string; body?: Record<string, unknown> }): Promise<ApiResponse<T>> => {
    const endpoint = `/metering${path}`;
    const method = (opts?.method || 'GET').toUpperCase();
    if (method === 'POST') {
      return apiClient.richPost<T>(endpoint, opts?.body ?? {});
    } else if (method === 'PUT') {
      // No richPut available, wrap put result
      try {
        const data = await apiClient.put<T>(endpoint, opts?.body ?? {}, { showErrorToast: false });
        return { ok: data !== null, data, error: data === null ? `API request failed: PUT ${endpoint}` : null, status: data !== null ? 200 : 0 };
      } catch (e) {
        return { ok: false, data: null, error: e instanceof Error ? e.message : String(e), status: 0 };
      }
    } else if (method === 'DELETE') {
      try {
        const data = await apiClient.delete<T>(endpoint, { showErrorToast: false });
        return { ok: true, data, error: null, status: 200 };
      } catch (e) {
        return { ok: false, data: null, error: e instanceof Error ? e.message : String(e), status: 0 };
      }
    } else {
      return apiClient.richGet<T>(endpoint);
    }
  }, []);

  // ─── Loaders ─────────────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      interface DashboardResponse {
        topInstalled?: DashboardData["top_installed"]; top_installed?: DashboardData["top_installed"];
        topUnused?: DashboardData["top_unused"]; top_unused?: DashboardData["top_unused"];
        compliance?: ComplianceSummary; compliance_summary?: ComplianceSummary;
        costByCategory?: Record<string, number> | { category: string; cost: number }[];
        cost_by_category?: Record<string, number> | { category: string; cost: number }[];
        recentChanges?: DashboardData["recent_changes"]; recent_changes?: DashboardData["recent_changes"];
      }
      const [dashRes, compRes] = await Promise.all([
        api<DashboardResponse>("/dashboard"),
        api<ComplianceSummary>("/compliance"),
      ]);
      if (dashRes.ok && dashRes.data && compRes.ok && compRes.data) {
        const dash = dashRes.data;
        const comp = compRes.data;
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
      } else {
        setError(dashRes.error || compRes.error || "Failed to load dashboard");
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [api]);

  const loadCatalog = useCallback(async () => {
    const res = await api<{ catalog?: CatalogEntry[]; items?: CatalogEntry[] }>("/catalog");
    if (res.ok && res.data) {
      const d = res.data;
      setCatalog(d.catalog || d.items || (Array.isArray(d) ? d as unknown as CatalogEntry[] : []));
    } else if (res.error) { setError(res.error); }
  }, [api]);

  const loadLicenses = useCallback(async () => {
    const res = await api<{ licenses?: License[]; items?: License[] }>("/licenses");
    if (res.ok && res.data) {
      const d = res.data;
      setLicenses(d.licenses || d.items || (Array.isArray(d) ? d as unknown as License[] : []));
    } else if (res.error) { setError(res.error); }
  }, [api]);

  const loadRules = useCallback(async () => {
    const res = await api<{ rules?: NormRule[]; items?: NormRule[] }>("/rules");
    if (res.ok && res.data) {
      const d = res.data;
      setRules(d.rules || d.items || (Array.isArray(d) ? d as unknown as NormRule[] : []));
    } else if (res.error) { setError(res.error); }
  }, [api]);

  const loadReclaim = useCallback(async () => {
    const res = await api<{ candidates?: ReclaimCandidate[]; items?: ReclaimCandidate[] }>("/usage/reclaim");
    if (res.ok && res.data) {
      const d = res.data;
      setReclaimCandidates(d.candidates || d.items || (Array.isArray(d) ? d as unknown as ReclaimCandidate[] : []));
    } else if (res.error) { setError(res.error); }
  }, [api]);

  const loadTrueUp = useCallback(async () => {
    const res = await api<{ report?: TrueUpEntry[]; items?: TrueUpEntry[] }>("/reports/true-up");
    if (res.ok && res.data) {
      const d = res.data;
      setTrueUp(d.report || d.items || (Array.isArray(d) ? d as unknown as TrueUpEntry[] : []));
    } else if (res.error) { setError(res.error); }
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
    const body = { canonicalName: catalogForm.canonical_name, publisher: catalogForm.publisher, category: catalogForm.category, notes: catalogForm.notes };
    const res = editingCatalog
      ? await api(`/catalog/${editingCatalog.id}`, { method: "PUT", body: body as unknown as Record<string, unknown> })
      : await api("/catalog", { method: "POST", body: body as unknown as Record<string, unknown> });
    if (res.ok) {
      setShowCatalogForm(false);
      setEditingCatalog(null);
      setCatalogForm({ canonical_name: "", publisher: "", category: "Other", notes: "" });
      loadCatalog();
    } else if (res.error) { setError(res.error); }
  };

  const deleteCatalog = async (id: string) => {
    if (!confirm("Delete this catalog entry and all associated licenses/rules?")) return;
    const res = await api(`/catalog/${id}`, { method: "DELETE" });
    if (res.ok) { loadCatalog(); } else if (res.error) { setError(res.error); }
  };

  const autoDiscover = async () => {
    setLoading(true);
    const res = await api<{ created?: number }>("/catalog/auto-discover", { method: "POST" });
    if (res.ok && res.data) {
      setError(null);
      loadCatalog();
      alert(`Auto-discovered ${res.data.created || 0} new software entries!`);
    } else if (res.error) { setError(res.error); }
    setLoading(false);
  };

  const saveLicense = async () => {
    const res = await api("/licenses", {
      method: "POST",
      body: {
        ...licenseForm,
        total_licenses: licenseForm.total_licenses ? parseInt(licenseForm.total_licenses) : null,
        cost_per_license: licenseForm.cost_per_license ? parseFloat(licenseForm.cost_per_license) : null,
        expires_at: licenseForm.expires_at || null,
      } as unknown as Record<string, unknown>,
    });
    if (res.ok) {
      setShowLicenseForm(false);
      setLicenseForm({ catalog_id: "", license_type: "per_device", total_licenses: "", cost_per_license: "", currency: "EUR", vendor: "", contract_id: "", expires_at: "", notes: "" });
      loadLicenses();
    } else if (res.error) { setError(res.error); }
  };

  const deleteLicense = async (id: string) => {
    if (!confirm("Delete this license?")) return;
    const res = await api(`/licenses/${id}`, { method: "DELETE" });
    if (res.ok) { loadLicenses(); } else if (res.error) { setError(res.error); }
  };

  const saveRule = async () => {
    const res = await api("/rules", {
      method: "POST",
      body: { ...ruleForm, priority: parseInt(ruleForm.priority) || 0 } as unknown as Record<string, unknown>,
    });
    if (res.ok) {
      setShowRuleForm(false);
      setRuleForm({ pattern: "", match_type: "like", catalog_id: "", priority: "0" });
      loadRules();
    } else if (res.error) { setError(res.error); }
  };

  const testRule = async () => {
    const res = await api<{ matches?: string[] }>("/rules/test", {
      method: "POST",
      body: { pattern: ruleForm.pattern, match_type: ruleForm.match_type },
    });
    if (res.ok && res.data) {
      setRuleTestResult(res.data.matches || []);
    } else if (res.error) { setError(res.error); }
  };

  const deleteRule = async (id: number) => {
    const res = await api(`/rules/${id}`, { method: "DELETE" });
    if (res.ok) { loadRules(); } else if (res.error) { setError(res.error); }
  };

  // Filtered catalog
  const filteredCatalog = (Array.isArray(catalog) ? catalog : []).filter((c) =>
    !catalogSearch || catName(c).toLowerCase().includes(catalogSearch.toLowerCase()) || (c.publisher || "").toLowerCase().includes(catalogSearch.toLowerCase())
  );

  // CSV export for true-up
  const exportTrueUpCsv = () => {
    if (!trueUp) return;
    const csv = ["Software,Purchased,Installed,Used,Status,Cost"].concat(
      trueUp.map((r: TrueUpEntry) => `"${r.name}",${r.purchased},${r.installed},${r.used},${r.status},${r.total_cost}`)
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `true-up-${Date.now()}.csv`; a.click();
  };

  return {
    // Tab
    activeTab, setActiveTab,
    // State
    loading, error, setError,
    // Dashboard
    dashboard, compliance,
    // Catalog
    catalog, catalogSearch, setCatalogSearch, showCatalogForm, setShowCatalogForm,
    editingCatalog, setEditingCatalog, catalogForm, setCatalogForm, filteredCatalog,
    // Licenses
    licenses, showLicenseForm, setShowLicenseForm, licenseForm, setLicenseForm,
    // Rules
    rules, showRuleForm, setShowRuleForm, ruleForm, setRuleForm, ruleTestResult, setRuleTestResult,
    // Usage
    reclaimCandidates,
    // Reports
    trueUp,
    // Actions
    loadDashboard, loadCatalog, loadLicenses, loadRules,
    saveCatalog, deleteCatalog, autoDiscover,
    saveLicense, deleteLicense,
    saveRule, testRule, deleteRule,
    exportTrueUpCsv,
  };
}
