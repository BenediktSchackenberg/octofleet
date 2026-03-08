"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

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

  const api = useCallback(async (path: string, opts?: RequestInit) => {
    const endpoint = `/metering${path}`;
    const method = (opts?.method || 'GET').toUpperCase();
    const reqOpts = { showErrorToast: false };
    let data: unknown;
    if (method === 'POST') {
      data = await apiClient.post(endpoint, opts?.body ? JSON.parse(opts.body as string) : {}, reqOpts);
    } else if (method === 'PUT') {
      data = await apiClient.put(endpoint, opts?.body ? JSON.parse(opts.body as string) : {}, reqOpts);
    } else if (method === 'DELETE') {
      data = await apiClient.delete(endpoint, reqOpts);
    } else {
      data = await apiClient.get(endpoint, reqOpts);
    }
    if (data === null) {
      throw new Error(`API request failed: ${method} ${endpoint}`);
    }
    return data;
  }, []);

  // ─── Loaders ─────────────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, comp] = await Promise.all([
        api("/dashboard"),
        api("/compliance"),
      ]);
      setDashboard({
        top_installed: (dash as any).topInstalled || (dash as any).top_installed || [],
        top_unused: (dash as any).topUnused || (dash as any).top_unused || [],
        compliance_summary: (dash as any).compliance || (dash as any).compliance_summary || comp,
        cost_by_category: (() => {
          const raw = (dash as any).costByCategory || (dash as any).cost_by_category || {};
          if (Array.isArray(raw)) return raw;
          return Object.entries(raw).map(([category, cost]) => ({ category, cost: cost as number }));
        })(),
        recent_changes: (dash as any).recentChanges || (dash as any).recent_changes || [],
      });
      setCompliance(comp as ComplianceSummary);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [api]);

  const loadCatalog = useCallback(async () => {
    try { const res: any = await api("/catalog"); setCatalog(res.catalog || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadLicenses = useCallback(async () => {
    try { const res: any = await api("/licenses"); setLicenses(res.licenses || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadRules = useCallback(async () => {
    try { const res: any = await api("/rules"); setRules(res.rules || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadReclaim = useCallback(async () => {
    try { const res: any = await api("/usage/reclaim"); setReclaimCandidates(res.candidates || res.items || (Array.isArray(res) ? res : [])); } catch {}
  }, [api]);

  const loadTrueUp = useCallback(async () => {
    try { const res: any = await api("/reports/true-up"); setTrueUp(res.report || res.items || (Array.isArray(res) ? res : [])); } catch {}
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
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const deleteCatalog = async (id: string) => {
    if (!confirm("Delete this catalog entry and all associated licenses/rules?")) return;
    try { await api(`/catalog/${id}`, { method: "DELETE" }); loadCatalog(); } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const autoDiscover = async () => {
    setLoading(true);
    try {
      const res: any = await api("/catalog/auto-discover", { method: "POST" });
      setError(null);
      loadCatalog();
      alert(`Auto-discovered ${res.created || 0} new software entries!`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
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
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const deleteLicense = async (id: string) => {
    if (!confirm("Delete this license?")) return;
    try { await api(`/licenses/${id}`, { method: "DELETE" }); loadLicenses(); } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
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
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const testRule = async () => {
    try {
      const res: any = await api("/rules/test", {
        method: "POST",
        body: JSON.stringify({ pattern: ruleForm.pattern, match_type: ruleForm.match_type }),
      });
      setRuleTestResult(res.matches || []);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const deleteRule = async (id: number) => {
    try { await api(`/rules/${id}`, { method: "DELETE" }); loadRules(); } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
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
