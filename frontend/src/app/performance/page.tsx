"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Breadcrumb } from "@/components/ui-components";
import { 
  RefreshCw, Cpu, MemoryStick, HardDrive, Activity, Search, X, Star, StarOff,
  ChevronDown, ChevronRight, Clock, AlertTriangle, CheckCircle, XCircle, Eye, EyeOff,
  Terminal, RotateCcw, ExternalLink, Server, Monitor
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";

// ============== Types ==============
interface NodeMetrics {
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

interface Group {
  id: string;
  name: string;
  memberCount: number;
}

interface TimeseriesData {
  timeseries: Array<{ time: string; cpu: number; ram: number; disk: number; nodes: number }>;
  current: { cpu: number; ram: number; disk: number };
  dataPoints: number;
}

interface NodeTimeseries {
  node_id: string;
  timeseries: Array<{ time: string; cpu: number; ram: number; disk: number }>;
}

type GroupByMode = "group" | "os" | "tags";
type SortMode = "worst" | "alpha";
type StatusFilter = "all" | "online" | "offline" | "crit" | "warn";
type TimeRange = "1" | "6" | "24" | "168";

const TIME_RANGES: { value: TimeRange; label: string; bucket: number }[] = [
  { value: "1", label: "1h", bucket: 5 },
  { value: "6", label: "6h", bucket: 15 },
  { value: "24", label: "24h", bucket: 30 },
  { value: "168", label: "7d", bucket: 120 },
];

const AUTO_REFRESH_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "10", label: "10s" },
  { value: "30", label: "30s" },
  { value: "60", label: "60s" },
];

// ============== Helper Functions ==============
function getWorstMetric(node: NodeMetrics): { metric: "cpu" | "ram" | "disk"; value: number } {
  const cpu = node.cpu.avg ?? 0;
  const ram = node.ram.avg ?? 0;
  const disk = node.disk.avg ?? 0;
  if (ram >= cpu && ram >= disk) return { metric: "ram", value: ram };
  if (disk >= cpu && disk >= ram) return { metric: "disk", value: disk };
  return { metric: "cpu", value: cpu };
}

function getNodeStatus(node: NodeMetrics): "crit" | "warn" | "ok" | "offline" | "stale" {
  if (!node.isOnline) return "offline";
  
  const lastSeen = node.lastSeen ? new Date(node.lastSeen) : null;
  const now = new Date();
  if (lastSeen && (now.getTime() - lastSeen.getTime()) > 30000) return "stale";
  
  const worst = getWorstMetric(node).value;
  if (worst > 90) return "crit";
  if (worst > 75) return "warn";
  return "ok";
}

function getHeatIntensity(value: number | null): number {
  if (value === null) return 0;
  if (value > 85) return 4; // critical
  if (value > 70) return 3; // warn
  if (value > 40) return 2; // medium
  return 1; // low
}

function secondsAgo(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// ============== Components ==============

// Heat Cell Component
function HeatCell({ value, metric }: { value: number | null; metric: "cpu" | "ram" | "disk" }) {
  const intensity = getHeatIntensity(value);
  const colors: Record<string, Record<number, string>> = {
    cpu: { 0: "bg-muted", 1: "bg-blue-200", 2: "bg-blue-400", 3: "bg-blue-600", 4: "bg-blue-800" },
    ram: { 0: "bg-muted", 1: "bg-green-200", 2: "bg-green-400", 3: "bg-green-600", 4: "bg-green-800" },
    disk: { 0: "bg-muted", 1: "bg-purple-200", 2: "bg-purple-400", 3: "bg-purple-600", 4: "bg-purple-800" },
  };
  
  const bars = [1, 2, 3, 4];
  
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-0.5">
        {bars.map((i) => (
          <div 
            key={i} 
            className={`w-2 h-4 rounded-sm ${i <= intensity ? colors[metric][intensity] : "bg-muted"}`} 
          />
        ))}
      </div>
      <span className={`text-xs font-mono w-8 ${intensity >= 4 ? "text-red-600 font-bold" : intensity >= 3 ? "text-yellow-600" : ""}`}>
        {value !== null ? Math.round(value) : "-"}
      </span>
      {intensity >= 4 && <AlertTriangle className="h-3 w-3 text-red-600" />}
      {intensity === 3 && <AlertTriangle className="h-3 w-3 text-yellow-600" />}
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: "crit" | "warn" | "ok" | "offline" | "stale" }) {
  const config: Record<typeof status, { label: string; className: string; icon: React.ReactNode }> = {
    crit: { label: "CRIT", className: "bg-red-600 text-white", icon: <XCircle className="h-3 w-3" /> },
    warn: { label: "WARN", className: "bg-yellow-500 text-black", icon: <AlertTriangle className="h-3 w-3" /> },
    ok: { label: "OK", className: "bg-green-600 text-white", icon: <CheckCircle className="h-3 w-3" /> },
    offline: { label: "OFF", className: "bg-gray-500 text-white", icon: <XCircle className="h-3 w-3" /> },
    stale: { label: "STALE", className: "bg-gray-400 text-white", icon: <Clock className="h-3 w-3" /> },
  };
  const c = config[status];
  return (
    <Badge className={`${c.className} gap-1 text-xs px-1.5 py-0`}>
      {c.icon}
      {c.label}
    </Badge>
  );
}

// Hotspot Matrix Row
function HotspotRow({ 
  node, 
  isSelected, 
  isPinned,
  onSelect, 
  onPin 
}: { 
  node: NodeMetrics; 
  isSelected: boolean;
  isPinned: boolean;
  onSelect: (nodeId: string, multi: boolean) => void;
  onPin: (nodeId: string) => void;
}) {
  const worst = getWorstMetric(node);
  const status = getNodeStatus(node);
  
  return (
    <div 
      className={`grid grid-cols-[24px_1fr_80px_80px_80px_60px_50px] gap-2 items-center py-1.5 px-2 text-sm cursor-pointer hover:bg-muted/50 border-b border-muted/30 ${isSelected ? "bg-primary/10" : ""}`}
      onClick={(e) => onSelect(node.nodeId, e.shiftKey)}
    >
      <button 
        onClick={(e) => { e.stopPropagation(); onPin(node.nodeId); }}
        className="hover:text-yellow-500"
      >
        {isPinned ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : <StarOff className="h-4 w-4 text-muted-foreground" />}
      </button>
      <div className="flex items-center gap-2 truncate">
        <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{node.hostname}</span>
        {status !== "ok" && status !== "offline" && <StatusBadge status={status} />}
      </div>
      <HeatCell value={node.cpu.avg} metric="cpu" />
      <HeatCell value={node.ram.avg} metric="ram" />
      <HeatCell value={node.disk.avg} metric="disk" />
      <Badge variant="outline" className="text-xs justify-center">
        {worst.metric.toUpperCase()}
      </Badge>
      <span className={`text-xs font-mono ${status === "stale" ? "text-yellow-600" : "text-muted-foreground"}`}>
        {secondsAgo(node.lastSeen)}
      </span>
    </div>
  );
}

// Grouped Node List Row
function NodeListRow({ 
  node, 
  isSelected,
  onSelect 
}: { 
  node: NodeMetrics; 
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const worst = getWorstMetric(node);
  const status = getNodeStatus(node);
  
  const ProgressBar = ({ value, color }: { value: number | null; color: string }) => {
    const pct = Math.min(value ?? 0, 100);
    const bgColor = pct > 90 ? "bg-red-500" : pct > 75 ? "bg-yellow-500" : color;
    return (
      <div className="flex items-center gap-2">
        <div className="w-20 h-2.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${bgColor}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-mono w-10 ${pct > 90 ? "text-red-600 font-bold" : pct > 75 ? "text-yellow-600" : ""}`}>
          {value !== null ? `${Math.round(value)}%` : "-"}
        </span>
      </div>
    );
  };
  
  return (
    <div 
      className={`grid grid-cols-[80px_1fr_140px_140px_140px_60px] gap-3 items-center py-2 px-3 cursor-pointer hover:bg-muted/50 border-b ${isSelected ? "bg-primary/10" : ""}`}
      onClick={() => onSelect(node.nodeId)}
    >
      <StatusBadge status={status} />
      <div className="flex items-center gap-2 truncate">
        <span className="font-medium">{node.hostname}</span>
        {node.tags && node.tags.length > 0 && (
          <div className="flex gap-1">
            {node.tags.slice(0, 2).map(t => (
              <Badge key={t} variant="secondary" className="text-xs px-1">{t}</Badge>
            ))}
          </div>
        )}
      </div>
      <ProgressBar value={node.cpu.avg} color="bg-blue-500" />
      <ProgressBar value={node.ram.avg} color="bg-green-500" />
      <ProgressBar value={node.disk.avg} color="bg-purple-500" />
      <Badge variant="outline" className="text-xs justify-center">{worst.metric.toUpperCase()}</Badge>
    </div>
  );
}

// Node Details Drawer
function NodeDetailsDrawer({ 
  node, 
  timeseries,
  onClose 
}: { 
  node: NodeMetrics | null;
  timeseries: NodeTimeseries | null;
  onClose: () => void;
}) {
  if (!node) return null;
  
  const status = getNodeStatus(node);
  const worst = getWorstMetric(node);
  
  return (
    <Sheet open={!!node} onOpenChange={() => onClose()}>
      <SheetContent className="w-[450px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              {node.hostname}
              <StatusBadge status={status} />
            </div>
          </SheetTitle>
        </SheetHeader>
        
        <div className="mt-6 space-y-6">
          {/* Tags */}
          {node.tags && node.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {node.tags.map(t => (
                <Badge key={t} variant="secondary">{t}</Badge>
              ))}
            </div>
          )}
          
          {/* Current Metrics */}
          <div className="grid grid-cols-3 gap-4">
            <Card className={node.cpu.avg && node.cpu.avg > 85 ? "border-red-500" : ""}>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardDescription className="text-xs">CPU</CardDescription>
                <CardTitle className="text-2xl text-blue-500">
                  {node.cpu.avg?.toFixed(0) ?? "-"}%
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className={node.ram.avg && node.ram.avg > 85 ? "border-red-500" : ""}>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardDescription className="text-xs">RAM</CardDescription>
                <CardTitle className={`text-2xl ${worst.metric === "ram" ? "text-red-500" : "text-green-500"}`}>
                  {node.ram.avg?.toFixed(0) ?? "-"}%
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className={node.disk.avg && node.disk.avg > 85 ? "border-red-500" : ""}>
              <CardHeader className="pb-1 pt-3 px-3">
                <CardDescription className="text-xs">Disk</CardDescription>
                <CardTitle className={`text-2xl ${worst.metric === "disk" ? "text-red-500" : "text-purple-500"}`}>
                  {node.disk.avg?.toFixed(0) ?? "-"}%
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          
          {/* Worst Metric Highlight */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="text-sm text-muted-foreground">Worst Metric</div>
            <div className="text-lg font-bold">{worst.metric.toUpperCase()} at {worst.value.toFixed(1)}%</div>
          </div>
          
          {/* Trend Chart */}
          {timeseries && timeseries.timeseries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Trend (60m)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeseries.timeseries} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="time" tickFormatter={(t) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} tick={{ fontSize: 9 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={1.5} />
                      <Area type="monotone" dataKey="ram" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} strokeWidth={1.5} />
                      <Area type="monotone" dataKey="disk" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-4 mt-2 text-xs">
                  <span className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded" /> CPU</span>
                  <span className="flex items-center gap-1"><div className="w-3 h-3 bg-green-500 rounded" /> RAM</span>
                  <span className="flex items-center gap-1"><div className="w-3 h-3 bg-purple-500 rounded" /> Disk</span>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Info */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">OS</span>
              <span>{node.osName || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Seen</span>
              <span>{secondsAgo(node.lastSeen)} ago</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data Points</span>
              <span>{node.dataPoints}</span>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/nodes/${node.nodeId}?tab=logs`}>
                <Terminal className="h-4 w-4 mr-1" /> Logs
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/nodes/${node.nodeId}?tab=live`}>
                <Activity className="h-4 w-4 mr-1" /> Live
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/nodes/${node.nodeId}`}>
                <ExternalLink className="h-4 w-4 mr-1" /> Details
              </Link>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============== Main Page ==============
export default function PerformancePage() {
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
        fetch(`${API_BASE}/metrics/fleet?hours=${hours}`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/metrics/timeseries?hours=${hours}&bucket_minutes=${bucket}`, { headers: getAuthHeader() }),
        fetch(`${API_BASE}/groups`, { headers: getAuthHeader() }),
      ]);
      
      if (fleetRes.ok) {
        const json = await fleetRes.json();
        setNodes(json.nodes || []);
      }
      if (tsRes.ok) {
        const json = await tsRes.json();
        setFleetTimeseries(json);
      }
      if (groupsRes.ok) {
        const json = await groupsRes.json();
        setGroups(json.groups || []);
      }
      setLastRefresh(new Date());
    } catch (e) {
      console.error("Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  
  useEffect(() => {
    const interval = parseInt(autoRefresh);
    if (interval === 0) return;
    const timer = setInterval(fetchData, interval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchData]);
  
  // Fetch node timeseries for drawer
  useEffect(() => {
    if (!drawerNode) {
      setDrawerTimeseries(null);
      return;
    }
    
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/metrics/node/${drawerNode.id}?hours=1&bucket_minutes=5`, { headers: getAuthHeader() });
        if (res.ok) {
          const json = await res.json();
          setDrawerTimeseries(json);
        }
      } catch (e) {
        console.error("Failed to fetch node timeseries:", e);
      }
    })();
  }, [drawerNode]);
  
  // Filter & sort nodes
  const filteredNodes = useMemo(() => {
    let result = [...nodes];
    
    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(n => 
        n.hostname.toLowerCase().includes(q) ||
        n.osName?.toLowerCase().includes(q) ||
        n.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    
    // Status filter
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
    
    // Only alerts
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
    const sorted = [...filteredNodes].sort((a, b) => {
      const aWorst = getWorstMetric(a).value;
      const bWorst = getWorstMetric(b).value;
      return bWorst - aWorst;
    });
    
    // Pinned nodes first
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
    
    // Pinned group always first
    const pinned = sorted.filter(n => pinnedNodes.has(n.nodeId));
    if (pinned.length > 0) {
      groups["⭐ Pinned"] = pinned;
    }
    
    sorted.filter(n => !pinnedNodes.has(n.nodeId)).forEach(node => {
      let key: string;
      if (groupBy === "group") {
        key = node.groupName || "Ungrouped";
      } else if (groupBy === "os") {
        key = node.osName?.split(" ")[0] || "Unknown OS";
      } else {
        key = node.tags?.[0] || "Untagged";
      }
      
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
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
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
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };
  
  const toggleGroup = (groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  };
  
  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin" />
        </div>
      </main>
    );
  }
  
  return (
    <main className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Performance" }]} />
        
        {/* Header */}
        <div className="flex items-center justify-between mb-4 mt-3">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-500" />
            PERFORMANCE
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {lastRefresh && <span>Updated {lastRefresh.toLocaleTimeString("de-DE")}</span>}
            <Button variant="ghost" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Filters Bar */}
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-[180px] h-9"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              
              {/* Group By */}
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupByMode)}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">By Group</SelectItem>
                  <SelectItem value="os">By OS</SelectItem>
                  <SelectItem value="tags">By Tags</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="crit">Critical</SelectItem>
                  <SelectItem value="warn">Warning+</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Sort Mode */}
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                <SelectTrigger className="w-[110px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worst">Worst ↓</SelectItem>
                  <SelectItem value="alpha">A-Z</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Only Alerts */}
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="onlyAlerts" 
                  checked={onlyAlerts} 
                  onCheckedChange={(c) => setOnlyAlerts(!!c)} 
                />
                <label htmlFor="onlyAlerts" className="text-sm cursor-pointer">Only Alerts</label>
              </div>
              
              {/* Top N */}
              <Select value={String(topN)} onValueChange={(v) => setTopN(parseInt(v))}>
                <SelectTrigger className="w-[90px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Top 10</SelectItem>
                  <SelectItem value="25">Top 25</SelectItem>
                  <SelectItem value="50">Top 50</SelectItem>
                  <SelectItem value="100">Top 100</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Time Range */}
              <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
                <SelectTrigger className="w-[80px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Auto Refresh */}
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">Auto:</span>
                <Select value={autoRefresh} onValueChange={setAutoRefresh}>
                  <SelectTrigger className="w-[70px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTO_REFRESH_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Hotspot Matrix */}
        <Card className="mb-4">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">OVERVIEW MATRIX (Hotspot Radar)</CardTitle>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <div className="flex gap-0.5">
                    <div className="w-2 h-3 bg-blue-200 rounded-sm" />
                  </div>
                  0-40
                </span>
                <span className="flex items-center gap-1">
                  <div className="flex gap-0.5">
                    <div className="w-2 h-3 bg-blue-400 rounded-sm" />
                    <div className="w-2 h-3 bg-blue-400 rounded-sm" />
                  </div>
                  41-70
                </span>
                <span className="flex items-center gap-1">
                  <div className="flex gap-0.5">
                    <div className="w-2 h-3 bg-blue-600 rounded-sm" />
                    <div className="w-2 h-3 bg-blue-600 rounded-sm" />
                    <div className="w-2 h-3 bg-blue-600 rounded-sm" />
                  </div>
                  71-85
                </span>
                <span className="flex items-center gap-1">
                  <div className="flex gap-0.5">
                    <div className="w-2 h-3 bg-blue-800 rounded-sm" />
                    <div className="w-2 h-3 bg-blue-800 rounded-sm" />
                    <div className="w-2 h-3 bg-blue-800 rounded-sm" />
                    <div className="w-2 h-3 bg-blue-800 rounded-sm" />
                  </div>
                  &gt;85 ⚠
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Matrix Header */}
            <div className="grid grid-cols-[24px_1fr_80px_80px_80px_60px_50px] gap-2 items-center py-2 px-2 text-xs font-medium text-muted-foreground border-b-2">
              <div></div>
              <div>NODE</div>
              <div className="flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</div>
              <div className="flex items-center gap-1"><MemoryStick className="h-3 w-3" /> RAM</div>
              <div className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> DISK</div>
              <div>WORST</div>
              <div>LAST</div>
            </div>
            
            {/* Matrix Rows */}
            <div className="max-h-[300px] overflow-y-auto">
              {matrixNodes.map(node => (
                <HotspotRow 
                  key={node.nodeId}
                  node={node}
                  isSelected={selectedNodes.has(node.nodeId)}
                  isPinned={pinnedNodes.has(node.nodeId)}
                  onSelect={handleSelectNode}
                  onPin={handlePinNode}
                />
              ))}
              {matrixNodes.length === 0 && (
                <div className="py-8 text-center text-muted-foreground">No nodes match filters</div>
              )}
            </div>
            
            {/* Matrix Actions */}
            {selectedNodes.size > 0 && (
              <div className="flex items-center gap-3 pt-3 border-t mt-2">
                <Button variant="outline" size="sm" onClick={() => {
                  selectedNodes.forEach(id => handlePinNode(id));
                  setSelectedNodes(new Set());
                }}>
                  <Star className="h-4 w-4 mr-1" /> Pin selected ({selectedNodes.size})
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedNodes(new Set())}>
                  Reset selection
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Grouped Node List */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">DETAILS LIST (Work View)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {/* List Header */}
            <div className="grid grid-cols-[80px_1fr_140px_140px_140px_60px] gap-3 items-center py-2 px-3 text-xs font-medium text-muted-foreground border-b-2">
              <div>STATUS</div>
              <div>NODE</div>
              <div className="flex items-center gap-1"><Cpu className="h-3 w-3" /> CPU</div>
              <div className="flex items-center gap-1"><MemoryStick className="h-3 w-3" /> RAM</div>
              <div className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> DISK</div>
              <div>WORST</div>
            </div>
            
            {/* Groups */}
            <div className="max-h-[500px] overflow-y-auto">
              {Object.entries(groupedNodes).map(([groupName, groupNodes]) => (
                <div key={groupName}>
                  {/* Group Header */}
                  <button 
                    className="w-full flex items-center gap-2 py-2 px-3 bg-muted/50 hover:bg-muted font-medium text-sm"
                    onClick={() => toggleGroup(groupName)}
                  >
                    {collapsedGroups.has(groupName) 
                      ? <ChevronRight className="h-4 w-4" /> 
                      : <ChevronDown className="h-4 w-4" />}
                    {groupName} ({groupNodes.length})
                  </button>
                  
                  {/* Group Nodes */}
                  {!collapsedGroups.has(groupName) && groupNodes.map(node => (
                    <NodeListRow 
                      key={node.nodeId}
                      node={node}
                      isSelected={selectedNodes.has(node.nodeId)}
                      onSelect={(id) => handleSelectNode(id, false)}
                    />
                  ))}
                </div>
              ))}
              
              {Object.keys(groupedNodes).length === 0 && (
                <div className="py-8 text-center text-muted-foreground">No nodes match filters</div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Node Details Drawer */}
        <NodeDetailsDrawer 
          node={drawerNode}
          timeseries={drawerTimeseries}
          onClose={() => setDrawerNode(null)}
        />
      </div>
    </main>
  );
}
