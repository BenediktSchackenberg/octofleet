"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────────────

export interface SchemaTable {
  name: string;
  description: string;
  columns: SchemaColumn[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  description: string;
}

export interface SchemaCategory {
  name: string;
  icon: string;
  tables: SchemaTable[];
}

export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  query: QueryDSL;
}

export interface WhereClause {
  field: string;
  op: string;
  value: string | number | string[];
}

export interface QueryDSL {
  from: string;
  join?: string;
  select?: string[];
  where?: WhereClause[];
  groupBy?: string[];
  orderBy?: { field: string; dir?: string }[];
  limit?: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  query?: string;
}

export interface LiveResult {
  nodeId: string;
  hostname: string;
  data: Record<string, unknown>[];
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  query_dsl: QueryDSL;
  is_public: boolean;
  run_count: number;
  avg_runtime_ms: number;
  last_run?: string;
  created_at: string;
}

export interface ScheduleEntry {
  id: string;
  name: string;
  saved_query_id: string;
  saved_query_name?: string;
  cron_expression: string;
  cron_human?: string;
  output_format: string;
  enabled: boolean;
  next_run?: string;
  last_run?: string;
  status: string;
}

export interface ScheduleResult {
  id: string;
  ran_at: string;
  status: string;
  row_count: number;
  runtime_ms: number;
}

export interface DashboardMeta {
  id: string;
  name: string;
  description: string;
  widget_count?: number;
}

export interface DashboardWidget {
  id: string;
  saved_query_id: string;
  title: string;
  visualization: string;
  position: number;
  config?: Record<string, unknown>;
  data?: QueryResult;
}

export interface Dashboard extends DashboardMeta {
  widgets: DashboardWidget[];
}

export interface HistoryEntry {
  id: string;
  query_dsl: QueryDSL;
  sql?: string;
  status: string;
  runtime_ms: number;
  row_count: number;
  created_at: string;
}

export interface QueryStats {
  total_queries: number;
  avg_runtime_ms: number;
  queries_today: number;
  top_table: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

export const OP_LABELS: Record<string, string> = {
  "=": "equals",
  "!=": "not equals",
  ">": "greater than",
  "<": "less than",
  ">=": "≥",
  "<=": "≤",
  like: "contains",
  in: "in list",
  is_null: "is empty",
  is_not_null: "is not empty",
};

export const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily (midnight)", value: "0 0 * * *" },
  { label: "Weekly (Mon)", value: "0 0 * * 1" },
  { label: "Monthly (1st)", value: "0 0 1 * *" },
];

export function cronToHuman(cron: string): string {
  const map: Record<string, string> = {
    "0 * * * *": "Every hour",
    "0 */6 * * *": "Every 6 hours",
    "0 0 * * *": "Daily at midnight",
    "0 0 * * 1": "Weekly on Monday",
    "0 0 1 * *": "Monthly on the 1st",
  };
  return map[cron] || cron;
}

export function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export type TabId = "builder" | "live" | "templates" | "history" | "saved" | "schedules" | "dashboards";

// ─── Hook ────────────────────────────────────────────────────────────

export function useQueryEngine() {
  // Schema
  const [schema, setSchema] = useState<SchemaCategory[]>([]);
  const [templates, setTemplates] = useState<QueryTemplate[]>([]);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  // Query builder
  const [selectedTable, setSelectedTable] = useState("nodes");
  const [selectedJoin, setSelectedJoin] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [whereClauses, setWhereClauses] = useState<WhereClause[]>([]);
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState("ASC");
  const [limit, setLimit] = useState(100);
  const [groupBy, setGroupBy] = useState("");

  // Results
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live query
  const [liveMode, setLiveMode] = useState(false);
  const [liveCommand, setLiveCommand] = useState("processes");
  const [liveResults, setLiveResults] = useState<LiveResult[]>([]);
  const [liveRunning, setLiveRunning] = useState(false);

  // History (local fallback)
  const [history, setHistory] = useState<{ query: QueryDSL; time: string; ms: number; rows: number }[]>([]);

  // Tab
  const [activeTab, setActiveTab] = useState<TabId>("builder");

  // Stats
  const [stats, setStats] = useState<QueryStats | null>(null);

  // Saved queries
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [savedSearch, setSavedSearch] = useState("");
  const [savedCategoryFilter, setSavedCategoryFilter] = useState("");
  const [savedLoading, setSavedLoading] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveForm, setSaveForm] = useState({ name: "", description: "", category: "", tags: "", is_public: true });
  const [savedRunResult, setSavedRunResult] = useState<{ id: string; result: QueryResult } | null>(null);
  const [editingSaved, setEditingSaved] = useState<SavedQuery | null>(null);

  // Schedules
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ saved_query_id: "", name: "", cron_expression: "0 0 * * *", output_format: "JSON" });
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null);
  const [scheduleResults, setScheduleResults] = useState<Record<string, ScheduleResult[]>>({});

  // Dashboards
  const [dashboards, setDashboards] = useState<DashboardMeta[]>([]);
  const [selectedDashboard, setSelectedDashboard] = useState<Dashboard | null>(null);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [showDashboardForm, setShowDashboardForm] = useState(false);
  const [dashboardForm, setDashboardForm] = useState({ name: "", description: "" });
  const [showWidgetForm, setShowWidgetForm] = useState(false);
  const [widgetForm, setWidgetForm] = useState({ saved_query_id: "", title: "", visualization: "table", position: 0 });
  const [editingDashboard, setEditingDashboard] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);

  // History (backend)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistorySql, setExpandedHistorySql] = useState<string | null>(null);

  // ─── Fetch schema & templates ────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [schemaRes, templateRes] = await Promise.all([
          apiClient.get(`/query/schema`, { showErrorToast: false }),
          apiClient.get(`/query/templates`, { showErrorToast: false }),
        ]);
        if (schemaRes.ok) {
          const s = await schemaRes.json();
          const catIcons: Record<string, string> = {
            Fleet: "🖥️", Software: "📦", Security: "🔒", System: "⚙️",
            Monitoring: "📡", Compliance: "📏", Operations: "🔧",
          };
          const cats = s.categories;
          if (cats && typeof cats === "object" && !Array.isArray(cats)) {
            const arr: SchemaCategory[] = Object.entries(cats).map(([name, tables]) => ({
              name,
              icon: catIcons[name] || "📁",
              tables: (tables as SchemaTable[]),
            }));
            setSchema(arr);
          } else if (Array.isArray(cats)) {
            setSchema(cats);
          }
        }
        if (templateRes.ok) {
          const t = await templateRes.json();
          setTemplates(t.templates || []);
        }
      } catch (err) {
        console.error("Failed to load schema/templates", err);
      }
    }
    load();
  }, []);

  // Fetch stats
  useEffect(() => {
    async function loadStats() {
      try {
        const res = await apiClient.get(`/query/stats`, { showErrorToast: false });
        if (res.ok) setStats(await res.json());
      } catch {}
    }
    loadStats();
  }, [activeTab]);

  // Get all columns for the selected table
  const tableColumns = schema
    .flatMap((c) => c.tables)
    .find((t) => t.name === selectedTable)?.columns || [];

  const joinTableColumns = selectedJoin
    ? schema.flatMap((c) => c.tables).find((t) => t.name === selectedJoin)?.columns || []
    : [];

  const allColumns = [
    ...tableColumns.map((c) => ({ ...c, table: selectedTable })),
    ...joinTableColumns.map((c) => ({ ...c, table: selectedJoin })),
  ];

  // ─── Execute Query ───────────────────────────────────────────────

  const buildCurrentDSL = useCallback((): QueryDSL => ({
    from: selectedTable,
    ...(selectedJoin && { join: selectedJoin }),
    ...(selectedColumns.length > 0 && { select: selectedColumns }),
    ...(whereClauses.length > 0 && { where: whereClauses }),
    ...(groupBy && { groupBy: groupBy.split(",").map((s) => s.trim()) }),
    ...(orderBy && { orderBy: [{ field: orderBy, dir: orderDir }] }),
    limit,
  }), [selectedTable, selectedJoin, selectedColumns, whereClauses, groupBy, orderBy, orderDir, limit]);

  const executeQuery = useCallback(
    async (dsl?: QueryDSL) => {
      setLoading(true);
      setError(null);

      const query: QueryDSL = dsl || buildCurrentDSL();

      try {
        const res = await apiClient.post(`/query/execute`, query, { showErrorToast: false });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data: QueryResult = await res.json();
        setResult(data);

        setHistory((prev) => [
          { query, time: new Date().toLocaleTimeString(), ms: data.executionMs, rows: data.rowCount },
          ...prev.slice(0, 49),
        ]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [buildCurrentDSL]
  );

  // ─── Live Query via SSE ──────────────────────────────────────────

  const executeLiveQuery = useCallback(async () => {
    setLiveRunning(true);
    setLiveResults([]);
    setError(null);

    try {
      const res = await apiClient.post(`/query/live`, { command: liveCommand }, { showErrorToast: false });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "result") {
                  setLiveResults((prev) => [...prev, data]);
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLiveRunning(false);
    }
  }, [liveCommand]);

  // ─── Load template ───────────────────────────────────────────────

  const loadTemplate = (t: QueryTemplate) => {
    setSelectedTable(t.query.from);
    setSelectedJoin(t.query.join || "");
    setSelectedColumns(t.query.select || []);
    setWhereClauses(t.query.where || []);
    setGroupBy(t.query.groupBy?.join(", ") || "");
    setOrderBy(t.query.orderBy?.[0]?.field || "");
    setOrderDir(t.query.orderBy?.[0]?.dir || "ASC");
    setLimit(t.query.limit || 100);
    setActiveTab("builder");
  };

  const loadDSLIntoBuilder = (dsl: QueryDSL) => {
    setSelectedTable(dsl.from);
    setSelectedJoin(dsl.join || "");
    setSelectedColumns(dsl.select || []);
    setWhereClauses(dsl.where || []);
    setGroupBy(dsl.groupBy?.join(", ") || "");
    setOrderBy(dsl.orderBy?.[0]?.field || "");
    setOrderDir(dsl.orderBy?.[0]?.dir || "ASC");
    setLimit(dsl.limit || 100);
    setActiveTab("builder");
  };

  // ─── Add / remove where clause ──────────────────────────────────

  const addWhere = () => {
    setWhereClauses([...whereClauses, { field: tableColumns[0]?.name || "", op: "=", value: "" }]);
  };

  const removeWhere = (idx: number) => {
    setWhereClauses(whereClauses.filter((_, i) => i !== idx));
  };

  const updateWhere = (idx: number, patch: Partial<WhereClause>) => {
    setWhereClauses(whereClauses.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  };

  // ─── Export CSV ──────────────────────────────────────────────────

  const exportCsv = () => {
    if (!result) return;
    const header = result.columns.join(",");
    const rows = result.rows.map((r) =>
      result.columns.map((c) => {
        const val = r[c];
        const str = val === null || val === undefined ? "" : String(val);
        return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Copy JSON ───────────────────────────────────────────────────

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result.rows, null, 2));
  };

  // ─── Saved Queries API ──────────────────────────────────────────

  const fetchSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const params = new URLSearchParams();
      if (savedCategoryFilter) params.set("category", savedCategoryFilter);
      if (savedSearch) params.set("tags", savedSearch);
      const res = await apiClient.get(`/query/saved?${params}`, { showErrorToast: false });
      if (res.ok) {
        const data = await res.json();
        setSavedQueries(Array.isArray(data) ? data : data.queries || []);
      }
    } catch {} finally { setSavedLoading(false); }
  }, [savedCategoryFilter, savedSearch]);

  useEffect(() => { if (activeTab === "saved") fetchSaved(); }, [activeTab, fetchSaved]);

  const saveCurrent = async () => {
    try {
      const body = {
        name: saveForm.name,
        description: saveForm.description,
        query_dsl: buildCurrentDSL(),
        category: saveForm.category,
        tags: saveForm.tags.split(",").map(t => t.trim()).filter(Boolean),
        is_public: saveForm.is_public,
      };
      const res = await apiClient.post(`/query/saved`, body, { showErrorToast: false });
      if (res.ok) {
        setShowSaveForm(false);
        setSaveForm({ name: "", description: "", category: "", tags: "", is_public: true });
        fetchSaved();
      }
    } catch {}
  };

  const deleteSaved = async (id: string) => {
    try {
      await apiClient.delete(`/query/saved/${id}`, { showErrorToast: false });
      fetchSaved();
    } catch {}
  };

  const duplicateSaved = async (id: string) => {
    try {
      await apiClient.post(`/query/saved/${id}/duplicate`, {}, { showErrorToast: false });
      fetchSaved();
    } catch {}
  };

  const runSaved = async (sq: SavedQuery) => {
    try {
      const res = await apiClient.post(`/query/saved/${sq.id}/run`, {}, { showErrorToast: false });
      if (res.ok) {
        const data = await res.json();
        setSavedRunResult({ id: sq.id, result: data });
      }
    } catch {}
  };

  const togglePublic = async (sq: SavedQuery) => {
    try {
      await apiClient.put(`/query/saved/${sq.id}`, { is_public: !sq.is_public }, { showErrorToast: false });
      fetchSaved();
    } catch {}
  };

  const updateSavedQuery = async (sq: SavedQuery) => {
    try {
      await apiClient.put(`/query/saved/${sq.id}`, { name: sq.name, description: sq.description, category: sq.category, tags: sq.tags }, { showErrorToast: false });
      setEditingSaved(null);
      fetchSaved();
    } catch {}
  };

  // ─── Schedules API ──────────────────────────────────────────────

  const fetchSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    try {
      const res = await apiClient.get(`/query/schedules`, { showErrorToast: false });
      if (res.ok) {
        const data = await res.json();
        setSchedules(Array.isArray(data) ? data : data.schedules || []);
      }
    } catch {} finally { setSchedulesLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "schedules") fetchSchedules(); }, [activeTab, fetchSchedules]);

  const createSchedule = async () => {
    try {
      const res = await apiClient.post(`/query/schedules`, scheduleForm, { showErrorToast: false });
      if (res.ok) {
        setShowScheduleForm(false);
        setScheduleForm({ saved_query_id: "", name: "", cron_expression: "0 0 * * *", output_format: "JSON" });
        fetchSchedules();
      }
    } catch {}
  };

  const deleteSchedule = async (id: string) => {
    try {
      await apiClient.delete(`/query/schedules/${id}`, { showErrorToast: false });
      fetchSchedules();
    } catch {}
  };

  const toggleSchedule = async (s: ScheduleEntry) => {
    try {
      await apiClient.put(`/query/schedules/${s.id}`, { enabled: !s.enabled }, { showErrorToast: false });
      fetchSchedules();
    } catch {}
  };

  const runScheduleNow = async (id: string) => {
    try {
      await apiClient.post(`/query/schedules/${id}/run-now`, {}, { showErrorToast: false });
      fetchSchedules();
    } catch {}
  };

  const fetchScheduleResults = async (id: string) => {
    try {
      const res = await apiClient.get(`/query/schedules/${id}/results`, { showErrorToast: false });
      if (res.ok) {
        const data = await res.json();
        setScheduleResults(prev => ({ ...prev, [id]: Array.isArray(data) ? data : data.results || [] }));
      }
    } catch {}
  };

  // ─── Dashboards API ─────────────────────────────────────────────

  const fetchDashboards = useCallback(async () => {
    setDashboardsLoading(true);
    try {
      const res = await apiClient.get(`/query/dashboards`, { showErrorToast: false });
      if (res.ok) {
        const data = await res.json();
        setDashboards(Array.isArray(data) ? data : data.dashboards || []);
      }
    } catch {} finally { setDashboardsLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "dashboards") fetchDashboards(); }, [activeTab, fetchDashboards]);

  const loadDashboardById = async (id: string) => {
    try {
      const res = await apiClient.get(`/query/dashboards/${id}`, { showErrorToast: false });
      if (res.ok) setSelectedDashboard(await res.json());
    } catch {}
  };

  const createDashboard = async () => {
    try {
      const res = await apiClient.post(`/query/dashboards`, dashboardForm, { showErrorToast: false });
      if (res.ok) {
        setShowDashboardForm(false);
        setDashboardForm({ name: "", description: "" });
        fetchDashboards();
        const d = await res.json();
        if (d.id) loadDashboardById(d.id);
      }
    } catch {}
  };

  const deleteDashboard = async (id: string) => {
    try {
      await apiClient.delete(`/query/dashboards/${id}`, { showErrorToast: false });
      setSelectedDashboard(null);
      fetchDashboards();
    } catch {}
  };

  const updateDashboard = async () => {
    if (!selectedDashboard) return;
    try {
      await apiClient.put(`/query/dashboards/${selectedDashboard.id}`, { name: selectedDashboard.name, description: selectedDashboard.description }, { showErrorToast: false });
      setEditingDashboard(false);
      fetchDashboards();
    } catch {}
  };

  const addWidget = async () => {
    if (!selectedDashboard) return;
    try {
      const res = await apiClient.post(`/query/dashboards/${selectedDashboard.id}/widgets`, widgetForm, { showErrorToast: false });
      if (res.ok) {
        setShowWidgetForm(false);
        setWidgetForm({ saved_query_id: "", title: "", visualization: "table", position: 0 });
        loadDashboardById(selectedDashboard.id);
      }
    } catch {}
  };

  const removeWidget = async (wid: string) => {
    if (!selectedDashboard) return;
    try {
      await apiClient.delete(`/query/dashboards/${selectedDashboard.id}/widgets/${wid}`, { showErrorToast: false });
      loadDashboardById(selectedDashboard.id);
    } catch {}
  };

  const updateWidgetFn = async (w: DashboardWidget) => {
    if (!selectedDashboard) return;
    try {
      await apiClient.put(`/query/dashboards/${selectedDashboard.id}/widgets/${w.id}`, { title: w.title, visualization: w.visualization, saved_query_id: w.saved_query_id }, { showErrorToast: false });
      setEditingWidget(null);
      loadDashboardById(selectedDashboard.id);
    } catch {}
  };

  // ─── History API ────────────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get(`/query/history?limit=50`, { showErrorToast: false });
      if (res.ok) {
        const data = await res.json();
        setHistoryEntries(Array.isArray(data) ? data : data.history || []);
      }
    } catch {} finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "history") fetchHistory(); }, [activeTab, fetchHistory]);

  const clearHistory = async () => {
    try {
      await apiClient.delete(`/query/history`, { showErrorToast: false });
      setHistoryEntries([]);
    } catch {}
  };

  const saveHistoryAsSaved = async (entry: HistoryEntry) => {
    try {
      const res = await apiClient.post(`/query/saved`, {
        name: `Query from ${new Date(entry.created_at).toLocaleString()}`,
        description: "",
        query_dsl: entry.query_dsl,
        category: "",
        tags: [],
        is_public: false,
      }, { showErrorToast: false });
      if (res.ok) setError(null);
    } catch {}
  };

  return {
    // Schema
    schema, templates, expandedCat, setExpandedCat, expandedTable, setExpandedTable,
    // Query builder
    selectedTable, setSelectedTable, selectedJoin, setSelectedJoin,
    selectedColumns, setSelectedColumns, whereClauses, setWhereClauses,
    orderBy, setOrderBy, orderDir, setOrderDir, limit, setLimit,
    groupBy, setGroupBy,
    // Results
    result, loading, error, setError,
    // Live query
    liveMode, setLiveMode, liveCommand, setLiveCommand,
    liveResults, liveRunning, executeLiveQuery,
    // History (local)
    history,
    // Tab
    activeTab, setActiveTab,
    // Stats
    stats,
    // Columns
    tableColumns, joinTableColumns, allColumns,
    // Actions
    buildCurrentDSL, executeQuery, loadTemplate, loadDSLIntoBuilder,
    addWhere, removeWhere, updateWhere,
    exportCsv, copyJson,
    // Saved queries
    savedQueries, savedSearch, setSavedSearch,
    savedCategoryFilter, setSavedCategoryFilter,
    savedLoading, showSaveForm, setShowSaveForm,
    saveForm, setSaveForm, savedRunResult, setSavedRunResult,
    editingSaved, setEditingSaved,
    fetchSaved, saveCurrent, deleteSaved, duplicateSaved,
    runSaved, togglePublic, updateSavedQuery,
    // Schedules
    schedules, schedulesLoading, showScheduleForm, setShowScheduleForm,
    scheduleForm, setScheduleForm, expandedSchedule, setExpandedSchedule,
    scheduleResults,
    createSchedule, deleteSchedule, toggleSchedule, runScheduleNow, fetchScheduleResults,
    // Dashboards
    dashboards, selectedDashboard, setSelectedDashboard,
    dashboardsLoading, showDashboardForm, setShowDashboardForm,
    dashboardForm, setDashboardForm, showWidgetForm, setShowWidgetForm,
    widgetForm, setWidgetForm, editingDashboard, setEditingDashboard,
    editingWidget, setEditingWidget,
    createDashboard, deleteDashboard, updateDashboard,
    addWidget, removeWidget, updateWidget: updateWidgetFn,
    loadDashboard: loadDashboardById,
    // History (backend)
    historyEntries, historyLoading, expandedHistorySql, setExpandedHistorySql,
    clearHistory, saveHistoryAsSaved,
  };
}
