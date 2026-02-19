"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { OsDistributionChart } from "@/components/OsDistributionChart";
import { getAuthHeader } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NodeTree } from "@/components/NodeTree";
import { GlobalSearch } from "@/components/GlobalSearch";
import { PerformanceTab } from "@/components/performance-tab";
import Link from "next/link";
import { Package, Briefcase, FolderTree, RefreshCw, Activity, AlertCircle, Monitor, Cpu, HardDrive, Shield, Globe, Cookie, Users, MemoryStick, TrendingUp, Search } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from "recharts";

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

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

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
      const res = await fetch(`${API_BASE}/api/v1/dashboard/summary`, { headers: getHeaders() });
      if (res.ok) setSummary(await res.json());
    } catch (e) {
      console.error("Failed to fetch summary:", e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSystemHealth() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/health`);
      if (res.ok) setSystemHealth(await res.json());
    } catch (e) {
      setSystemHealth({ status: 'error', database: 'unknown' });
    }
  }

  async function fetchRecentAlerts() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/alert-history?limit=5`, { headers: getHeaders() });
      if (res.ok) setRecentAlerts(await res.json());
    } catch (e) {
      console.error("Failed to fetch alerts:", e);
    }
  }

  async function fetchMetrics() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/metrics/summary`, { headers: getHeaders() });
      if (res.ok) setMetrics(await res.json());
    } catch (e) {
      console.error("Failed to fetch metrics:", e);
    }
  }

  async function fetchSqlCatalog() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/cumulative-updates`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const cus = data.cumulativeUpdates || [];
        // Group by version
        const byVersion: Record<string, {count: number; latestCu: number}> = {};
        cus.forEach((cu: any) => {
          if (!byVersion[cu.version]) {
            byVersion[cu.version] = { count: 0, latestCu: 0 };
          }
          byVersion[cu.version].count++;
          if (cu.cuNumber > byVersion[cu.version].latestCu) {
            byVersion[cu.version].latestCu = cu.cuNumber;
          }
        });
        const versions = Object.entries(byVersion)
          .map(([version, data]) => ({ version, ...data }))
          .sort((a, b) => b.version.localeCompare(a.version));
        setSqlCatalog({ versions, total: cus.length });
      }
    } catch (e) {
      console.error("Failed to fetch SQL catalog:", e);
    }
  }

  async function fetchTimeseries() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/metrics/timeseries?hours=1&bucket_minutes=5`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTimeseries(data);
      }
    } catch (e) {
      console.error("Failed to fetch timeseries:", e);
    }
  }

  async function fetchFullNodeData(nodeId: string) {
    try {
      // Fetch all data in parallel - use correct inventory endpoints
      const [nodeRes, hwRes, swRes, secRes, netRes, brRes, hfRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/nodes/${nodeId}`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/v1/inventory/hardware/${nodeId}`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/v1/inventory/software/${nodeId}`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/v1/inventory/security/${nodeId}`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/v1/inventory/network/${nodeId}`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/v1/inventory/browser/${nodeId}`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/v1/inventory/hotfixes/${nodeId}`, { headers: getHeaders() }),
      ]);

      if (nodeRes.ok) setNodeData(await nodeRes.json());
      if (hwRes.ok) {
        const hwData = await hwRes.json();
        setHardware(hwData.data || hwData);  // Handle both {data: {...}} and direct format
      }
      if (swRes.ok) {
        const swData = await swRes.json();
        setSoftware(swData.data?.installedPrograms || swData.data?.software || swData.software || swData.installedPrograms || swData.data || swData || []);
      }
      if (secRes.ok) {
        const secData = await secRes.json();
        setSecurity(secData.data || secData);
      }
      if (netRes.ok) {
        const netData = await netRes.json();
        setNetwork(netData.data || netData);
      }
      if (brRes.ok) {
        const brData = await brRes.json();
        setBrowser(brData.data || brData);
      }
      if (hfRes.ok) {
        const hfData = await hfRes.json();
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
    setSelectedNodeId(nodeId);
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
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold">Dashboard</h2>
                  <p className="text-muted-foreground">Fleet Overview</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { fetchSummary(); fetchMetrics(); fetchTimeseries(); fetchSqlCatalog(); }}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
              </div>

              {/* Bento Grid */}
              <div className="grid grid-cols-12 gap-4">
                
                {/* Fleet Status - 3 cols */}
                <Card className="col-span-12 md:col-span-3 bg-gradient-to-br from-background to-muted/30">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                      <Monitor className="h-3.5 w-3.5" /> Fleet Status
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="text-5xl font-bold mb-3">{summary?.counts.total || 0}</div>
                    <div className="flex gap-4 text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-muted-foreground">{summary?.counts.online || 0} online</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-gray-400" />
                        <span className="text-muted-foreground">{summary?.counts.offline || 0} offline</span>
                      </div>
                    </div>
                    {summary?.counts.unassigned ? (
                      <div className="mt-3 text-xs text-yellow-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {summary.counts.unassigned} unassigned
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                {/* Security - 3 cols */}
                <Card className="col-span-12 md:col-span-3 bg-gradient-to-br from-background to-red-500/5">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                      <Shield className="h-3.5 w-3.5" /> Security
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <Link href="/vulnerabilities" className="flex items-center justify-between hover:bg-muted/50 rounded p-1.5 -mx-1.5 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        <span className="text-sm">Critical</span>
                      </div>
                      <span className="text-2xl font-bold text-red-500">{summary?.vulnerabilities?.critical || 0}</span>
                    </Link>
                    <Link href="/vulnerabilities" className="flex items-center justify-between hover:bg-muted/50 rounded p-1.5 -mx-1.5 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                        <span className="text-sm">High</span>
                      </div>
                      <span className="text-xl font-semibold text-orange-500">{summary?.vulnerabilities?.high || 0}</span>
                    </Link>
                    <Link href="/vulnerabilities" className="flex items-center justify-between hover:bg-muted/50 rounded p-1.5 -mx-1.5 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                        <span className="text-sm">Medium</span>
                      </div>
                      <span className="text-lg text-yellow-600">{summary?.vulnerabilities?.medium || 0}</span>
                    </Link>
                  </CardContent>
                </Card>

                {/* Performance - 6 cols, spans 2 rows */}
                <Card className="col-span-12 md:col-span-6 md:row-span-2">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                        <TrendingUp className="h-3.5 w-3.5" /> Performance
                      </CardDescription>
                      <Link href="/performance" className="text-xs text-muted-foreground hover:text-primary">
                        Details →
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {timeseries && timeseries.timeseries?.length > 0 ? (
                      <div className="space-y-3">
                        {/* Fleet Sparklines */}
                        <div className="grid grid-cols-3 gap-3 pb-3 border-b">
                          {/* CPU Sparkline */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">CPU</span>
                              <span className="text-sm font-semibold text-blue-500">{timeseries.current?.cpu?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-10">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={1.5} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* RAM Sparkline */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">RAM</span>
                              <span className="text-sm font-semibold text-green-500">{timeseries.current?.ram?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-10">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="ram" stroke="#22c55e" fill="#22c55e" fillOpacity={0.2} strokeWidth={1.5} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          {/* Disk Sparkline */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">Disk</span>
                              <span className="text-sm font-semibold text-purple-500">{timeseries.current?.disk?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-10">
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <Area type="monotone" dataKey="disk" stroke="#a855f7" fill="#a855f7" fillOpacity={0.2} strokeWidth={1.5} dot={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>
                        {/* Per-node hotspot matrix */}
                        <div className="space-y-0">
                          {/* Header */}
                          <div className="grid grid-cols-[110px_70px_70px_70px_1fr] gap-2 text-[10px] text-muted-foreground font-medium border-b pb-1 mb-1">
                            <span>NODE</span>
                            <span>CPU</span>
                            <span>RAM</span>
                            <span>DISK</span>
                            <span>WORST</span>
                          </div>
                          {/* Rows */}
                          <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                            {metrics?.nodes
                              ?.filter(n => n.cpuPercent !== null || n.ramPercent !== null)
                              .sort((a, b) => Math.max(b.cpuPercent || 0, b.ramPercent || 0, b.diskPercent || 0) - Math.max(a.cpuPercent || 0, a.ramPercent || 0, a.diskPercent || 0))
                              .slice(0, 8)
                              .map((node, i) => {
                                const cpu = node.cpuPercent || 0;
                                const ram = node.ramPercent || 0;
                                const disk = node.diskPercent || 0;
                                const worst = Math.max(cpu, ram, disk);
                                const worstMetric = ram >= cpu && ram >= disk ? 'RAM' : disk >= cpu ? 'DISK' : 'CPU';
                                const status = worst > 85 ? 'crit' : worst > 70 ? 'warn' : 'ok';
                                
                                const HeatCell = ({ value, type }: { value: number; type: 'cpu' | 'ram' | 'disk' }) => {
                                  const intensity = value > 85 ? 4 : value > 70 ? 3 : value > 40 ? 2 : value > 0 ? 1 : 0;
                                  const colors = {
                                    cpu: ['bg-muted', 'bg-blue-300', 'bg-blue-400', 'bg-blue-600', 'bg-blue-800'],
                                    ram: ['bg-muted', 'bg-green-300', 'bg-green-400', 'bg-green-600', 'bg-green-800'],
                                    disk: ['bg-muted', 'bg-purple-300', 'bg-purple-400', 'bg-purple-600', 'bg-purple-800'],
                                  };
                                  return (
                                    <div className="flex items-center gap-1">
                                      <span className={`font-mono text-[11px] w-6 ${intensity >= 4 ? 'text-red-600 font-bold' : intensity >= 3 ? 'text-yellow-600' : ''}`}>
                                        {Math.round(value)}
                                      </span>
                                      <div className="flex gap-px">
                                        {[1, 2, 3, 4].map((bar) => (
                                          <div 
                                            key={bar} 
                                            className={`w-1.5 h-3 rounded-sm ${bar <= intensity ? colors[type][intensity] : 'bg-muted'}`} 
                                          />
                                        ))}
                                      </div>
                                      {intensity >= 4 && <span className="text-red-600 text-[10px]">‼</span>}
                                      {intensity === 3 && <span className="text-yellow-600 text-[10px]">▲</span>}
                                    </div>
                                  );
                                };
                                
                                return (
                                  <div 
                                    key={i} 
                                    className="grid grid-cols-[110px_70px_70px_70px_1fr] gap-2 items-center py-1 hover:bg-muted/50 rounded cursor-pointer text-xs"
                                    onClick={() => handleNodeSelect(node.nodeId)}
                                  >
                                    <span className="font-medium truncate">{node.hostname}</span>
                                    <HeatCell value={cpu} type="cpu" />
                                    <HeatCell value={ram} type="ram" />
                                    <HeatCell value={disk} type="disk" />
                                    <span className={`text-[11px] ${status === 'crit' ? 'text-red-600 font-medium' : status === 'warn' ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                                      {status === 'ok' ? 'OK' : `Worst: ${worstMetric}`}
                                    </span>
                                  </div>
                                );
                              })}
                          </div>
                          {/* Legend */}
                          <div className="flex items-center gap-3 pt-2 mt-1 border-t text-[9px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1].map(b => <div key={b} className="w-1 h-2 bg-blue-300 rounded-sm" />)}</div>
                              0-40
                            </span>
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1,2].map(b => <div key={b} className="w-1 h-2 bg-blue-400 rounded-sm" />)}</div>
                              41-70
                            </span>
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1,2,3].map(b => <div key={b} className="w-1 h-2 bg-blue-600 rounded-sm" />)}</div>
                              71-85
                            </span>
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1,2,3,4].map(b => <div key={b} className="w-1 h-2 bg-blue-800 rounded-sm" />)}</div>
                              ‼ &gt;85
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : metrics && metrics.nodesWithMetrics > 0 ? (
                      <div className="space-y-3">
                        {/* Fallback to static bars if no timeseries */}
                        <div className="grid grid-cols-3 gap-3 pb-3 border-b">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">CPU</span>
                              <span className="text-sm font-semibold">{metrics.fleetAverages.cpuPercent?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500" style={{ width: `${metrics.fleetAverages.cpuPercent || 0}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">RAM</span>
                              <span className="text-sm font-semibold">{metrics.fleetAverages.ramPercent?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full ${(metrics.fleetAverages.ramPercent || 0) > 80 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${metrics.fleetAverages.ramPercent || 0}%` }} />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground">Disk</span>
                              <span className="text-sm font-semibold">{metrics.fleetAverages.diskPercent?.toFixed(0) || 0}%</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full ${(metrics.fleetAverages.diskPercent || 0) > 80 ? 'bg-red-500' : 'bg-purple-500'}`} style={{ width: `${metrics.fleetAverages.diskPercent || 0}%` }} />
                            </div>
                          </div>
                        </div>
                        {/* Per-node hotspot matrix (fallback) */}
                        <div className="space-y-0">
                          {/* Header */}
                          <div className="grid grid-cols-[110px_70px_70px_70px_1fr] gap-2 text-[10px] text-muted-foreground font-medium border-b pb-1 mb-1">
                            <span>NODE</span>
                            <span>CPU</span>
                            <span>RAM</span>
                            <span>DISK</span>
                            <span>WORST</span>
                          </div>
                          {/* Rows */}
                          <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                            {metrics.nodes
                              .filter(n => n.cpuPercent !== null || n.ramPercent !== null)
                              .sort((a, b) => Math.max(b.cpuPercent || 0, b.ramPercent || 0, b.diskPercent || 0) - Math.max(a.cpuPercent || 0, a.ramPercent || 0, a.diskPercent || 0))
                              .slice(0, 8)
                              .map((node, i) => {
                                const cpu = node.cpuPercent || 0;
                                const ram = node.ramPercent || 0;
                                const disk = node.diskPercent || 0;
                                const worst = Math.max(cpu, ram, disk);
                                const worstMetric = ram >= cpu && ram >= disk ? 'RAM' : disk >= cpu ? 'DISK' : 'CPU';
                                const status = worst > 85 ? 'crit' : worst > 70 ? 'warn' : 'ok';
                                
                                const HeatCell = ({ value, type }: { value: number; type: 'cpu' | 'ram' | 'disk' }) => {
                                  const intensity = value > 85 ? 4 : value > 70 ? 3 : value > 40 ? 2 : value > 0 ? 1 : 0;
                                  const colors = {
                                    cpu: ['bg-muted', 'bg-blue-300', 'bg-blue-400', 'bg-blue-600', 'bg-blue-800'],
                                    ram: ['bg-muted', 'bg-green-300', 'bg-green-400', 'bg-green-600', 'bg-green-800'],
                                    disk: ['bg-muted', 'bg-purple-300', 'bg-purple-400', 'bg-purple-600', 'bg-purple-800'],
                                  };
                                  return (
                                    <div className="flex items-center gap-1">
                                      <span className={`font-mono text-[11px] w-6 ${intensity >= 4 ? 'text-red-600 font-bold' : intensity >= 3 ? 'text-yellow-600' : ''}`}>
                                        {Math.round(value)}
                                      </span>
                                      <div className="flex gap-px">
                                        {[1, 2, 3, 4].map((bar) => (
                                          <div 
                                            key={bar} 
                                            className={`w-1.5 h-3 rounded-sm ${bar <= intensity ? colors[type][intensity] : 'bg-muted'}`} 
                                          />
                                        ))}
                                      </div>
                                      {intensity >= 4 && <span className="text-red-600 text-[10px]">‼</span>}
                                      {intensity === 3 && <span className="text-yellow-600 text-[10px]">▲</span>}
                                    </div>
                                  );
                                };
                                
                                return (
                                  <div 
                                    key={i} 
                                    className="grid grid-cols-[110px_70px_70px_70px_1fr] gap-2 items-center py-1 hover:bg-muted/50 rounded cursor-pointer text-xs"
                                    onClick={() => handleNodeSelect(node.nodeId)}
                                  >
                                    <span className="font-medium truncate">{node.hostname}</span>
                                    <HeatCell value={cpu} type="cpu" />
                                    <HeatCell value={ram} type="ram" />
                                    <HeatCell value={disk} type="disk" />
                                    <span className={`text-[11px] ${status === 'crit' ? 'text-red-600 font-medium' : status === 'warn' ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                                      {status === 'ok' ? 'OK' : `Worst: ${worstMetric}`}
                                    </span>
                                  </div>
                                );
                              })}
                          </div>
                          {/* Legend */}
                          <div className="flex items-center gap-3 pt-2 mt-1 border-t text-[9px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1].map(b => <div key={b} className="w-1 h-2 bg-blue-300 rounded-sm" />)}</div>
                              0-40
                            </span>
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1,2].map(b => <div key={b} className="w-1 h-2 bg-blue-400 rounded-sm" />)}</div>
                              41-70
                            </span>
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1,2,3].map(b => <div key={b} className="w-1 h-2 bg-blue-600 rounded-sm" />)}</div>
                              71-85
                            </span>
                            <span className="flex items-center gap-1">
                              <div className="flex gap-px">{[1,2,3,4].map(b => <div key={b} className="w-1 h-2 bg-blue-800 rounded-sm" />)}</div>
                              ‼ &gt;85
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        No performance data available
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Jobs 24h - 3 cols */}
                <Card className="col-span-6 md:col-span-3 bg-gradient-to-br from-background to-green-500/5">
                  <CardHeader className="pb-3">
                    <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                      <Briefcase className="h-3.5 w-3.5" /> Jobs (24h)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-end gap-4">
                      <Link href="/jobs" className="group">
                        <div className="text-3xl font-bold text-green-500 group-hover:underline">{summary?.jobs?.success || 0}</div>
                        <div className="text-xs text-muted-foreground">success</div>
                      </Link>
                      <Link href="/jobs" className="group">
                        <div className="text-2xl font-semibold text-red-500 group-hover:underline">{summary?.jobs?.failed || 0}</div>
                        <div className="text-xs text-muted-foreground">failed</div>
                      </Link>
                    </div>
                    {(summary?.jobs?.pending || 0) > 0 && (
                      <div className="mt-2 text-xs text-yellow-600">
                        {summary?.jobs?.pending} pending
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* SQL Server - 3 cols */}
                <Card className="col-span-6 md:col-span-3 bg-gradient-to-br from-background to-blue-500/5">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                        🗄️ SQL Server
                      </CardDescription>
                      <Link href="/sql" className="text-xs text-muted-foreground hover:text-primary">
                        Manage →
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {sqlCatalog && sqlCatalog.total > 0 ? (
                      <div>
                        <div className="text-3xl font-bold">{sqlCatalog.total}</div>
                        <div className="text-xs text-muted-foreground mb-2">CUs in catalog</div>
                        <div className="flex flex-wrap gap-1">
                          {sqlCatalog.versions.slice(0, 3).map((v) => (
                            <Badge key={v.version} variant="secondary" className="text-xs">
                              {v.version} CU{v.latestCu}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No CUs synced</div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent Alerts - 6 cols */}
                {recentAlerts.length > 0 && (
                  <Card className="col-span-12 md:col-span-6">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                          <AlertCircle className="h-3.5 w-3.5" /> Recent Alerts
                        </CardDescription>
                        <Link href="/alerts" className="text-xs text-muted-foreground hover:text-primary">
                          View all →
                        </Link>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-1.5">
                        {recentAlerts.slice(0, 4).map((alert: any) => (
                          <div key={alert.id} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                            <div className="flex items-center gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                alert.event_type === 'node_offline' ? 'bg-red-500' :
                                alert.event_type === 'node_online' ? 'bg-green-500' :
                                alert.event_type === 'job_failed' ? 'bg-orange-500' : 'bg-blue-500'
                              }`} />
                              <span className="truncate max-w-[200px]">{alert.message || alert.event_type}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(alert.sent_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* System Health - 6 cols */}
                <Card className="col-span-12 md:col-span-6">
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
                      <Activity className="h-3.5 w-3.5" /> System Health
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${systemHealth?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-sm">API</span>
                        <Badge variant="outline" className="text-xs">{systemHealth?.status || '...'}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${systemHealth?.database === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-sm">Database</span>
                        <Badge variant="outline" className="text-xs">{systemHealth?.database || '...'}</Badge>
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
