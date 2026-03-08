"use client";

import { useState } from "react";
import { useQuerySchema } from "./useQuerySchema";
import { useQueryExecution } from "./useQueryExecution";
import { useQueryHistory } from "./useQueryHistory";

// ─── Types (re-exported for consumers) ───────────────────────────────

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

// ─── Orchestrator Hook ───────────────────────────────────────────────

export function useQueryEngine() {
  const [activeTab, setActiveTab] = useState<TabId>("builder");

  const schemaHook = useQuerySchema(activeTab);
  const execHook = useQueryExecution(schemaHook.getTableColumns);
  const historyHook = useQueryHistory(activeTab, execHook.buildCurrentDSL, execHook.setError);

  // loadTemplate and loadDSLIntoBuilder need to also switch tab
  const loadTemplate = (t: QueryTemplate) => {
    execHook.loadTemplate(t);
    setActiveTab("builder");
  };

  const loadDSLIntoBuilder = (dsl: QueryDSL) => {
    execHook.loadDSLIntoBuilder(dsl);
    setActiveTab("builder");
  };

  return {
    // Schema
    schema: schemaHook.schema,
    templates: schemaHook.templates,
    expandedCat: schemaHook.expandedCat, setExpandedCat: schemaHook.setExpandedCat,
    expandedTable: schemaHook.expandedTable, setExpandedTable: schemaHook.setExpandedTable,
    stats: schemaHook.stats,
    // Query builder
    selectedTable: execHook.selectedTable, setSelectedTable: execHook.setSelectedTable,
    selectedJoin: execHook.selectedJoin, setSelectedJoin: execHook.setSelectedJoin,
    selectedColumns: execHook.selectedColumns, setSelectedColumns: execHook.setSelectedColumns,
    whereClauses: execHook.whereClauses, setWhereClauses: execHook.setWhereClauses,
    orderBy: execHook.orderBy, setOrderBy: execHook.setOrderBy,
    orderDir: execHook.orderDir, setOrderDir: execHook.setOrderDir,
    limit: execHook.limit, setLimit: execHook.setLimit,
    groupBy: execHook.groupBy, setGroupBy: execHook.setGroupBy,
    // Results
    result: execHook.result, loading: execHook.loading,
    error: execHook.error, setError: execHook.setError,
    // Live query
    liveMode: execHook.liveMode, setLiveMode: execHook.setLiveMode,
    liveCommand: execHook.liveCommand, setLiveCommand: execHook.setLiveCommand,
    liveResults: execHook.liveResults, liveRunning: execHook.liveRunning,
    executeLiveQuery: execHook.executeLiveQuery,
    // History (local)
    history: execHook.history,
    // Tab
    activeTab, setActiveTab,
    // Columns
    tableColumns: execHook.tableColumns, joinTableColumns: execHook.joinTableColumns,
    allColumns: execHook.allColumns,
    // Actions
    buildCurrentDSL: execHook.buildCurrentDSL, executeQuery: execHook.executeQuery,
    loadTemplate, loadDSLIntoBuilder,
    addWhere: execHook.addWhere, removeWhere: execHook.removeWhere,
    updateWhere: execHook.updateWhere,
    exportCsv: execHook.exportCsv, copyJson: execHook.copyJson,
    // Saved queries
    ...historyHook,
  };
}
