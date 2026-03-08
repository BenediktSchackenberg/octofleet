"use client";

import { useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import type { QueryDSL, QueryResult, LiveResult, WhereClause, QueryTemplate, SchemaColumn } from "./useQueryEngine";

// ─── Hook ────────────────────────────────────────────────────────────

export function useQueryExecution(getTableColumns: (table: string) => SchemaColumn[]) {
  // Query builder state
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

  // Local history fallback
  const [history, setHistory] = useState<{ query: QueryDSL; time: string; ms: number; rows: number }[]>([]);

  // Derived columns
  const tableColumns = getTableColumns(selectedTable);
  const joinTableColumns = selectedJoin ? getTableColumns(selectedJoin) : [];
  const allColumns = [
    ...tableColumns.map((c) => ({ ...c, table: selectedTable })),
    ...joinTableColumns.map((c) => ({ ...c, table: selectedJoin })),
  ];

  // Build DSL
  const buildCurrentDSL = useCallback((): QueryDSL => ({
    from: selectedTable,
    ...(selectedJoin && { join: selectedJoin }),
    ...(selectedColumns.length > 0 && { select: selectedColumns }),
    ...(whereClauses.length > 0 && { where: whereClauses }),
    ...(groupBy && { groupBy: groupBy.split(",").map((s) => s.trim()) }),
    ...(orderBy && { orderBy: [{ field: orderBy, dir: orderDir }] }),
    limit,
  }), [selectedTable, selectedJoin, selectedColumns, whereClauses, groupBy, orderBy, orderDir, limit]);

  // Execute query
  const executeQuery = useCallback(async (dsl?: QueryDSL) => {
    setLoading(true);
    setError(null);
    const query: QueryDSL = dsl || buildCurrentDSL();
    try {
      const res = await apiClient.richPost<QueryResult>(`/query/execute`, query);
      if (!res.ok || !res.data) {
        setError(res.error || "Query execution failed");
        return;
      }
      const data = res.data;
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
  }, [buildCurrentDSL]);

  // Live query
  const executeLiveQuery = useCallback(async () => {
    setLiveRunning(true);
    setLiveResults([]);
    setError(null);
    try {
      const res = await apiClient.richPost(`/query/live`, { command: liveCommand });
      if (!res.ok) {
        setError(res.error || "Live query failed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLiveRunning(false);
    }
  }, [liveCommand]);

  // Load template / DSL into builder
  const loadTemplate = (t: QueryTemplate) => {
    setSelectedTable(t.query.from);
    setSelectedJoin(t.query.join || "");
    setSelectedColumns(t.query.select || []);
    setWhereClauses(t.query.where || []);
    setGroupBy(t.query.groupBy?.join(", ") || "");
    setOrderBy(t.query.orderBy?.[0]?.field || "");
    setOrderDir(t.query.orderBy?.[0]?.dir || "ASC");
    setLimit(t.query.limit || 100);
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
  };

  // Where clause helpers
  const addWhere = () => {
    setWhereClauses([...whereClauses, { field: tableColumns[0]?.name || "", op: "=", value: "" }]);
  };
  const removeWhere = (idx: number) => {
    setWhereClauses(whereClauses.filter((_, i) => i !== idx));
  };
  const updateWhere = (idx: number, patch: Partial<WhereClause>) => {
    setWhereClauses(whereClauses.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  };

  // Export / Copy
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

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result.rows, null, 2));
  };

  return {
    // Builder state
    selectedTable, setSelectedTable, selectedJoin, setSelectedJoin,
    selectedColumns, setSelectedColumns, whereClauses, setWhereClauses,
    orderBy, setOrderBy, orderDir, setOrderDir, limit, setLimit,
    groupBy, setGroupBy,
    // Results
    result, loading, error, setError,
    // Live
    liveMode, setLiveMode, liveCommand, setLiveCommand,
    liveResults, liveRunning, executeLiveQuery,
    // Local history
    history,
    // Columns
    tableColumns, joinTableColumns, allColumns,
    // Actions
    buildCurrentDSL, executeQuery, loadTemplate, loadDSLIntoBuilder,
    addWhere, removeWhere, updateWhere,
    exportCsv, copyJson,
  };
}
