"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NodeTree } from "@/components/NodeTree";
import { GlobalSearch } from "@/components/GlobalSearch";
import Link from "next/link";
import { Package, Briefcase, FolderTree, RefreshCw, Activity, AlertCircle, Monitor, Cpu, HardDrive, Shield, Globe, Cookie, Users, MemoryStick, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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
  const [nodeData, setNodeData] = useState<any>(null);
  const [hardware, setHardware] = useState<any>(null);
  const [software, setSoftware] = useState<any[]>([]);
  const [security, setSecurity] = useState<any>(null);
  const [network, setNetwork] = useState<any>(null);
  const [browser, setBrowser] = useState<any>(null);
  const [hotfixes, setHotfixes] = useState<any>({ hotfixes: [], updateHistory: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const API_BASE = "http://192.168.0.5:8080";
  const headers = { "X-API-Key": "openclaw-inventory-dev-key" };

  useEffect(() => {
    fetchSummary();
    fetchMetrics();
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
      const res = await fetch(`${API_BASE}/api/v1/dashboard/summary`, { headers });
      if (res.ok) setSummary(await res.json());
    } catch (e) {
      console.error("Failed to fetch summary:", e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMetrics() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/metrics/summary`, { headers });
      if (res.ok) setMetrics(await res.json());
    } catch (e) {
      console.error("Failed to fetch metrics:", e);
    }
  }

  async function fetchFullNodeData(nodeId: string) {
    try {
      // Fetch all data in parallel - use correct inventory endpoints
      const [nodeRes, hwRes, swRes, secRes, netRes, brRes, hfRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/nodes/${nodeId}`, { headers }),
        fetch(`${API_BASE}/api/v1/inventory/hardware/${nodeId}`, { headers }),
        fetch(`${API_BASE}/api/v1/inventory/software/${nodeId}`, { headers }),
        fetch(`${API_BASE}/api/v1/inventory/security/${nodeId}`, { headers }),
        fetch(`${API_BASE}/api/v1/inventory/network/${nodeId}`, { headers }),
        fetch(`${API_BASE}/api/v1/inventory/browser/${nodeId}`, { headers }),
        fetch(`${API_BASE}/api/v1/inventory/hotfixes/${nodeId}`, { headers }),
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
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center gap-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          🦎 OpenClaw Inventory
        </h1>
        <div className="flex-1 max-w-md">
          <GlobalSearch onNodeSelect={handleNodeSelect} />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/performance"><Activity className="h-4 w-4 mr-1" /> Performance</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/jobs"><Briefcase className="h-4 w-4 mr-1" /> Jobs</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/packages"><Package className="h-4 w-4 mr-1" /> Pakete</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/groups"><FolderTree className="h-4 w-4 mr-1" /> Gruppen</Link>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Node Tree */}
        <aside className="w-64 border-r overflow-y-auto bg-muted/30">
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
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold">Dashboard</h2>
                  <p className="text-muted-foreground">Übersicht aller Nodes</p>
                </div>
                <Button variant="outline" onClick={fetchSummary}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
              </div>

              {/* KPI Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
                <Card className="cursor-pointer hover:border-primary transition-colors">
                  <CardHeader className="pb-2">
                    <CardDescription>Nodes Gesamt</CardDescription>
                    <CardTitle className="text-4xl">{summary?.counts.total || 0}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="cursor-pointer hover:border-green-500 transition-colors">
                  <CardHeader className="pb-2">
                    <CardDescription>Online</CardDescription>
                    <CardTitle className="text-4xl text-green-500">{summary?.counts.online || 0}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="cursor-pointer hover:border-yellow-500 transition-colors">
                  <CardHeader className="pb-2">
                    <CardDescription>Away</CardDescription>
                    <CardTitle className="text-4xl text-yellow-500">{summary?.counts.away || 0}</CardTitle>
                  </CardHeader>
                </Card>
                <Card className="cursor-pointer hover:border-gray-500 transition-colors">
                  <CardHeader className="pb-2">
                    <CardDescription>Offline</CardDescription>
                    <CardTitle className="text-4xl text-muted-foreground">{summary?.counts.offline || 0}</CardTitle>
                  </CardHeader>
                </Card>
              </div>

              {/* Metrics Overview */}
              {metrics && metrics.nodesWithMetrics > 0 && (
                <div className="grid gap-4 md:grid-cols-3 mb-8">
                  {/* Fleet Averages */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="flex items-center gap-2">
                        <Cpu className="h-4 w-4" /> CPU Auslastung (Fleet)
                      </CardDescription>
                      <CardTitle className="text-3xl">
                        {metrics.fleetAverages.cpuPercent?.toFixed(1) || 0}%
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 transition-all" 
                          style={{ width: `${metrics.fleetAverages.cpuPercent || 0}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="flex items-center gap-2">
                        <MemoryStick className="h-4 w-4" /> RAM Auslastung (Fleet)
                      </CardDescription>
                      <CardTitle className="text-3xl">
                        {metrics.fleetAverages.ramPercent?.toFixed(1) || 0}%
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all ${
                            (metrics.fleetAverages.ramPercent || 0) > 80 ? 'bg-red-500' :
                            (metrics.fleetAverages.ramPercent || 0) > 60 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${metrics.fleetAverages.ramPercent || 0}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4" /> Disk Auslastung (Fleet)
                      </CardDescription>
                      <CardTitle className="text-3xl">
                        {metrics.fleetAverages.diskPercent?.toFixed(1) || 0}%
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all ${
                            (metrics.fleetAverages.diskPercent || 0) > 90 ? 'bg-red-500' :
                            (metrics.fleetAverages.diskPercent || 0) > 70 ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${metrics.fleetAverages.diskPercent || 0}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Per-Node Metrics Chart */}
              {metrics && metrics.nodesWithMetrics > 0 && (
                <Card className="mb-8">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" /> Ressourcen pro Node
                    </CardTitle>
                    <CardDescription>RAM & Disk Auslastung</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart 
                          data={metrics.nodes.filter(n => n.cpuPercent !== null).map(n => ({
                            name: n.hostname,
                            RAM: n.ramPercent,
                            Disk: n.diskPercent
                          }))}
                          layout="vertical"
                        >
                          <XAxis type="number" domain={[0, 100]} />
                          <YAxis type="category" dataKey="name" width={120} />
                          <Tooltip />
                          <Bar dataKey="RAM" fill="#3b82f6" name="RAM %" />
                          <Bar dataKey="Disk" fill="#10b981" name="Disk %" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Warnings / Unassigned */}
              {summary && summary.counts.unassigned > 0 && (
                <Card className="mb-6 border-yellow-500/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-yellow-500" />
                      {summary.counts.unassigned} Nodes ohne Gruppe
                    </CardTitle>
                    <CardDescription>Diese Nodes sind keiner Gruppe zugeordnet</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/groups">Gruppen verwalten →</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Recent Activity */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" /> Letzte Aktivitäten
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {summary?.recent_events && summary.recent_events.length > 0 ? (
                    <div className="space-y-3">
                      {summary.recent_events.slice(0, 10).map((event, i) => (
                        <div 
                          key={i} 
                          className="flex items-center justify-between text-sm py-2 border-b last:border-0 cursor-pointer hover:bg-muted/50 rounded px-2 -mx-2"
                          onClick={() => handleNodeSelect(event.subject_id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-green-500">●</span>
                            <span className="font-medium">{event.subject}</span>
                            <span className="text-muted-foreground">checked in</span>
                          </div>
                          <span className="text-muted-foreground">{formatRelativeTime(event.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">Keine Aktivitäten</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
