"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { API_BASE } from "@/lib/api-config";
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

  // History
  const [history, setHistory] = useState<{ query: QueryDSL; time: string; ms: number; rows: number }[]>([]);

  // Tab
  const [activeTab, setActiveTab] = useState<"builder" | "live" | "templates" | "history">("builder");

  // ─── Fetch schema & templates ────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const [schemaRes, templateRes] = await Promise.all([
          fetch(`${API_BASE}/query/schema`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/query/templates`, { headers: getAuthHeader() }),
        ]);
        if (schemaRes.ok) {
          const s = await schemaRes.json();
          setSchema(s.categories || []);
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

  const executeQuery = useCallback(
    async (dsl?: QueryDSL) => {
      setLoading(true);
      setError(null);

      const query: QueryDSL = dsl || {
        from: selectedTable,
        ...(selectedJoin && { join: selectedJoin }),
        ...(selectedColumns.length > 0 && { select: selectedColumns }),
        ...(whereClauses.length > 0 && { where: whereClauses }),
        ...(groupBy && { groupBy: groupBy.split(",").map((s) => s.trim()) }),
        ...(orderBy && { orderBy: [{ field: orderBy, dir: orderDir }] }),
        limit,
      };

      try {
        const res = await fetch(`${API_BASE}/query/execute`, {
          method: "POST",
          headers: { ...getAuthHeader(), "Content-Type": "application/json" },
          body: JSON.stringify(query),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data: QueryResult = await res.json();
        setResult(data);

        // Add to history
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
    [selectedTable, selectedJoin, selectedColumns, whereClauses, groupBy, orderBy, orderDir, limit]
  );

  // ─── Live Query via SSE ──────────────────────────────────────────

  const executeLiveQuery = useCallback(async () => {
    setLiveRunning(true);
    setLiveResults([]);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/query/live`, {
        method: "POST",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ command: liveCommand }),
      });

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

  // ─── Render ──────────────────────────────────────────────────────

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
        <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
          {(
            [
              { id: "builder", label: "Query Builder", icon: Database },
              { id: "live", label: "Live Query", icon: Wifi },
              { id: "templates", label: "Templates", icon: Bookmark },
              { id: "history", label: "History", icon: Clock },
            ] as const
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

            {/* History Tab */}
            {activeTab === "history" && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800">
                  <h3 className="text-sm font-semibold text-zinc-300">Recent Queries</h3>
                </div>
                {history.length === 0 ? (
                  <div className="p-8 text-center text-zinc-600 text-sm">
                    No queries executed yet. Try the builder or a template!
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/50">
                    {history.map((h, i) => (
                      <button
                        key={i}
                        onClick={() => executeQuery(h.query)}
                        className="w-full px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <code className="text-xs font-mono text-zinc-400">
                            FROM {h.query.from}
                            {h.query.join && ` JOIN ${h.query.join}`}
                            {h.query.where && ` WHERE (${h.query.where.length} filters)`}
                            {h.query.select && ` SELECT ${h.query.select.length} cols`}
                          </code>
                          <div className="flex items-center gap-3 text-xs text-zinc-600">
                            <span>{h.rows} rows</span>
                            <span>{h.ms}ms</span>
                            <span>{h.time}</span>
                          </div>
                        </div>
                      </button>
                    ))}
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
