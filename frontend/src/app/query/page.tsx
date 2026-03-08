"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import {
  Search,
  Play,
  Clock,
  Database,
  Table2,
  ChevronDown,
  ChevronRight,
  Bookmark,
  Zap,
  Download,
  Copy,
  Terminal,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Wifi,
  X,
  Filter,
  BarChart3,
  Settings2,
  Save,
  Calendar,
  LayoutDashboard,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Plus,
  ToggleLeft,
  ToggleRight,
  Hash,
  List,
  PieChart,
  TrendingUp,
  Activity,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

interface SchemaTable {
  name: string;
  description: string;
  columns: SchemaColumn[];
}

interface SchemaColumn {
  name: string;
  type: string;
  description: string;
}

interface SchemaCategory {
  name: string;
  icon: string;
  tables: SchemaTable[];
}

interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  query: QueryDSL;
}

interface WhereClause {
  field: string;
  op: string;
  value: string | number | string[];
}

interface QueryDSL {
  from: string;
  join?: string;
  select?: string[];
  where?: WhereClause[];
  groupBy?: string[];
  orderBy?: { field: string; dir?: string }[];
  limit?: number;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  query?: string;
}

interface LiveResult {
  nodeId: string;
  hostname: string;
  data: Record<string, unknown>[];
  error?: string;
}

interface SavedQuery {
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

interface ScheduleEntry {
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

interface ScheduleResult {
  id: string;
  ran_at: string;
  status: string;
  row_count: number;
  runtime_ms: number;
}

interface DashboardMeta {
  id: string;
  name: string;
  description: string;
  widget_count?: number;
}

interface DashboardWidget {
  id: string;
  saved_query_id: string;
  title: string;
  visualization: string;
  position: number;
  config?: Record<string, unknown>;
  data?: QueryResult;
}

interface Dashboard extends DashboardMeta {
  widgets: DashboardWidget[];
}

interface HistoryEntry {
  id: string;
  query_dsl: QueryDSL;
  sql?: string;
  status: string;
  runtime_ms: number;
  row_count: number;
  created_at: string;
}

interface QueryStats {
  total_queries: number;
  avg_runtime_ms: number;
  queries_today: number;
  top_table: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const OP_LABELS: Record<string, string> = {
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

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily (midnight)", value: "0 0 * * *" },
  { label: "Weekly (Mon)", value: "0 0 * * 1" },
  { label: "Monthly (1st)", value: "0 0 1 * *" },
];

function cronToHuman(cron: string): string {
  const map: Record<string, string> = {
    "0 * * * *": "Every hour",
    "0 */6 * * *": "Every 6 hours",
    "0 0 * * *": "Daily at midnight",
    "0 0 * * 1": "Weekly on Monday",
    "0 0 1 * *": "Monthly on the 1st",
  };
  return map[cron] || cron;
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

type TabId = "builder" | "live" | "templates" | "history" | "saved" | "schedules" | "dashboards";

// ─── Component ───────────────────────────────────────────────────────

export default function QueryEnginePage() {
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

  const loadDashboard = async (id: string) => {
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
        if (d.id) loadDashboard(d.id);
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
        loadDashboard(selectedDashboard.id);
      }
    } catch {}
  };

  const removeWidget = async (wid: string) => {
    if (!selectedDashboard) return;
    try {
      await apiClient.delete(`/query/dashboards/${selectedDashboard.id}/widgets/${wid}`, { showErrorToast: false });
      loadDashboard(selectedDashboard.id);
    } catch {}
  };

  const updateWidget = async (w: DashboardWidget) => {
    if (!selectedDashboard) return;
    try {
      await apiClient.put(`/query/dashboards/${selectedDashboard.id}/widgets/${w.id}`, { title: w.title, visualization: w.visualization, saved_query_id: w.saved_query_id }, { showErrorToast: false });
      setEditingWidget(null);
      loadDashboard(selectedDashboard.id);
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

  // ─── Widget Renderer ────────────────────────────────────────────

  const renderWidgetContent = (w: DashboardWidget) => {
    const data = w.data;
    if (!data || !data.rows || data.rows.length === 0) {
      return <div className="text-zinc-600 text-sm text-center py-8">No data</div>;
    }
    const cols = data.columns || Object.keys(data.rows[0]);

    switch (w.visualization) {
      case "number": {
        const val = data.rows[0][cols[0]];
        return (
          <div className="flex items-center justify-center py-6">
            <span className="text-5xl font-bold text-cyan-400">{String(val ?? "—")}</span>
          </div>
        );
      }
      case "bar": {
        const labelCol = cols[0];
        const valCol = cols[1] || cols[0];
        const maxVal = Math.max(...data.rows.map(r => Number(r[valCol]) || 0), 1);
        return (
          <div className="space-y-2 py-2">
            {data.rows.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-zinc-400 w-32 truncate">{String(r[labelCol] ?? "")}</span>
                <div className="flex-1 bg-zinc-800 rounded-full h-4 overflow-hidden">
                  <div className="bg-cyan-500/60 h-full rounded-full" style={{ width: `${(Number(r[valCol]) || 0) / maxVal * 100}%` }} />
                </div>
                <span className="text-xs text-zinc-500 w-16 text-right">{String(r[valCol] ?? "")}</span>
              </div>
            ))}
          </div>
        );
      }
      case "list": {
        const col = cols[0];
        return (
          <ul className="space-y-1 py-2">
            {data.rows.slice(0, 20).map((r, i) => (
              <li key={i} className="text-sm text-zinc-300 flex items-center gap-2">
                <span className="text-cyan-500">•</span>
                {String(r[col] ?? "—")}
              </li>
            ))}
          </ul>
        );
      }
      case "pie":
      case "line":
        return (
          <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">
            <TrendingUp className="h-5 w-5 mr-2" />
            Chart visualization coming soon
          </div>
        );
      case "table":
      default:
        return (
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-zinc-800/50 sticky top-0">
                <tr>
                  {cols.map(c => <th key={c} className="px-2 py-1.5 text-left text-zinc-500 font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/30">
                {data.rows.slice(0, 25).map((r, i) => (
                  <tr key={i} className="hover:bg-zinc-800/20">
                    {cols.map(c => (
                      <td key={c} className="px-2 py-1 text-zinc-400 font-mono truncate max-w-[200px]">{String(r[c] ?? "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  };

  const vizIcon = (v: string) => {
    switch (v) {
      case "number": return <Hash className="h-3.5 w-3.5" />;
      case "bar": return <BarChart3 className="h-3.5 w-3.5" />;
      case "list": return <List className="h-3.5 w-3.5" />;
      case "pie": return <PieChart className="h-3.5 w-3.5" />;
      case "line": return <TrendingUp className="h-3.5 w-3.5" />;
      default: return <Table2 className="h-3.5 w-3.5" />;
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  const categories = [...new Set(savedQueries.map(s => s.category).filter(Boolean))];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-[1600px] mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Terminal className="h-8 w-8 text-cyan-400" />
              Query Engine
            </h1>
            <p className="text-zinc-400 mt-1">Real-time fleet queries — like CMPivot, but cooler</p>
          </div>
          <div className="flex gap-2">
            {result && (
              <span className="text-xs text-zinc-500 self-center mr-4">
                {result.rowCount} rows in {result.executionMs}ms
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-zinc-900 rounded-lg p-1 w-fit">
          {(
            [
              { id: "builder" as TabId, label: "Query Builder", icon: Database },
              { id: "live" as TabId, label: "Live Query", icon: Wifi },
              { id: "templates" as TabId, label: "Templates", icon: Bookmark },
              { id: "history" as TabId, label: "History", icon: Clock },
              { id: "saved" as TabId, label: "Saved", icon: Save },
              { id: "schedules" as TabId, label: "Schedules", icon: Calendar },
              { id: "dashboards" as TabId, label: "Dashboards", icon: LayoutDashboard },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Stats Bar */}
        {stats && (
          <div className="flex gap-6 mb-6 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-zinc-500">Total queries:</span>
              <span className="text-zinc-200 font-semibold">{stats.total_queries.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-zinc-500">Avg runtime:</span>
              <span className="text-zinc-200 font-semibold">{stats.avg_runtime_ms}ms</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Zap className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-zinc-500">Today:</span>
              <span className="text-zinc-200 font-semibold">{stats.queries_today}</span>
            </div>
            {stats.top_table && (
              <div className="flex items-center gap-2 text-xs">
                <Table2 className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-zinc-500">Top table:</span>
                <span className="text-zinc-200 font-semibold">{stats.top_table}</span>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* ─── Left Sidebar: Schema Browser ──────────────────── */}
          <div className="col-span-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-semibold">Schema Browser</span>
              </div>
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {schema.map((cat) => (
                  <div key={cat.name}>
                    <button
                      onClick={() => setExpandedCat(expandedCat === cat.name ? null : cat.name)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-sm text-left"
                    >
                      {expandedCat === cat.name ? (
                        <ChevronDown className="h-3 w-3 text-zinc-500" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-zinc-500" />
                      )}
                      <span className="text-zinc-300 font-medium">{cat.icon} {cat.name}</span>
                      <span className="text-zinc-600 text-xs ml-auto">{cat.tables.length}</span>
                    </button>
                    {expandedCat === cat.name &&
                      cat.tables.map((table) => (
                        <div key={table.name}>
                          <button
                            onClick={() => {
                              setExpandedTable(expandedTable === table.name ? null : table.name);
                              setSelectedTable(table.name);
                            }}
                            className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-zinc-800 text-xs text-left ${
                              selectedTable === table.name ? "bg-cyan-500/10 text-cyan-400" : "text-zinc-400"
                            }`}
                          >
                            <Table2 className="h-3 w-3" />
                            {table.name}
                          </button>
                          {expandedTable === table.name && (
                            <div className="pl-12 pr-3 py-1 space-y-0.5">
                              {table.columns.map((col) => (
                                <div
                                  key={col.name}
                                  className="flex items-center gap-2 text-xs text-zinc-500 py-0.5 cursor-pointer hover:text-zinc-300"
                                  onClick={() => {
                                    if (!selectedColumns.includes(col.name)) {
                                      setSelectedColumns([...selectedColumns, col.name]);
                                    }
                                  }}
                                  title={col.description}
                                >
                                  <span className="text-cyan-600 font-mono text-[10px] w-12 truncate">{col.type}</span>
                                  <span>{col.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Main Content ──────────────────────────────────── */}
          <div className="col-span-9 space-y-4">
            {/* Builder Tab */}
            {activeTab === "builder" && (
              <>
                {/* Query Builder Card */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4">
                  {/* Table + Join */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">FROM</label>
                      <select
                        value={selectedTable}
                        onChange={(e) => {
                          setSelectedTable(e.target.value);
                          setSelectedColumns([]);
                          setWhereClauses([]);
                        }}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      >
                        {schema
                          .flatMap((c) => c.tables)
                          .map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">JOIN (optional)</label>
                      <select
                        value={selectedJoin}
                        onChange={(e) => setSelectedJoin(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      >
                        <option value="">No join</option>
                        {schema
                          .flatMap((c) => c.tables)
                          .filter((t) => t.name !== selectedTable)
                          .map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">LIMIT</label>
                      <select
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      >
                        {[10, 25, 50, 100, 250, 500, 1000, 5000, 10000].map((n) => (
                          <option key={n} value={n}>
                            {n} rows
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Selected Columns */}
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">SELECT (click columns in schema or leave empty for *)</label>
                    <div className="flex flex-wrap gap-1.5 min-h-[32px] bg-zinc-800 rounded p-2">
                      {selectedColumns.length === 0 && (
                        <span className="text-xs text-zinc-600 italic">All columns (*)</span>
                      )}
                      {selectedColumns.map((col) => (
                        <span
                          key={col}
                          className="flex items-center gap-1 bg-cyan-500/20 text-cyan-400 text-xs px-2 py-0.5 rounded"
                        >
                          {col}
                          <X
                            className="h-3 w-3 cursor-pointer hover:text-red-400"
                            onClick={() => setSelectedColumns(selectedColumns.filter((c) => c !== col))}
                          />
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Where Clauses */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-zinc-500">WHERE</label>
                      <button
                        onClick={addWhere}
                        className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                      >
                        <Filter className="h-3 w-3" /> Add filter
                      </button>
                    </div>
                    {whereClauses.map((w, i) => (
                      <div key={i} className="flex gap-2 mb-2">
                        <select
                          value={w.field}
                          onChange={(e) => updateWhere(i, { field: e.target.value })}
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 flex-1"
                        >
                          {allColumns.map((c) => (
                            <option key={`${c.table}.${c.name}`} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={w.op}
                          onChange={(e) => updateWhere(i, { op: e.target.value })}
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 w-32"
                        >
                          {Object.entries(OP_LABELS).map(([op, label]) => (
                            <option key={op} value={op}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {w.op !== "is_null" && w.op !== "is_not_null" && (
                          <input
                            type="text"
                            value={String(w.value)}
                            onChange={(e) => updateWhere(i, { value: e.target.value })}
                            placeholder="Value..."
                            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 flex-1"
                          />
                        )}
                        <button
                          onClick={() => removeWhere(i)}
                          className="text-zinc-600 hover:text-red-400 p-1"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Order + Group */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">ORDER BY</label>
                      <select
                        value={orderBy}
                        onChange={(e) => setOrderBy(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      >
                        <option value="">None</option>
                        {allColumns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">Direction</label>
                      <select
                        value={orderDir}
                        onChange={(e) => setOrderDir(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      >
                        <option value="ASC">Ascending</option>
                        <option value="DESC">Descending</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 mb-1 block">GROUP BY</label>
                      <input
                        type="text"
                        value={groupBy}
                        onChange={(e) => setGroupBy(e.target.value)}
                        placeholder="e.g. os_name, os_version"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      />
                    </div>
                  </div>

                  {/* Execute Button */}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => executeQuery()}
                      disabled={loading}
                      className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Execute Query
                    </button>
                    <button
                      onClick={() => setShowSaveForm(true)}
                      className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-sm transition-colors"
                    >
                      <Save className="h-4 w-4" /> Save Query
                    </button>
                    {result && (
                      <>
                        <button
                          onClick={exportCsv}
                          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-sm transition-colors"
                        >
                          <Download className="h-4 w-4" /> CSV
                        </button>
                        <button
                          onClick={copyJson}
                          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-lg text-sm transition-colors"
                        >
                          <Copy className="h-4 w-4" /> JSON
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Save Form Modal */}
                {showSaveForm && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-200">Save Current Query</h3>
                      <button onClick={() => setShowSaveForm(false)} className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>
                    </div>
                    <input
                      type="text"
                      placeholder="Query name"
                      value={saveForm.name}
                      onChange={(e) => setSaveForm({ ...saveForm, name: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={saveForm.description}
                      onChange={(e) => setSaveForm({ ...saveForm, description: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Category"
                        value={saveForm.category}
                        onChange={(e) => setSaveForm({ ...saveForm, category: e.target.value })}
                        className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      />
                      <input
                        type="text"
                        placeholder="Tags (comma-separated)"
                        value={saveForm.tags}
                        onChange={(e) => setSaveForm({ ...saveForm, tags: e.target.value })}
                        className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSaveForm({ ...saveForm, is_public: !saveForm.is_public })} className="text-zinc-400 hover:text-zinc-200">
                        {saveForm.is_public ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <span className="text-xs text-zinc-500">{saveForm.is_public ? "Public" : "Private"}</span>
                    </div>
                    <button
                      onClick={saveCurrent}
                      disabled={!saveForm.name}
                      className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Save
                    </button>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
                    <span className="text-red-400 text-sm">{error}</span>
                  </div>
                )}

                {/* Results Table */}
                {result && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                        <span className="text-sm text-zinc-300">
                          <strong>{result.rowCount}</strong> rows returned
                        </span>
                        <span className="text-xs text-zinc-600">
                          {result.executionMs}ms
                        </span>
                      </div>
                      {result.query && (
                        <code className="text-xs text-zinc-600 font-mono max-w-xl truncate block">
                          {result.query}
                        </code>
                      )}
                    </div>
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-800/50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs text-zinc-500 font-medium w-10">#</th>
                            {result.columns.map((col) => (
                              <th
                                key={col}
                                className="px-3 py-2 text-left text-xs text-zinc-400 font-medium cursor-pointer hover:text-cyan-400"
                                onClick={() => {
                                  setOrderBy(col);
                                  setOrderDir(orderDir === "ASC" ? "DESC" : "ASC");
                                }}
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                          {result.rows.map((row, i) => (
                            <tr key={i} className="hover:bg-zinc-800/30">
                              <td className="px-3 py-1.5 text-xs text-zinc-600">{i + 1}</td>
                              {result.columns.map((col) => {
                                const val = row[col];
                                const display =
                                  val === null || val === undefined
                                    ? "—"
                                    : typeof val === "object"
                                    ? JSON.stringify(val)
                                    : String(val);
                                return (
                                  <td
                                    key={col}
                                    className="px-3 py-1.5 text-xs text-zinc-300 font-mono max-w-xs truncate"
                                    title={display}
                                  >
                                    {val === null || val === undefined ? (
                                      <span className="text-zinc-600 italic">null</span>
                                    ) : typeof val === "boolean" ? (
                                      <span className={val ? "text-green-400" : "text-red-400"}>
                                        {val ? "true" : "false"}
                                      </span>
                                    ) : (
                                      display.length > 80 ? display.slice(0, 80) + "…" : display
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Live Query Tab */}
            {activeTab === "live" && (
              <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="h-5 w-5 text-yellow-400" />
                    <h2 className="text-lg font-semibold">Live Agent Query</h2>
                    <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Beta</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-4">
                    Query all online agents in real-time. Results stream in as each agent responds.
                  </p>
                  <div className="flex gap-3">
                    <select
                      value={liveCommand}
                      onChange={(e) => setLiveCommand(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200"
                    >
                      <option value="processes">Running Processes</option>
                      <option value="services">Windows Services</option>
                      <option value="ports">Open Ports</option>
                      <option value="env">Environment Variables</option>
                      <option value="files">Recent Files</option>
                      <option value="hotfixes">Installed Hotfixes</option>
                    </select>
                    <button
                      onClick={executeLiveQuery}
                      disabled={liveRunning}
                      className="flex items-center gap-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 text-white px-5 py-2 rounded-lg font-medium transition-colors"
                    >
                      {liveRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wifi className="h-4 w-4" />
                      )}
                      Query Fleet
                    </button>
                  </div>
                </div>

                {/* Live Results */}
                {liveResults.length > 0 && (
                  <div className="space-y-3">
                    {liveResults.map((lr, i) => (
                      <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${lr.error ? "bg-red-500" : "bg-green-500"}`} />
                          <span className="text-sm font-medium text-zinc-300">{lr.hostname}</span>
                          <span className="text-xs text-zinc-600">{lr.nodeId}</span>
                          {lr.error && <span className="text-xs text-red-400 ml-auto">{lr.error}</span>}
                        </div>
                        {lr.data && lr.data.length > 0 && (
                          <div className="overflow-x-auto max-h-48">
                            <table className="w-full text-xs">
                              <thead className="bg-zinc-800/50">
                                <tr>
                                  {Object.keys(lr.data[0]).map((k) => (
                                    <th key={k} className="px-3 py-1.5 text-left text-zinc-500 font-medium">
                                      {k}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {lr.data.slice(0, 25).map((row, j) => (
                                  <tr key={j} className="border-t border-zinc-800/30">
                                    {Object.values(row).map((v, k) => (
                                      <td key={k} className="px-3 py-1 text-zinc-400 font-mono">
                                        {String(v ?? "—")}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {liveRunning && (
                  <div className="flex items-center gap-3 text-zinc-400 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
                    Waiting for agent responses...
                  </div>
                )}

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <span className="text-red-400 text-sm">{error}</span>
                  </div>
                )}
              </div>
            )}

            {/* Templates Tab */}
            {activeTab === "templates" && (
              <div className="grid grid-cols-2 gap-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => loadTemplate(t)}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-left hover:border-cyan-500/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-cyan-400 transition-colors">
                        {t.name}
                      </h3>
                      <span className="text-[10px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded">
                        {t.category}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">{t.description}</p>
                    <div className="mt-2 text-[10px] font-mono text-zinc-600">
                      FROM {t.query.from}
                      {t.query.join && ` JOIN ${t.query.join}`}
                      {t.query.where && ` WHERE (${t.query.where.length} filters)`}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* ─── History Tab (Enhanced) ──────────────────────── */}
            {activeTab === "history" && (
              <div className="space-y-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-300">Query History</h3>
                    <div className="flex gap-2">
                      {historyLoading && <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />}
                      <button onClick={clearHistory} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                        <Trash2 className="h-3 w-3" /> Clear
                      </button>
                    </div>
                  </div>
                  {historyEntries.length === 0 && !historyLoading ? (
                    <div className="p-8 text-center text-zinc-600 text-sm">
                      No queries in history yet. Execute a query to see it here!
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-800/50">
                      {historyEntries.map((h) => (
                        <div key={h.id} className="px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                h.status === "success" ? "bg-green-500/20 text-green-400" :
                                h.status === "error" ? "bg-red-500/20 text-red-400" :
                                "bg-zinc-500/20 text-zinc-400"
                              }`}>{h.status}</span>
                              <code className="text-xs font-mono text-zinc-400 truncate">
                                FROM {h.query_dsl.from}
                                {h.query_dsl.join && ` JOIN ${h.query_dsl.join}`}
                                {h.query_dsl.where && ` WHERE (${h.query_dsl.where.length} filters)`}
                                {h.query_dsl.select && ` SELECT ${h.query_dsl.select.length} cols`}
                              </code>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-zinc-600 flex-shrink-0 ml-4">
                              <span>{h.row_count} rows</span>
                              <span>{h.runtime_ms}ms</span>
                              <span>{formatTime(h.created_at)}</span>
                              <button
                                onClick={() => loadDSLIntoBuilder(h.query_dsl)}
                                className="text-cyan-500 hover:text-cyan-400 flex items-center gap-1"
                                title="Re-run in Builder"
                              >
                                <Play className="h-3 w-3" /> Re-run
                              </button>
                              <button
                                onClick={() => saveHistoryAsSaved(h)}
                                className="text-cyan-500 hover:text-cyan-400 flex items-center gap-1"
                                title="Save as"
                              >
                                <Save className="h-3 w-3" /> Save
                              </button>
                            </div>
                          </div>
                          {/* Expandable SQL */}
                          {h.sql && (
                            <div className="mt-1">
                              <button
                                onClick={() => setExpandedHistorySql(expandedHistorySql === h.id ? null : h.id)}
                                className="text-[10px] text-zinc-600 hover:text-zinc-400 flex items-center gap-1"
                              >
                                {expandedHistorySql === h.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                SQL
                              </button>
                              {expandedHistorySql === h.id && (
                                <pre className="mt-1 text-[10px] font-mono text-zinc-500 bg-zinc-800 rounded p-2 overflow-x-auto">{h.sql}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Saved Tab ───────────────────────────────────── */}
            {activeTab === "saved" && (
              <div className="space-y-4">
                {/* Search + Filter */}
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search saved queries..."
                      value={savedSearch}
                      onChange={(e) => setSavedSearch(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2.5 text-sm text-zinc-200"
                    />
                  </div>
                  <select
                    value={savedCategoryFilter}
                    onChange={(e) => setSavedCategoryFilter(e.target.value)}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-200"
                  >
                    <option value="">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <button
                    onClick={() => { setShowSaveForm(true); setActiveTab("builder"); }}
                    className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium"
                  >
                    <Plus className="h-4 w-4" /> Save Current Query
                  </button>
                </div>

                {savedLoading && (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>
                )}

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savedQueries.filter(sq =>
                    !savedSearch || sq.name.toLowerCase().includes(savedSearch.toLowerCase()) ||
                    sq.tags.some(t => t.toLowerCase().includes(savedSearch.toLowerCase()))
                  ).map((sq) => (
                    <div key={sq.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="cursor-pointer flex-1" onClick={() => loadDSLIntoBuilder(sq.query_dsl)}>
                          <h3 className="text-sm font-semibold text-zinc-200 hover:text-cyan-400 transition-colors">{sq.name}</h3>
                          {sq.description && <p className="text-xs text-zinc-500 mt-0.5">{sq.description}</p>}
                        </div>
                        <button onClick={() => togglePublic(sq)} className="text-zinc-500 hover:text-zinc-300 ml-2" title={sq.is_public ? "Public" : "Private"}>
                          {sq.is_public ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {sq.category && <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded text-xs">{sq.category}</span>}
                        {sq.tags.map(t => <span key={t} className="bg-zinc-500/20 text-zinc-400 px-2 py-0.5 rounded text-xs">{t}</span>)}
                      </div>
                      <div className="flex items-center gap-4 text-[10px] text-zinc-600 mb-3">
                        <span>▶ {sq.run_count} runs</span>
                        <span>⏱ {sq.avg_runtime_ms}ms avg</span>
                        {sq.last_run && <span>Last: {formatTime(sq.last_run)}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => runSaved(sq)} className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded text-xs font-medium">
                          <Play className="h-3 w-3" /> Run
                        </button>
                        <button onClick={() => setEditingSaved(sq)} className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs">
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button onClick={() => duplicateSaved(sq.id)} className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs">
                          <Copy className="h-3 w-3" /> Duplicate
                        </button>
                        <button onClick={() => deleteSaved(sq.id)} className="flex items-center gap-1 bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400 px-3 py-1.5 rounded text-xs">
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Edit modal */}
                {editingSaved && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingSaved(null)}>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md space-y-3" onClick={e => e.stopPropagation()}>
                      <h3 className="text-sm font-semibold text-zinc-200">Edit Saved Query</h3>
                      <input type="text" value={editingSaved.name} onChange={e => setEditingSaved({ ...editingSaved, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                      <input type="text" value={editingSaved.description} onChange={e => setEditingSaved({ ...editingSaved, description: e.target.value })} placeholder="Description" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                      <input type="text" value={editingSaved.category} onChange={e => setEditingSaved({ ...editingSaved, category: e.target.value })} placeholder="Category" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                      <div className="flex gap-2">
                        <button onClick={() => updateSavedQuery(editingSaved)} className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded text-sm">Save</button>
                        <button onClick={() => setEditingSaved(null)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm">Cancel</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Run result slide-out */}
                {savedRunResult && (
                  <div className="fixed inset-y-0 right-0 w-[600px] bg-zinc-900 border-l border-zinc-800 shadow-2xl z-50 overflow-y-auto">
                    <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                        <span className="text-sm text-zinc-300"><strong>{savedRunResult.result.rowCount}</strong> rows in {savedRunResult.result.executionMs}ms</span>
                      </div>
                      <button onClick={() => setSavedRunResult(null)} className="text-zinc-500 hover:text-zinc-300"><X className="h-5 w-5" /></button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-zinc-800/50 sticky top-0">
                          <tr>{savedRunResult.result.columns.map(c => <th key={c} className="px-3 py-2 text-left text-zinc-500 font-medium">{c}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/30">
                          {savedRunResult.result.rows.map((r, i) => (
                            <tr key={i} className="hover:bg-zinc-800/20">
                              {savedRunResult.result.columns.map(c => (
                                <td key={c} className="px-3 py-1.5 text-zinc-400 font-mono truncate max-w-[200px]">{String(r[c] ?? "—")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── Schedules Tab ───────────────────────────────── */}
            {activeTab === "schedules" && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-zinc-200 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-cyan-400" /> Scheduled Queries
                  </h2>
                  <button onClick={() => setShowScheduleForm(!showScheduleForm)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                    <Plus className="h-4 w-4" /> Create Schedule
                  </button>
                </div>

                {showScheduleForm && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-zinc-200">New Schedule</h3>
                    <input type="text" placeholder="Schedule name" value={scheduleForm.name} onChange={e => setScheduleForm({ ...scheduleForm, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                    <select value={scheduleForm.saved_query_id} onChange={e => setScheduleForm({ ...scheduleForm, saved_query_id: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                      <option value="">Select saved query...</option>
                      {savedQueries.map(sq => <option key={sq.id} value={sq.id}>{sq.name}</option>)}
                    </select>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">Schedule</label>
                        <select value={scheduleForm.cron_expression} onChange={e => setScheduleForm({ ...scheduleForm, cron_expression: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                          {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-zinc-500 mb-1 block">Output Format</label>
                        <select value={scheduleForm.output_format} onChange={e => setScheduleForm({ ...scheduleForm, output_format: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                          <option value="JSON">JSON</option>
                          <option value="CSV">CSV</option>
                          <option value="Email">Email</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={createSchedule} disabled={!scheduleForm.name || !scheduleForm.saved_query_id} className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Create</button>
                      <button onClick={() => setShowScheduleForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-sm">Cancel</button>
                    </div>
                  </div>
                )}

                {schedulesLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>}

                <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                  {schedules.length === 0 && !schedulesLoading ? (
                    <div className="p-8 text-center text-zinc-600 text-sm">No schedules created yet.</div>
                  ) : (
                    <div className="divide-y divide-zinc-800/50">
                      {schedules.map(s => (
                        <div key={s.id}>
                          <div className="px-4 py-3 flex items-center gap-4">
                            <button onClick={() => toggleSchedule(s)} className="flex-shrink-0">
                              {s.enabled ? <ToggleRight className="h-5 w-5 text-cyan-400" /> : <ToggleLeft className="h-5 w-5 text-zinc-600" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-zinc-200">{s.name}</span>
                                {s.saved_query_name && <span className="text-xs text-zinc-600">→ {s.saved_query_name}</span>}
                              </div>
                              <div className="flex items-center gap-4 text-[10px] text-zinc-600 mt-0.5">
                                <span>🕐 {s.cron_human || cronToHuman(s.cron_expression)}</span>
                                <span>Format: {s.output_format || "JSON"}</span>
                                {s.next_run && <span>Next: {formatTime(s.next_run)}</span>}
                                {s.last_run && <span>Last: {formatTime(s.last_run)}</span>}
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              s.status === "active" || s.status === "success" ? "bg-green-500/20 text-green-400" :
                              s.status === "error" ? "bg-red-500/20 text-red-400" :
                              "bg-zinc-500/20 text-zinc-400"
                            }`}>{s.status}</span>
                            <div className="flex gap-1">
                              <button onClick={() => runScheduleNow(s.id)} className="text-xs text-cyan-500 hover:text-cyan-400 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">Run Now</button>
                              <button onClick={() => {
                                if (expandedSchedule === s.id) { setExpandedSchedule(null); }
                                else { setExpandedSchedule(s.id); fetchScheduleResults(s.id); }
                              }} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">
                                {expandedSchedule === s.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              </button>
                              <button onClick={() => deleteSchedule(s.id)} className="text-xs text-zinc-500 hover:text-red-400 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          {expandedSchedule === s.id && (
                            <div className="px-4 pb-3 pl-12">
                              <h4 className="text-xs text-zinc-500 mb-2">Recent Results</h4>
                              {(scheduleResults[s.id] || []).length === 0 ? (
                                <span className="text-xs text-zinc-600">No results yet</span>
                              ) : (
                                <div className="space-y-1">
                                  {(scheduleResults[s.id] || []).slice(0, 5).map(r => (
                                    <div key={r.id} className="flex items-center gap-4 text-xs">
                                      <span className={`px-1.5 py-0.5 rounded ${r.status === "success" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{r.status}</span>
                                      <span className="text-zinc-500">{r.row_count} rows</span>
                                      <span className="text-zinc-500">{r.runtime_ms}ms</span>
                                      <span className="text-zinc-600">{formatTime(r.ran_at)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Dashboards Tab ──────────────────────────────── */}
            {activeTab === "dashboards" && (
              <div className="space-y-4">
                {/* Top bar */}
                <div className="flex gap-3 items-center">
                  <select
                    value={selectedDashboard?.id || ""}
                    onChange={(e) => { if (e.target.value) loadDashboard(e.target.value); else setSelectedDashboard(null); }}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-200 flex-1"
                  >
                    <option value="">Select a dashboard...</option>
                    {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button onClick={() => setShowDashboardForm(!showDashboardForm)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
                    <Plus className="h-4 w-4" /> New Dashboard
                  </button>
                </div>

                {showDashboardForm && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-zinc-200">Create Dashboard</h3>
                    <input type="text" placeholder="Dashboard name" value={dashboardForm.name} onChange={e => setDashboardForm({ ...dashboardForm, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                    <input type="text" placeholder="Description" value={dashboardForm.description} onChange={e => setDashboardForm({ ...dashboardForm, description: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                    <div className="flex gap-2">
                      <button onClick={createDashboard} disabled={!dashboardForm.name} className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Create</button>
                      <button onClick={() => setShowDashboardForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-sm">Cancel</button>
                    </div>
                  </div>
                )}

                {dashboardsLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-cyan-400" /></div>}

                {/* Dashboard view */}
                {selectedDashboard && (
                  <div className="space-y-4">
                    {/* Dashboard header */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        {editingDashboard ? (
                          <div className="flex-1 space-y-2 mr-4">
                            <input type="text" value={selectedDashboard.name} onChange={e => setSelectedDashboard({ ...selectedDashboard, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200" />
                            <input type="text" value={selectedDashboard.description} onChange={e => setSelectedDashboard({ ...selectedDashboard, description: e.target.value })} placeholder="Description" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200" />
                            <div className="flex gap-2">
                              <button onClick={updateDashboard} className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded text-xs">Save</button>
                              <button onClick={() => setEditingDashboard(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded text-xs">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <h2 className="text-lg font-semibold text-zinc-200">{selectedDashboard.name}</h2>
                            {selectedDashboard.description && <p className="text-xs text-zinc-500 mt-0.5">{selectedDashboard.description}</p>}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => setShowWidgetForm(!showWidgetForm)} className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded text-xs font-medium">
                            <Plus className="h-3 w-3" /> Add Widget
                          </button>
                          <button onClick={() => setEditingDashboard(true)} className="text-zinc-500 hover:text-zinc-300"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => deleteDashboard(selectedDashboard.id)} className="text-zinc-500 hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </div>

                    {/* Add widget form */}
                    {showWidgetForm && (
                      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-zinc-200">Add Widget</h3>
                        <input type="text" placeholder="Widget title" value={widgetForm.title} onChange={e => setWidgetForm({ ...widgetForm, title: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                        <select value={widgetForm.saved_query_id} onChange={e => setWidgetForm({ ...widgetForm, saved_query_id: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                          <option value="">Select saved query...</option>
                          {savedQueries.map(sq => <option key={sq.id} value={sq.id}>{sq.name}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-3">
                          <select value={widgetForm.visualization} onChange={e => setWidgetForm({ ...widgetForm, visualization: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200">
                            <option value="table">Table</option>
                            <option value="number">Number</option>
                            <option value="bar">Bar</option>
                            <option value="list">List</option>
                            <option value="pie">Pie (coming soon)</option>
                            <option value="line">Line (coming soon)</option>
                          </select>
                          <input type="number" placeholder="Position" value={widgetForm.position} onChange={e => setWidgetForm({ ...widgetForm, position: parseInt(e.target.value) || 0 })} className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={addWidget} disabled={!widgetForm.title || !widgetForm.saved_query_id} className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Add</button>
                          <button onClick={() => setShowWidgetForm(false)} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-sm">Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Widget grid */}
                    {selectedDashboard.widgets.length === 0 ? (
                      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 text-center text-zinc-600 text-sm">
                        No widgets yet. Add one to get started!
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {selectedDashboard.widgets.sort((a, b) => a.position - b.position).map(w => (
                          <div key={w.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                            <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
                              <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                                {vizIcon(w.visualization)}
                                {editingWidget?.id === w.id ? (
                                  <input type="text" value={editingWidget.title} onChange={e => setEditingWidget({ ...editingWidget, title: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 w-32" />
                                ) : w.title}
                              </div>
                              <div className="flex gap-1">
                                {editingWidget?.id === w.id ? (
                                  <>
                                    <select value={editingWidget.visualization} onChange={e => setEditingWidget({ ...editingWidget, visualization: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-200">
                                      <option value="table">Table</option><option value="number">Number</option><option value="bar">Bar</option><option value="list">List</option><option value="pie">Pie</option><option value="line">Line</option>
                                    </select>
                                    <button onClick={() => updateWidget(editingWidget)} className="text-green-400 hover:text-green-300"><CheckCircle2 className="h-3.5 w-3.5" /></button>
                                    <button onClick={() => setEditingWidget(null)} className="text-zinc-500 hover:text-zinc-300"><X className="h-3.5 w-3.5" /></button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => setEditingWidget(w)} className="text-zinc-600 hover:text-zinc-300"><Pencil className="h-3 w-3" /></button>
                                    <button onClick={() => removeWidget(w.id)} className="text-zinc-600 hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="p-3">
                              {renderWidgetContent(w)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!selectedDashboard && !showDashboardForm && dashboards.length > 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-600 text-sm">
                    Select a dashboard from the dropdown above
                  </div>
                )}

                {!selectedDashboard && !showDashboardForm && dashboards.length === 0 && !dashboardsLoading && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center text-zinc-600 text-sm">
                    No dashboards yet. Create one to get started!
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
