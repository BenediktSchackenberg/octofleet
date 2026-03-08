"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────────────

export interface NodeMetrics {
  id: string;
  nodeId: string;
  hostname: string;
  osName: string | null;
  lastSeen: string | null;
  isOnline: boolean;
  dataPoints: number;
  cpu: { avg: number | null; max: number | null; min: number | null };
  ram: { avg: number | null; max: number | null };
  disk: { avg: number | null; max: number | null };
  network: { avgIn: number | null; avgOut: number | null; maxIn: number | null; maxOut: number | null };
  tags?: string[];
  groupId?: string;
  groupName?: string;
}

export interface Group {
  id: string;
  name: string;
  memberCount: number;
}

export interface TimeseriesData {
  timeseries: Array<{ time: string; cpu: number; ram: number; disk: number; nodes: number }>;
  current: { cpu: number; ram: number; disk: number };
  dataPoints: number;
}

export interface NodeTimeseries {
  node_id: string;
  timeseries: Array<{ time: string; cpu: number; ram: number; disk: number }>;
}

export type GroupByMode = "group" | "os" | "tags";
export type SortMode = "worst" | "alpha";
export type StatusFilter = "all" | "online" | "offline" | "crit" | "warn";
export type TimeRange = "1" | "6" | "24" | "168";

export const TIME_RANGES: { value: TimeRange; label: string; bucket: number }[] = [
  { value: "1", label: "1h", bucket: 5 },
  { value: "6", label: "6h", bucket: 15 },
  { value: "24", label: "24h", bucket: 30 },
  { value: "168", label: "7d", bucket: 120 },
];

export const AUTO_REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "10", label: "10s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// ─── Helpers ─────────────────────────────────────────────────────────

export function getWorstMetric(node: NodeMetrics): { metric: "cpu" | "ram" | "disk"; value: number } {
  const cpu = node.cpu.avg ?? 0;
  const ram = node.ram.avg ?? 0;
  const disk = node.disk.avg ?? 0;
  if (ram >= cpu && ram >= disk) return { metric: "ram", value: ram };
  if (disk >= cpu && disk >= ram) return { metric: "disk", value: disk };
  return { metric: "cpu", value: cpu };
}

export function getNodeStatus(node: NodeMetrics): "crit" | "warn" | "ok" | "offline" | "stale" {
  if (!node.isOnline) return "offline";
  const lastSeen = node.lastSeen ? new Date(node.lastSeen) : null;
  const now = new Date();
  if (lastSeen && (now.getTime() - lastSeen.getTime()) > 30000) return "stale";
  const worst = getWorstMetric(node).value;
  if (worst > 90) return "crit";
  if (worst > 75) return "warn";
  return "ok";
}

export function getHeatIntensity(value: number | null): number {
  if (value === null) return 0;
  if (value > 85) return 4;
  if (value > 70) return 3;
  if (value > 40) return 2;
  return 1;
}

export function secondsAgo(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function usePerformanceDashboard() {
  // Data state
  const [nodes, setNodes] = useState<NodeMetrics[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [fleetTimeseries, setFleetTimeseries] = useState<TimeseriesData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupByMode>("group");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("worst");
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [topN, setTopN] = useState<number>(25);
  const [timeRange, setTimeRange] = useState<TimeRange>("1");
  const [autoRefresh, setAutoRefresh] = useState<string>("30");

  // UI state
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [drawerNode, setDrawerNode] = useState<NodeMetrics | null>(null);
  const [drawerTimeseries, setDrawerTimeseries] = useState<NodeTimeseries | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const hours = parseInt(timeRange);
      const bucket = TIME_RANGES.find(t => t.value === timeRange)?.bucket || 5;

      const [fleetRes, tsRes, groupsRes] = await Promise.all([
        apiClient.get(`/metrics/fleet?hours=${hours}`, { showErrorToast: false }),
        apiClient.get(`/metrics/timeseries?hours=${hours}&bucket_minutes=${bucket}`, { showErrorToast: false }),
        apiClient.get(`/groups`, { showErrorToast: false }),
      ]);

      if (fleetRes) { setNodes(fleetRes.nodes || []); }
      if (tsRes) { setFleetTimeseries(tsRes); }
      if (groupsRes) { setGroups(groupsRes.groups || []); }
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = parseInt(autoRefresh);
    if (interval === 0) return;
    const timer = setInterval(fetchData, interval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchData]);

  // Fetch node timeseries for drawer
  useEffect(() => {
    if (!drawerNode) { setDrawerTimeseries(null); return; }
    (async () => {
      try {
        const res = await apiClient.get(`/metrics/node/${drawerNode.id}?hours=1&bucket_minutes=5`, { showErrorToast: false });
        if (res) { setDrawerTimeseries(res); }
      } catch (e) { console.error("Failed to fetch node timeseries:", e); }
    })();
  }, [drawerNode]);

  // Filter & sort nodes
  const filteredNodes = useMemo(() => {
    let result = [...nodes];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(n =>
        n.hostname.toLowerCase().includes(q) ||
        n.osName?.toLowerCase().includes(q) ||
        n.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== "all") {
      result = result.filter(n => {
        const status = getNodeStatus(n);
        if (statusFilter === "online") return n.isOnline;
        if (statusFilter === "offline") return !n.isOnline;
        if (statusFilter === "crit") return status === "crit";
        if (statusFilter === "warn") return status === "warn" || status === "crit";
        return true;
      });
    }
    if (onlyAlerts) {
      result = result.filter(n => {
        const status = getNodeStatus(n);
        return status === "crit" || status === "warn";
      });
    }
    return result;
  }, [nodes, search, statusFilter, onlyAlerts]);

  // Matrix nodes (top N by worst)
  const matrixNodes = useMemo(() => {
    const sorted = [...filteredNodes].sort((a, b) => getWorstMetric(b).value - getWorstMetric(a).value);
    const pinned = sorted.filter(n => pinnedNodes.has(n.nodeId));
    const unpinned = sorted.filter(n => !pinnedNodes.has(n.nodeId));
    return [...pinned, ...unpinned].slice(0, topN);
  }, [filteredNodes, topN, pinnedNodes]);

  // Grouped nodes
  const groupedNodes = useMemo(() => {
    const sorted = sortMode === "worst"
      ? [...filteredNodes].sort((a, b) => getWorstMetric(b).value - getWorstMetric(a).value)
      : [...filteredNodes].sort((a, b) => a.hostname.localeCompare(b.hostname));

    const groups: Record<string, NodeMetrics[]> = {};
    const pinned = sorted.filter(n => pinnedNodes.has(n.nodeId));
    if (pinned.length > 0) { groups["⭐ Pinned"] = pinned; }

    sorted.filter(n => !pinnedNodes.has(n.nodeId)).forEach(node => {
      let key: string;
      if (groupBy === "group") { key = node.groupName || "Ungrouped"; }
      else if (groupBy === "os") { key = node.osName?.split(" ")[0] || "Unknown OS"; }
      else { key = node.tags?.[0] || "Untagged"; }
      if (!groups[key]) groups[key] = [];
      groups[key].push(node);
    });
    return groups;
  }, [filteredNodes, groupBy, sortMode, pinnedNodes]);

  // Handlers
  const handleSelectNode = (nodeId: string, multi: boolean) => {
    if (multi) {
      setSelectedNodes(prev => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
        return next;
      });
    } else {
      const node = nodes.find(n => n.nodeId === nodeId);
      if (node) setDrawerNode(node);
    }
  };

  const handlePinNode = (nodeId: string) => {
    setPinnedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName); else next.add(groupName);
      return next;
    });
  };

  return {
    // Data
    nodes, groups, fleetTimeseries, loading, lastRefresh,
    // Filters
    search, setSearch, groupBy, setGroupBy, statusFilter, setStatusFilter,
    sortMode, setSortMode, onlyAlerts, setOnlyAlerts, topN, setTopN,
    timeRange, setTimeRange, autoRefresh, setAutoRefresh,
    // UI state
    selectedNodes, setSelectedNodes, pinnedNodes, collapsedGroups,
    drawerNode, setDrawerNode, drawerTimeseries,
    // Computed
    filteredNodes, matrixNodes, groupedNodes,
    // Actions
    fetchData, handleSelectNode, handlePinNode, toggleGroup,
  };
}
