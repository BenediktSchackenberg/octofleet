"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import type {
  QueryDSL, QueryResult, SavedQuery, ScheduleEntry, ScheduleResult,
  DashboardMeta, Dashboard, DashboardWidget, HistoryEntry, TabId,
} from "./useQueryEngine";

// ─── Hook ────────────────────────────────────────────────────────────

export function useQueryHistory(
  activeTab: TabId,
  buildCurrentDSL: () => QueryDSL,
  setError: (e: string | null) => void,
) {
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

  // ─── Saved Queries ──────────────────────────────────────────────

  const fetchSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const params = new URLSearchParams();
      if (savedCategoryFilter) params.set("category", savedCategoryFilter);
      if (savedSearch) params.set("tags", savedSearch);
      const res = await apiClient.richGet<SavedQuery[] | { queries?: SavedQuery[] }>(`/query/saved?${params}`);
      if (res.ok && res.data) {
        const d = res.data;
        setSavedQueries(Array.isArray(d) ? d : d.queries || []);
      }
    } catch {} finally { setSavedLoading(false); }
  }, [savedCategoryFilter, savedSearch]);

  useEffect(() => { if (activeTab === "saved") fetchSaved(); }, [activeTab, fetchSaved]);

  const saveCurrent = async () => {
    try {
      const body = {
        name: saveForm.name, description: saveForm.description,
        query_dsl: buildCurrentDSL(), category: saveForm.category,
        tags: saveForm.tags.split(",").map(t => t.trim()).filter(Boolean),
        is_public: saveForm.is_public,
      };
      const res = await apiClient.richPost(`/query/saved`, body);
      if (res.ok) {
        setShowSaveForm(false);
        setSaveForm({ name: "", description: "", category: "", tags: "", is_public: true });
        fetchSaved();
      }
    } catch {}
  };

  const deleteSaved = async (id: string) => {
    try { await apiClient.delete(`/query/saved/${id}`, { showErrorToast: false }); fetchSaved(); } catch {}
  };

  const duplicateSaved = async (id: string) => {
    try {
      const res = await apiClient.richPost(`/query/saved/${id}/duplicate`, {});
      if (res.ok) fetchSaved();
    } catch {}
  };

  const runSaved = async (sq: SavedQuery) => {
    try {
      const res = await apiClient.richPost<QueryResult>(`/query/saved/${sq.id}/run`, {});
      if (res.ok && res.data) setSavedRunResult({ id: sq.id, result: res.data });
    } catch {}
  };

  const togglePublic = async (sq: SavedQuery) => {
    try { await apiClient.put(`/query/saved/${sq.id}`, { is_public: !sq.is_public }, { showErrorToast: false }); fetchSaved(); } catch {}
  };

  const updateSavedQuery = async (sq: SavedQuery) => {
    try {
      await apiClient.put(`/query/saved/${sq.id}`, { name: sq.name, description: sq.description, category: sq.category, tags: sq.tags }, { showErrorToast: false });
      setEditingSaved(null); fetchSaved();
    } catch {}
  };

  // ─── Schedules ──────────────────────────────────────────────────

  const fetchSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    try {
      const res = await apiClient.richGet<ScheduleEntry[] | { schedules?: ScheduleEntry[] }>(`/query/schedules`);
      if (res.ok && res.data) {
        const d = res.data;
        setSchedules(Array.isArray(d) ? d : d.schedules || []);
      }
    } catch {} finally { setSchedulesLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "schedules") fetchSchedules(); }, [activeTab, fetchSchedules]);

  const createSchedule = async () => {
    try {
      const res = await apiClient.richPost(`/query/schedules`, scheduleForm);
      if (res.ok) {
        setShowScheduleForm(false);
        setScheduleForm({ saved_query_id: "", name: "", cron_expression: "0 0 * * *", output_format: "JSON" });
        fetchSchedules();
      }
    } catch {}
  };

  const deleteSchedule = async (id: string) => {
    try { await apiClient.delete(`/query/schedules/${id}`, { showErrorToast: false }); fetchSchedules(); } catch {}
  };

  const toggleSchedule = async (s: ScheduleEntry) => {
    try { await apiClient.put(`/query/schedules/${s.id}`, { enabled: !s.enabled }, { showErrorToast: false }); fetchSchedules(); } catch {}
  };

  const runScheduleNow = async (id: string) => {
    try { const res = await apiClient.richPost(`/query/schedules/${id}/run-now`, {}); if (res.ok) fetchSchedules(); } catch {}
  };

  const fetchScheduleResults = async (id: string) => {
    try {
      const res = await apiClient.richGet<ScheduleResult[] | { results?: ScheduleResult[] }>(`/query/schedules/${id}/results`);
      if (res.ok && res.data) {
        const d = res.data;
        setScheduleResults(prev => ({ ...prev, [id]: Array.isArray(d) ? d : d.results || [] }));
      }
    } catch {}
  };

  // ─── Dashboards ─────────────────────────────────────────────────

  const fetchDashboards = useCallback(async () => {
    setDashboardsLoading(true);
    try {
      const res = await apiClient.richGet<DashboardMeta[] | { dashboards?: DashboardMeta[] }>(`/query/dashboards`);
      if (res.ok && res.data) {
        const d = res.data;
        setDashboards(Array.isArray(d) ? d : d.dashboards || []);
      }
    } catch {} finally { setDashboardsLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "dashboards") fetchDashboards(); }, [activeTab, fetchDashboards]);

  const loadDashboardById = async (id: string) => {
    try {
      const res = await apiClient.richGet<Dashboard>(`/query/dashboards/${id}`);
      if (res.ok && res.data) setSelectedDashboard(res.data);
    } catch {}
  };

  const createDashboard = async () => {
    try {
      const res = await apiClient.richPost<{ id?: string }>(`/query/dashboards`, dashboardForm);
      if (res.ok && res.data) {
        setShowDashboardForm(false);
        setDashboardForm({ name: "", description: "" });
        fetchDashboards();
        if (res.data.id) loadDashboardById(res.data.id);
      }
    } catch {}
  };

  const deleteDashboard = async (id: string) => {
    try { await apiClient.delete(`/query/dashboards/${id}`, { showErrorToast: false }); setSelectedDashboard(null); fetchDashboards(); } catch {}
  };

  const updateDashboard = async () => {
    if (!selectedDashboard) return;
    try {
      await apiClient.put(`/query/dashboards/${selectedDashboard.id}`, { name: selectedDashboard.name, description: selectedDashboard.description }, { showErrorToast: false });
      setEditingDashboard(false); fetchDashboards();
    } catch {}
  };

  const addWidget = async () => {
    if (!selectedDashboard) return;
    try {
      const res = await apiClient.richPost(`/query/dashboards/${selectedDashboard.id}/widgets`, widgetForm);
      if (res.ok) {
        setShowWidgetForm(false);
        setWidgetForm({ saved_query_id: "", title: "", visualization: "table", position: 0 });
        loadDashboardById(selectedDashboard.id);
      }
    } catch {}
  };

  const removeWidget = async (wid: string) => {
    if (!selectedDashboard) return;
    try { await apiClient.delete(`/query/dashboards/${selectedDashboard.id}/widgets/${wid}`, { showErrorToast: false }); loadDashboardById(selectedDashboard.id); } catch {}
  };

  const updateWidgetFn = async (w: DashboardWidget) => {
    if (!selectedDashboard) return;
    try {
      await apiClient.put(`/query/dashboards/${selectedDashboard.id}/widgets/${w.id}`, { title: w.title, visualization: w.visualization, saved_query_id: w.saved_query_id }, { showErrorToast: false });
      setEditingWidget(null); loadDashboardById(selectedDashboard.id);
    } catch {}
  };

  // ─── History (backend) ──────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.richGet<HistoryEntry[] | { history?: HistoryEntry[] }>(`/query/history?limit=50`);
      if (res.ok && res.data) {
        const d = res.data;
        setHistoryEntries(Array.isArray(d) ? d : d.history || []);
      }
    } catch {} finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "history") fetchHistory(); }, [activeTab, fetchHistory]);

  const clearHistory = async () => {
    try { await apiClient.delete(`/query/history`, { showErrorToast: false }); setHistoryEntries([]); } catch {}
  };

  const saveHistoryAsSaved = async (entry: HistoryEntry) => {
    try {
      const res = await apiClient.richPost(`/query/saved`, {
        name: `Query from ${new Date(entry.created_at).toLocaleString()}`,
        description: "", query_dsl: entry.query_dsl, category: "", tags: [], is_public: false,
      });
      if (res.ok) setError(null);
    } catch {}
  };

  return {
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
