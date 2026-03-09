"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { OsDistributionChart } from "@/components/OsDistributionChart";
import { getAuthHeader } from "@/lib/auth-context";
import { apiClient } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NodeTree } from "@/components/NodeTree";
import { GlobalSearch } from "@/components/GlobalSearch";
import { PerformanceTab } from "@/components/performance-tab";
import Link from "next/link";
import { Package, Briefcase, FolderTree, RefreshCw, Activity, AlertCircle, Monitor, Cpu, HardDrive, Shield, Globe, Cookie, Users, MemoryStick, TrendingUp, Search, Plus, Bug, Bell as BellIcon, Zap, Star, Clock } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";
import { useRecentlyOpened } from "@/hooks/useRecentlyOpened";
import { useAuth } from "@/lib/auth-context";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from "recharts";
import { toast } from "sonner";

// Skeleton Components for Loading State
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div>
      {/* Header Skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-24" />
      </div>

      {/* KPI Cards Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-16" />
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Metrics Skeleton */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-32 mb-2" />
              <Skeleton className="h-8 w-20" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Skeleton */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface DashboardSummary {
  counts: {
    total: number;
    online: number;
    away: number;
    offline: number;
    unassigned: number;
  };
  recent_events: Array<{
    type: string;
    subject: string;
    subject_id: string;
    timestamp: string | null;
  }>;
  vulnerabilities?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  jobs?: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    success: number;
  };
}

interface MetricsSummary {
  nodesWithMetrics: number;
  totalNodes: number;
  fleetAverages: {
    cpuPercent: number | null;
    ramPercent: number | null;
    diskPercent: number | null;
  };
  nodes: Array<{
    nodeId: string;
    hostname: string;
    cpuPercent: number | null;
    ramPercent: number | null;
    diskPercent: number | null;
  }>;
}

export default function HomePage() {
  const router = useRouter();
  const { isAdmin, user } = useAuth();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [timeseries, setTimeseries] = useState<{timeseries: Array<{time: string; cpu: number; ram: number; disk: number; nodes: number}>; current: {cpu: number; ram: number; disk: number}} | null>(null);
  const [sqlCatalog, setSqlCatalog] = useState<{versions: Array<{version: string; count: number; latestCu: number}>; total: number} | null>(null);
  const [nodeData, setNodeData] = useState<any>(null);
  const [hardware, setHardware] = useState<any>(null);
  const [software, setSoftware] = useState<any[]>([]);
  const [security, setSecurity] = useState<any>(null);
  const [network, setNetwork] = useState<any>(null);
  const [browser, setBrowser] = useState<any>(null);
  const [hotfixes, setHotfixes] = useState<any>({ hotfixes: [], updateHistory: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [systemHealth, setSystemHealth] = useState<{status: string, database: string} | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [taskCounts, setTaskCounts] = useState<{ approvals: number; findings: number; failedJobs: number; offline: number } | null>(null);
  const [eventStats, setEventStats] = useState<{ stats: Array<{ event_type: string; count: number }>; retention: any } | null>(null);
  const { favorites } = useFavorites();
  const { recent } = useRecentlyOpened();

  // Time-based greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 22) return "Good evening";
    return "Good night";
  }, []);

  

  function getHeaders() {
    return getAuthHeader();
  }

  useEffect(() => {
    fetchSummary();
    fetchMetrics();
    fetchTimeseries();
    fetchSqlCatalog();
    fetchSystemHealth();
    fetchRecentAlerts();
    fetchTaskCounts();
    fetchEventStats();
  }, []);

  useEffect(() => {
    if (selectedNodeId) {
      setActiveTab("overview");
      fetchFullNodeData(selectedNodeId);
    } else {
      setNodeData(null);
      setHardware(null);
      setSoftware([]);
      setSecurity(null);
      setNetwork(null);
      setBrowser(null);
      setHotfixes({ hotfixes: [], updateHistory: [] });
    }
  }, [selectedNodeId]);

  async function fetchSummary() {
    try {
      const data = await apiClient.get<DashboardSummary>("/dashboard/summary");
      if (data) setSummary(data);
    } catch (e) {
      console.error("Failed to fetch summary:", e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSystemHealth() {
    const data = await apiClient.get<any>("/health", { showErrorToast: false });
    if (data) setSystemHealth(data);
    else setSystemHealth({ status: 'error', database: 'unknown' });
  }

  async function fetchRecentAlerts() {
    const data = await apiClient.get<any[]>("/alert-history?limit=5");
    if (data) setRecentAlerts(data);
  }

  async function fetchTaskCounts() {
    const c = { approvals: 0, findings: 0, failedJobs: 0, offline: 0 };
    const results = await Promise.allSettled([
      apiClient.get<{ pending: any[] }>("/pending-nodes"),
      apiClient.get<{ findings: any[]; total: number }>("/security/findings?severity=critical&limit=1"),
      apiClient.get<{ jobs: any[] }>("/jobs?status=failed&limit=1"),
      apiClient.get<{ nodes: any[] }>("/nodes"),
    ]);
    if (results[0].status === "fulfilled" && results[0].value?.pending) c.approvals = results[0].value.pending.length;
    if (results[1].status === "fulfilled" && results[1].value) c.findings = results[1].value.total || results[1].value.findings?.length || 0;
    if (results[2].status === "fulfilled" && results[2].value?.jobs) c.failedJobs = results[2].value.jobs.length;
    if (results[3].status === "fulfilled" && results[3].value?.nodes) {
      const TEN_MINUTES = 10 * 60 * 1000;
      c.offline = results[3].value.nodes.filter((n: any) => {
        if (n.status === "online") return false;
        if (n.last_seen && (Date.now() - new Date(n.last_seen).getTime()) < TEN_MINUTES) return false;
        return true;
      }).length;
    }
    setTaskCounts(c);
  }

  async function fetchEventStats() {
    try {
      const data = await apiClient.get<{ stats: Array<{ event_type: string; count: number }>; retention: any }>("/events/stats");
      if (data) setEventStats(data);
    } catch (e) {
      console.error("Failed to fetch event stats:", e);
    }
  }

  async function fetchMetrics() {
    const data = await apiClient.get<MetricsSummary>("/metrics/summary");
    if (data) setMetrics(data);
  }

  async function fetchSqlCatalog() {
    const data = await apiClient.get<any>("/mssql/cumulative-updates");
    if (data) {
      const cus = data.cumulativeUpdates || [];
      const byVersion: Record<string, {count: number; latestCu: number}> = {};
      cus.forEach((cu: any) => {
        if (!byVersion[cu.version]) {
          byVersion[cu.version] = { count: 0, latestCu: 0 };
        }
        byVersion[cu.version].count++;
        if (cu.cu_number > byVersion[cu.version].latestCu) {
          byVersion[cu.version].latestCu = cu.cu_number;
        }
      });
      const versions = Object.entries(byVersion)
        .map(([version, data]) => ({ version, ...data }))
        .sort((a, b) => b.version.localeCompare(a.version));
      setSqlCatalog({ versions, total: cus.length });
    }
  }

  async function fetchTimeseries() {
    const data = await apiClient.get<any>("/metrics/timeseries?hours=1&bucket_minutes=5");
    if (data) setTimeseries(data);
  }

  async function fetchFullNodeData(nodeId: string) {
    try {
      const [nodeData, hwData, swData, secData, netData, brData, hfData] = await Promise.all([
        apiClient.get<any>(`/nodes/${nodeId}`),
        apiClient.get<any>(`/inventory/hardware/${nodeId}`),
        apiClient.get<any>(`/inventory/software/${nodeId}`),
        apiClient.get<any>(`/inventory/security/${nodeId}`),
        apiClient.get<any>(`/inventory/network/${nodeId}`),
        apiClient.get<any>(`/inventory/browser/${nodeId}`),
        apiClient.get<any>(`/inventory/hotfixes/${nodeId}`),
      ]);

      if (nodeData) setNodeData(nodeData);
      if (hwData) setHardware(hwData.data || hwData);
      if (swData) setSoftware(swData.data?.installedPrograms || swData.data?.software || swData.software || swData.installedPrograms || swData.data || swData || []);
      if (secData) setSecurity(secData.data || secData);
      if (netData) setNetwork(netData.data || netData);
      if (brData) setBrowser(brData.data || brData);
      if (hfData) {
        const resolved = hfData.data || hfData;
        setHotfixes({
          hotfixes: resolved.hotfixes || [],
          updateHistory: resolved.updateHistory || []
        });
      }
    } catch (e) {
      console.error("Failed to fetch node data:", e);
    }
  }

  function handleNodeSelect(nodeId: string) {
    router.push(`/nodes/${nodeId}`);
  }

  function formatRelativeTime(timestamp: string | null) {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMinutes = (now.getTime() - date.getTime()) / 1000 / 60;
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${Math.floor(diffMinutes)}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  }

  function getStatusBadge(lastSeen: string) {
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = (now.getTime() - date.getTime()) / 1000 / 60;
    if (diffMinutes < 5) return <Badge className="bg-green-600">Online</Badge>;
    if (diffMinutes < 60) return <Badge className="bg-yellow-600">Away</Badge>;
    return <Badge variant="secondary">Offline</Badge>;
  }

  // Info row helper
  const InfoRow = ({ label, value }: { label: string; value: any }) => (
    <div className="flex justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right max-w-[60%] truncate" title={String(value)}>{value ?? "-"}</span>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Node Tree */}
        <aside className="w-64 border-r overflow-y-auto bg-muted/30">
          <div className="p-3 border-b flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <GlobalSearch onNodeSelect={handleNodeSelect} />
          </div>
          <div className="p-2 border-b">
            <h2 className="text-sm font-semibold text-muted-foreground px-2">Nodes</h2>
          </div>
          <NodeTree 
            onNodeSelect={handleNodeSelect} 
            selectedNodeId={selectedNodeId || undefined}
          />
        </aside>

        {/* Main Area */}
        <main className="flex-1 overflow-y-auto p-6">
          {selectedNodeId && nodeData ? (
            /* Full Node Detail View with Tabs */
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold">{nodeData.hostname}</h2>
                    {getStatusBadge(nodeData.last_seen)}
                  </div>
                  <p className="text-muted-foreground text-sm">{nodeData.node_id}</p>
                </div>
                <Button variant="outline" onClick={() => setSelectedNodeId(null)}>
                  ← Zurück zum Dashboard
                </Button>
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="mb-4 flex-wrap h-auto gap-1">
                  <TabsTrigger value="overview" className="gap-1"><Monitor className="h-4 w-4" /> Übersicht</TabsTrigger>
                  <TabsTrigger value="performance" className="gap-1"><TrendingUp className="h-4 w-4" /> Performance</TabsTrigger>
                  <TabsTrigger value="hardware" className="gap-1"><Cpu className="h-4 w-4" /> Hardware</TabsTrigger>
                  <TabsTrigger value="software" className="gap-1"><Package className="h-4 w-4" /> Software ({software.length})</TabsTrigger>
                  <TabsTrigger value="security" className="gap-1"><Shield className="h-4 w-4" /> Sicherheit</TabsTrigger>
                  <TabsTrigger value="network" className="gap-1"><Globe className="h-4 w-4" /> Netzwerk</TabsTrigger>
                  <TabsTrigger value="browser" className="gap-1"><Cookie className="h-4 w-4" /> Browser</TabsTrigger>
                  <TabsTrigger value="updates" className="gap-1"><HardDrive className="h-4 w-4" /> Updates ({hotfixes.hotfixes?.length || 0})</TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Card>
                      <CardHeader><CardTitle className="text-lg">System</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <InfoRow label="OS" value={`${nodeData.os_name || ''} ${nodeData.os_version || ''}`} />
                        <InfoRow label="Build" value={nodeData.os_build} />
                        <InfoRow label="Agent" value={nodeData.agent_version} />
                        <InfoRow label="First Seen" value={formatRelativeTime(nodeData.first_seen)} />
                        <InfoRow label="Last Seen" value={formatRelativeTime(nodeData.last_seen)} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle className="text-lg">Hardware</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <InfoRow label="CPU" value={hardware?.cpu?.name} />
                        <InfoRow label="Kerne" value={hardware?.cpu?.cores} />
                        <InfoRow label="RAM" value={hardware?.ram?.totalGB ? `${hardware.ram.totalGB} GB` : (hardware?.ram?.totalGb ? `${hardware.ram.totalGb.toFixed(1)} GB` : null)} />
                        <InfoRow label="GPUs" value={hardware?.gpu?.length || 0} />
                      </CardContent>
                    </Card>
                    <Card className={!nodeData.groups?.length ? "border-yellow-500/50" : ""}>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Gruppen
                          {!nodeData.groups?.length && (
                            <Badge variant="outline" className="text-yellow-500 border-yellow-500 ml-auto">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Nicht zugeordnet
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {nodeData.groups?.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {nodeData.groups.map((g: any) => (
                              <Badge key={g.id} variant="secondary">{g.name}</Badge>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm">
                            <p className="text-muted-foreground mb-2">Dieser Node ist keiner Gruppe zugeordnet.</p>
                            <Button variant="outline" size="sm" asChild>
                              <Link href="/groups">Gruppen verwalten →</Link>
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* Performance Tab */}
                <TabsContent value="performance">
                  {selectedNodeId && <PerformanceTab nodeId={selectedNodeId} />}
                </TabsContent>

                {/* Hardware Tab */}
                <TabsContent value="hardware">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                      <CardHeader><CardTitle>🖥️ CPU</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <InfoRow label="Name" value={hardware?.cpu?.name} />
                        <InfoRow label="Kerne" value={hardware?.cpu?.cores} />
                        <InfoRow label="Threads" value={hardware?.cpu?.logicalProcessors} />
                        <InfoRow label="Takt" value={hardware?.cpu?.maxClockSpeed ? `${hardware.cpu.maxClockSpeed} MHz` : null} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>💾 RAM</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <InfoRow label="Gesamt" value={hardware?.ram?.totalGB ? `${hardware.ram.totalGB} GB` : (hardware?.ram?.totalGb ? `${hardware.ram.totalGb.toFixed(1)} GB` : null)} />
                        <InfoRow label="Module" value={hardware?.ram?.modules?.length || 0} />
                        {hardware?.ram?.modules?.slice(0, 4).map((m: any, i: number) => (
                          <InfoRow key={i} label={`Slot ${i+1}`} value={`${m.capacityGB} GB ${m.memoryType || ''}`} />
                        ))}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>🎮 GPUs</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-2">
                        {hardware?.gpu?.length > 0 ? hardware.gpu.map((g: any, i: number) => (
                          <div key={i} className="border-b pb-2 last:border-0">
                            <p className="font-medium">{g.name}</p>
                            <p className="text-muted-foreground text-xs">{g.videoMemoryGB ? `${g.videoMemoryGB} GB VRAM` : ''} • {g.driverVersion || ''}</p>
                          </div>
                        )) : <p className="text-muted-foreground">Keine GPUs</p>}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>💿 Laufwerke</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-2">
                        {hardware?.disks?.physicalDisks?.length > 0 ? hardware.disks.physicalDisks.map((d: any, i: number) => (
                          <div key={i} className="border-b pb-2 last:border-0">
                            <p className="font-medium">{d.model || d.friendlyName || `Disk ${i+1}`}</p>
                            <p className="text-muted-foreground text-xs">{d.sizeGB ? `${d.sizeGB} GB` : ''} • {d.mediaType || d.busType}</p>
                          </div>
                        )) : hardware?.disks?.volumes?.length > 0 ? hardware.disks.volumes.slice(0, 5).map((v: any, i: number) => (
                          <div key={i} className="border-b pb-2 last:border-0">
                            <p className="font-medium">{v.driveLetter} {v.volumeName || ''}</p>
                            <p className="text-muted-foreground text-xs">{v.sizeGB ? `${v.sizeGB.toFixed(0)} GB` : ''} • {v.freeGB ? `${v.freeGB.toFixed(0)} GB frei` : ''}</p>
                          </div>
                        )) : <p className="text-muted-foreground">Keine Disks</p>}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* Software Tab */}
                <TabsContent value="software">
                  <Card>
                    <CardHeader><CardTitle>📦 Installierte Software ({software.length})</CardTitle></CardHeader>
                    <CardContent>
                      <div className="max-h-[500px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Version</TableHead>
                              <TableHead>Publisher</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {software.slice(0, 100).map((sw: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{sw.name}</TableCell>
                                <TableCell className="font-mono text-xs">{sw.version}</TableCell>
                                <TableCell className="text-muted-foreground">{sw.publisher}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {software.length > 100 && (
                          <p className="text-muted-foreground text-sm mt-2">... und {software.length - 100} weitere</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Security Tab */}
                <TabsContent value="security">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                      <CardHeader><CardTitle>🛡️ Windows Defender</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <InfoRow label="Antivirus" value={security?.defender?.antivirusEnabled ? "✅ Aktiv" : "❌ Inaktiv"} />
                        <InfoRow label="Echtzeitschutz" value={security?.defender?.realTimeProtection ? "✅ Aktiv" : "❌ Inaktiv"} />
                        <InfoRow label="Signaturen" value={security?.defender?.signatureVersion} />
                        <InfoRow label="Letztes Update" value={security?.defender?.lastSignatureUpdate} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>🔥 Firewall</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        {security?.firewall?.profiles ? (
                          Array.isArray(security.firewall.profiles) 
                            ? security.firewall.profiles.map((p: any, i: number) => (
                                <InfoRow key={i} label={p.name} value={p.enabled ? "✅ Aktiv" : "❌ Inaktiv"} />
                              ))
                            : Object.entries(security.firewall.profiles).map(([name, data]: [string, any]) => (
                                <InfoRow key={name} label={name} value={data?.enabled ? "✅ Aktiv" : "❌ Inaktiv"} />
                              ))
                        ) : <p className="text-muted-foreground">Keine Daten</p>}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>👤 Benutzer</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        <InfoRow label="Angemeldet" value={security?.users?.currentUser} />
                        <InfoRow label="Admins" value={security?.users?.localAdmins?.join(", ")} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>🔐 BitLocker</CardTitle></CardHeader>
                      <CardContent className="text-sm space-y-1">
                        {security?.bitlocker?.volumes?.length > 0 ? security.bitlocker.volumes.map((v: any, i: number) => (
                          <InfoRow key={i} label={v.mountPoint || `Volume ${i+1}`} value={v.protectionStatus || v.encryptionPercentage + "%"} />
                        )) : <p className="text-muted-foreground">Keine BitLocker-Volumes</p>}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* Network Tab */}
                <TabsContent value="network">
                  <div className="grid gap-4 md:grid-cols-2">
                    {(hardware?.nics?.adapters?.length > 0 ? hardware.nics.adapters : network?.adapters)?.map((nic: any, i: number) => (
                      <Card key={i}>
                        <CardHeader><CardTitle className="text-lg">{nic.name || nic.description}</CardTitle></CardHeader>
                        <CardContent className="text-sm space-y-1">
                          <InfoRow label="Status" value={nic.connectionStatus || nic.status} />
                          <InfoRow label="MAC" value={nic.macAddress} />
                          <InfoRow label="Speed" value={nic.speedMbps ? `${nic.speedMbps} Mbps` : nic.linkSpeed} />
                          <InfoRow label="Typ" value={nic.adapterType || nic.type} />
                        </CardContent>
                      </Card>
                    )) || <p className="text-muted-foreground col-span-2">Keine Netzwerkadapter</p>}
                    
                    {/* Network Connections Summary */}
                    {network?.connections && (
                      <Card className="md:col-span-2">
                        <CardHeader><CardTitle>🌐 Verbindungen ({network.connections.total})</CardTitle></CardHeader>
                        <CardContent className="text-sm">
                          <div className="flex gap-4 flex-wrap">
                            {network.connections.summary?.map((s: any, i: number) => (
                              <Badge key={i} variant="outline">{s.state}: {s.count}</Badge>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                {/* Browser Tab */}
                <TabsContent value="browser">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {browser?.users && Object.entries(browser.users).map(([userName, browsers]: [string, any]) => (
                      Object.entries(browsers).map(([browserName, data]: [string, any]) => {
                        const profile = data.profiles?.[0];
                        return (
                          <Card key={`${userName}-${browserName}`}>
                            <CardHeader>
                              <CardTitle className="text-lg">
                                {browserName === 'Chrome' ? '🌐' : browserName === 'Edge' ? '📘' : '🦊'} {browserName}
                              </CardTitle>
                              <CardDescription>User: {userName}</CardDescription>
                            </CardHeader>
                            <CardContent className="text-sm space-y-1">
                              <InfoRow label="Profile" value={profile?.name || data.profiles?.length || 0} />
                              <InfoRow label="Verlauf" value={profile?.historyCount || 0} />
                              <InfoRow label="Lesezeichen" value={profile?.bookmarkCount || 0} />
                              <InfoRow label="Passwörter" value={profile?.passwordCount || "-"} />
                              <InfoRow label="Extensions" value={data.extensionCount || 0} />
                            </CardContent>
                          </Card>
                        );
                      })
                    ))}
                    {(!browser?.users || Object.keys(browser.users).length === 0) && (
                      <p className="text-muted-foreground col-span-3">Keine Browser-Daten</p>
                    )}
                  </div>
                </TabsContent>

                {/* Updates Tab */}
                <TabsContent value="updates">
                  <Card>
                    <CardHeader><CardTitle>🔄 Installierte Updates ({hotfixes.hotfixes?.length || 0})</CardTitle></CardHeader>
                    <CardContent>
                      <div className="max-h-[400px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Hotfix ID</TableHead>
                              <TableHead>Beschreibung</TableHead>
                              <TableHead>Installiert am</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {hotfixes.hotfixes?.slice(0, 50).map((hf: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="font-mono">{hf.hotfixId}</TableCell>
                                <TableCell>{hf.description}</TableCell>
                                <TableCell>{hf.installedOn}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            /* Dashboard Overview */
            loading ? (
              <DashboardSkeleton />
            ) : (
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-extrabold tracking-tight text-foreground">{greeting}{user?.username ? `, ${user.username}` : ""}</h2>
                  <p className="text-muted-foreground flex items-center gap-2">
                    <Monitor className="h-4 w-4" /> Global Fleet Overview
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="shadow-sm" onClick={() => { fetchSummary(); fetchMetrics(); fetchTimeseries(); fetchSqlCatalog(); fetchTaskCounts(); }}>
                    <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                  </Button>
                </div>
              </div>

              {/* Today's Tasks Widget */}
              {taskCounts && (taskCounts.approvals + taskCounts.findings + taskCounts.failedJobs + taskCounts.offline > 0) && (
                <Card className="mb-6 border-zinc-800 bg-zinc-900/50">
                  <CardContent className="p-4 flex items-center gap-4 flex-wrap">
                    <AlertCircle className="h-5 w-5 text-orange-400" />
                    <span className="text-sm font-medium text-foreground">Today&apos;s Tasks:</span>
                    <div className="flex items-center gap-3 flex-wrap text-sm">
                      {taskCounts.approvals > 0 && (
                        <Link href="/tasks" className="text-orange-400 hover:underline">{taskCounts.approvals} pending approval{taskCounts.approvals !== 1 ? "s" : ""}</Link>
                      )}
                      {taskCounts.findings > 0 && (
                        <Link href="/tasks" className="text-red-400 hover:underline">{taskCounts.findings} critical finding{taskCounts.findings !== 1 ? "s" : ""}</Link>
                      )}
                      {taskCounts.failedJobs > 0 && (
                        <Link href="/tasks" className="text-yellow-400 hover:underline">{taskCounts.failedJobs} failed job{taskCounts.failedJobs !== 1 ? "s" : ""}</Link>
                      )}
                      {taskCounts.offline > 0 && (
                        <Link href="/tasks" className="text-zinc-400 hover:underline">{taskCounts.offline} offline device{taskCounts.offline !== 1 ? "s" : ""}</Link>
                      )}
                    </div>
                    <Link href="/tasks" className="ml-auto text-xs text-muted-foreground hover:text-foreground">View all →</Link>
                  </CardContent>
                </Card>
              )}

              {/* Quick Actions */}
              {isAdmin() && (
                <div className="flex flex-wrap gap-3 mb-6">
                  <Link href="/jobs?new=true" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
                    <Zap className="h-4 w-4" /> New Job
                  </Link>
                  <button
                    onClick={async () => {
                      const res = await apiClient.post("/security/scan", {});
                      if (res) toast.success("Vulnerability scan started");
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                  >
                    <Bug className="h-4 w-4" /> Scan Vulnerabilities
                  </button>
                  <Link href="/alerts" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
                    <BellIcon className="h-4 w-4" /> View Alerts
                  </Link>
                </div>
              )}

              {/* Favorites */}
              <div className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5" /> Favorites
                </h3>
                {favorites.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {favorites.map((fav) => (
                      <Link
                        key={`${fav.type}-${fav.id}`}
                        href={fav.href}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/5 text-sm text-yellow-200 hover:bg-yellow-500/10 hover:border-yellow-500/40 transition-colors"
                      >
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {fav.label}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground/50">⭐ Star your favorite pages, nodes or reports for quick access</p>
                )}
              </div>

              {/* Recently Opened */}
              {recent.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Recently Opened
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {recent.slice(0, 8).map((item, i) => (
                      <Link
                        key={i}
                        href={item.href}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-800/50 text-sm text-zinc-300 hover:bg-zinc-700/50 hover:border-zinc-600 transition-colors"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Bento Grid */}
              <div className="grid grid-cols-12 gap-6">
                
                {/* Fleet Status - 3 cols */}
                <Card className="col-span-12 md:col-span-3 border-primary/10 bg-gradient-to-br from-card to-primary/5 shadow-md">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                      Fleet Status
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-6xl font-black mb-4 tracking-tighter">{summary?.counts.total || 0}</div>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-sm px-3 py-1.5 bg-background/50 rounded-lg border border-border/50">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-muted-foreground">Online</span>
                        </div>
                        <span className="font-bold">{summary?.counts.online || 0}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm px-3 py-1.5 bg-background/50 rounded-lg border border-border/50">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-zinc-500" />
                          <span className="text-muted-foreground">Offline</span>
                        </div>
                        <span className="font-bold">{summary?.counts.offline || 0}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Security - 3 cols */}
                <Card className="col-span-12 md:col-span-3 border-destructive/10 bg-gradient-to-br from-card to-destructive/5 shadow-md">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-destructive">
                      Critical Threats
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-center">
                        <div className="text-2xl font-black text-destructive">{summary?.vulnerabilities?.critical || 0}</div>
                        <div className="text-[10px] uppercase font-bold text-destructive/70">Critical</div>
                      </div>
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-center">
                        <div className="text-2xl font-black text-orange-500">{summary?.vulnerabilities?.high || 0}</div>
                        <div className="text-[10px] uppercase font-bold text-orange-500/70">High Risk</div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="w-full text-xs hover:bg-destructive/5 text-muted-foreground" asChild>
                      <Link href="/vulnerabilities">View Security Reports →</Link>
                    </Button>
                  </CardContent>
                </Card>

                {/* Performance - 6 cols, spans 2 rows */}
                <Card className="col-span-12 md:col-span-6 md:row-span-2 border-border/50 shadow-lg bg-card/50 backdrop-blur-sm">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        <TrendingUp className="h-3.5 w-3.5" /> Fleet Performance
                      </CardDescription>
                      <Link href="/performance" className="text-xs font-semibold text-primary hover:underline">
                        Detailed Analytics →
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {timeseries && timeseries.timeseries?.length > 0 ? (
                      <div className="space-y-6">
                        {/* Fleet Sparklines */}
                        <div className="grid grid-cols-3 gap-4 pb-6 border-b border-border/50">
                          {/* CPU Sparkline */}
                          <div className="bg-background/40 p-3 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">CPU</span>
                              <span className="text-lg font-black text-primary">{timeseries.current?.cpu?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-12">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                                    </linearGradient>
                                  </defs>
                                  <Area type="monotone" dataKey="cpu" stroke="var(--primary)" fill="url(#colorCpu)" strokeWidth={2} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* RAM Sparkline */}
                          <div className="bg-background/40 p-3 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">RAM</span>
                              <span className="text-lg font-black text-green-500">{timeseries.current?.ram?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-12">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="ram" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* Disk Sparkline */}
                          <div className="bg-background/40 p-3 rounded-xl border border-border/30">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">Disk</span>
                              <span className="text-lg font-black text-purple-500">{timeseries.current?.disk?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-12">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="disk" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={2} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>
                        {/* Per-node hotspot matrix */}
                        <div className="space-y-2">
                          <div className="grid grid-cols-[1fr_75px_75px_75px_80px] gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 px-2">
                            <span>Node Endpoint</span>
                            <span className="text-center">CPU</span>
                            <span className="text-center">RAM</span>
                            <span className="text-center">Disk</span>
                            <span className="text-right">Status</span>
                          </div>
                          <div className="max-h-[280px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                            {(Array.isArray(metrics?.nodes) ? metrics.nodes : [])
                              .filter((n: any) => n.cpuPercent !== null || n.ramPercent !== null)
                              .sort((a: any, b: any) => Math.max(b.cpuPercent || 0, b.ramPercent || 0, b.diskPercent || 0) - Math.max(a.cpuPercent || 0, a.ramPercent || 0, a.diskPercent || 0))
                              .slice(0, 12)
                              .map((node: any, i: number) => {
                                const cpu = node.cpuPercent || 0;
                                const ram = node.ramPercent || 0;
                                const disk = node.diskPercent || 0;
                                const worst = Math.max(cpu, ram, disk);
                                const status = worst > 85 ? 'crit' : worst > 70 ? 'warn' : 'ok';
                                
                                const HeatBar = ({ value, colorClass }: { value: number; colorClass: string }) => (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="font-mono text-[11px] w-6 text-right tabular-nums">{Math.round(value)}</span>
                                    <div className="flex gap-0.5 h-3 items-center">
                                      {[1, 2, 3, 4, 5].map((step) => {
                                        const threshold = step * 20;
                                        const isActive = value >= threshold - 10;
                                        return (
                                          <div 
                                            key={step} 
                                            className={`w-1.5 h-full rounded-[1px] transition-colors ${isActive ? colorClass : 'bg-muted/30'}`} 
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                                
                                return (
                                  <div 
                                    key={i} 
                                    className="grid grid-cols-[1fr_75px_75px_75px_80px] gap-2 items-center py-2 px-2 hover:bg-primary/5 rounded-lg border border-transparent hover:border-primary/10 transition-all cursor-pointer group"
                                    onClick={() => handleNodeSelect(node.nodeId)}
                                  >
                                    <span className="font-bold text-xs truncate group-hover:text-primary transition-colors">{node.hostname}</span>
                                    <HeatBar value={cpu} colorClass="bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                                    <HeatBar value={ram} colorClass="bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                    <HeatBar value={disk} colorClass="bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                                    <div className="text-right">
                                      {status === 'crit' ? (
                                        <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[9px] font-bold uppercase py-0 px-1.5">Critical</Badge>
                                      ) : status === 'warn' ? (
                                        <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[9px] font-bold uppercase py-0 px-1.5">Warning</Badge>
                                      ) : (
                                        <span className="text-[10px] font-bold text-muted-foreground/50 uppercase">Healthy</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-muted/10 rounded-xl border border-dashed border-border">
                        <Activity className="h-8 w-8 mb-2 opacity-20" />
                        <p className="text-sm font-medium">No performance data available</p>
                        <p className="text-xs opacity-50">Check agent connections</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
                {/* Jobs 24h - 3 cols */}
                <Card className="col-span-6 md:col-span-3 border-green-500/10 bg-gradient-to-br from-card to-green-500/5 shadow-md hover:shadow-green-500/5 transition-all">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-green-600">
                      <Briefcase className="h-3.5 w-3.5" /> Jobs (24h)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-end gap-6 mb-4">
                      <Link href="/jobs" className="group">
                        <div className="text-4xl font-black text-green-500 group-hover:scale-110 transition-transform origin-left">{summary?.jobs?.success || 0}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Success</div>
                      </Link>
                      <Link href="/jobs" className="group">
                        <div className="text-3xl font-bold text-red-500 group-hover:scale-110 transition-transform origin-left">{summary?.jobs?.failed || 0}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Failed</div>
                      </Link>
                    </div>
                    {(summary?.jobs?.pending || 0) > 0 && (
                      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 text-yellow-600 rounded-md text-[10px] font-bold uppercase border border-yellow-500/20">
                        <Activity className="h-3 w-3 animate-spin" /> {summary?.jobs?.pending} pending
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* SQL Server - 3 cols */}
                <Card className="col-span-6 md:col-span-3 border-blue-500/10 bg-gradient-to-br from-card to-blue-500/5 shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                        🗄️ SQL Lifecycle
                      </CardDescription>
                      <Link href="/sql" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">
                        Manage →
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {sqlCatalog && sqlCatalog.total > 0 ? (
                      <div>
                        <div className="text-4xl font-black mb-1">{sqlCatalog.total}</div>
                        <div className="text-[10px] uppercase font-bold text-muted-foreground mb-3">Syncable CU Updates</div>
                        <div className="flex flex-wrap gap-1.5">
                          {sqlCatalog.versions.slice(0, 3).map((v) => (
                            <Badge key={v.version} variant="outline" className="text-[9px] font-bold bg-background/50 border-blue-500/20">
                              {v.version} • CU{v.latestCu}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40">
                        <Package className="h-8 w-8 mb-1 opacity-20" />
                        <span className="text-[10px] font-bold uppercase">No CUs synced</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Security Events - 3 cols */}
                <Card className="col-span-6 md:col-span-3 border-purple-500/10 bg-gradient-to-br from-card to-purple-500/5 shadow-md hover:shadow-purple-500/5 transition-all">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400">
                        <Shield className="h-3.5 w-3.5" /> Security Events
                      </CardDescription>
                      <Link href="/security/events" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">
                        Details →
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {eventStats && eventStats.stats.length > 0 ? (() => {
                      const prefixMap: Record<string, { label: string; color: string }> = {
                        logon: { label: "Logon", color: "#a78bfa" },
                        network: { label: "Network", color: "#60a5fa" },
                        process: { label: "Process", color: "#34d399" },
                        service: { label: "Service", color: "#fbbf24" },
                        file: { label: "File", color: "#f87171" },
                      };
                      const grouped: Record<string, number> = {};
                      (eventStats.stats || []).forEach((s) => {
                        const key = Object.keys(prefixMap).find((p) => (s.event_type || "").toLowerCase().startsWith(p)) || "other";
                        grouped[key] = (grouped[key] || 0) + (s.count || 0);
                      });
                      const total = Object.values(grouped).reduce((a, b) => a + b, 0) || 0;
                      const entries = Object.entries(prefixMap).filter(([k]) => grouped[k]);
                      return (
                        <div>
                          <div className="text-4xl font-black mb-0.5">{total.toLocaleString()}</div>
                          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-3">Last 7 days</div>
                          {/* Proportion bar */}
                          <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-muted/30">
                            {entries.map(([key, meta]) => (
                              <div
                                key={key}
                                style={{ width: `${total > 0 ? ((grouped[key] || 0) / total) * 100 : 0}%`, backgroundColor: meta.color }}
                                className="transition-all"
                                title={`${meta.label}: ${grouped[key]?.toLocaleString()}`}
                              />
                            ))}
                          </div>
                          <div className="space-y-1">
                            {entries.map(([key, meta]) => (
                              <div key={key} className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                                  <span className="font-medium text-muted-foreground">{meta.label}</span>
                                </div>
                                <span className="font-bold font-mono">{(grouped[key] || 0).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40">
                        <Shield className="h-8 w-8 mb-1 opacity-20" />
                        <span className="text-[10px] font-bold uppercase">No events</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent Alerts - 6 cols */}
                <Card className="col-span-12 md:col-span-6 border-border/50 shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5" /> Fleet Incidents
                      </CardDescription>
                      <Link href="/alerts" className="text-[10px] font-bold text-primary hover:underline uppercase tracking-tighter">
                        Incident Log →
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      {recentAlerts.length > 0 ? recentAlerts.slice(0, 4).map((alert: any) => (
                        <div key={alert.id} className="flex items-center justify-between py-2 px-2 hover:bg-muted/30 rounded-lg transition-colors border-b border-border/10 last:border-0">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full shadow-[0_0_8px] ${
                              alert.event_type === 'node_offline' ? 'bg-red-500 shadow-red-500/50' :
                              alert.event_type === 'node_online' ? 'bg-green-500 shadow-green-500/50' :
                              alert.event_type === 'job_failed' ? 'bg-orange-500 shadow-orange-500/50' :
                              'bg-blue-500 shadow-blue-500/50'
                            }`} />
                            <span className="text-xs font-medium truncate max-w-[280px]">{alert.message || alert.event_type}</span>
                          </div>
                          <span className="text-[10px] font-bold font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {new Date(alert.sent_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )) : (
                        <div className="text-center py-6 text-xs text-muted-foreground/50 italic font-medium uppercase tracking-widest">
                          No recent incidents
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* System Health - 6 cols */}
                <Card className="col-span-12 md:col-span-6 border-border/50 shadow-md">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      <Activity className="h-3.5 w-3.5" /> Infrastructure Health
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border/30">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${systemHealth?.status === 'ok' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-ping'}`} />
                          <span className="text-xs font-bold uppercase tracking-tighter">Core API</span>
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-black uppercase ${systemHealth?.status === 'ok' ? 'text-green-600 border-green-500/20' : 'text-red-400 border-red-500/20'}`}>
                          {systemHealth?.status || 'OFFLINE'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl border border-border/30">
                        <div className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${systemHealth?.database === 'connected' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-ping'}`} />
                          <span className="text-xs font-bold uppercase tracking-tighter">Database</span>
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-black uppercase ${systemHealth?.database === 'connected' ? 'text-green-600 border-green-500/20' : 'text-red-400 border-red-500/20'}`}>
                          {systemHealth?.database === 'connected' ? 'ONLINE' : 'ERROR'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

              </div>
            </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}
