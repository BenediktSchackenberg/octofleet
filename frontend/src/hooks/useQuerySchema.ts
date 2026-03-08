"use client";

import { useEffect, useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import type { SchemaCategory, SchemaTable, SchemaColumn, QueryTemplate, QueryStats, TabId } from "./useQueryEngine";

// ─── Hook ────────────────────────────────────────────────────────────

export function useQuerySchema(activeTab: TabId) {
  const [schema, setSchema] = useState<SchemaCategory[]>([]);
  const [templates, setTemplates] = useState<QueryTemplate[]>([]);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [stats, setStats] = useState<QueryStats | null>(null);

  // Fetch schema & templates on mount
  useEffect(() => {
    async function load() {
      try {
        const [schemaRes, templateRes] = await Promise.all([
          apiClient.richGet<{ categories?: Record<string, SchemaTable[]> | SchemaCategory[] }>(`/query/schema`),
          apiClient.richGet<{ templates?: QueryTemplate[] }>(`/query/templates`),
        ]);
        if (schemaRes.ok && schemaRes.data) {
          const catIcons: Record<string, string> = {
            Fleet: "🖥️", Software: "📦", Security: "🔒", System: "⚙️",
            Monitoring: "📡", Compliance: "📏", Operations: "🔧",
          };
          const cats = schemaRes.data.categories;
          if (cats && typeof cats === "object" && !Array.isArray(cats)) {
            const arr: SchemaCategory[] = Object.entries(cats).map(([name, tables]) => ({
              name,
              icon: catIcons[name] || "📁",
              tables: tables as SchemaTable[],
            }));
            setSchema(arr);
          } else if (Array.isArray(cats)) {
            setSchema(cats);
          }
        }
        if (templateRes.ok && templateRes.data) {
          setTemplates(templateRes.data.templates || []);
        }
      } catch (err) {
        console.error("Failed to load schema/templates", err);
      }
    }
    load();
  }, []);

  // Fetch stats when tab changes
  useEffect(() => {
    async function loadStats() {
      const res = await apiClient.richGet<QueryStats>(`/query/stats`);
      if (res.ok && res.data) setStats(res.data);
    }
    loadStats();
  }, [activeTab]);

  // Column helpers
  const getTableColumns = useCallback(
    (tableName: string): SchemaColumn[] =>
      schema.flatMap((c) => c.tables).find((t) => t.name === tableName)?.columns || [],
    [schema]
  );

  return {
    schema,
    templates,
    expandedCat, setExpandedCat,
    expandedTable, setExpandedTable,
    stats,
    getTableColumns,
  };
}
