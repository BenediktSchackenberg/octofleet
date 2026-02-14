"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { Breadcrumb } from "@/components/ui-components";
import { ManageTagsDialog } from "@/components/manage-tags-dialog";
import { PerformanceTab } from "@/components/performance-tab";

const API_BASE = 'http://192.168.0.5:8080/api/v1';
const API_KEY = 'openclaw-inventory-dev-key';

interface NodeDetails {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  os_build: string;
  last_seen: string;
  first_seen: string;
  is_online: boolean;
  agent_version: string | null;
  cpuName: string | null;
  totalMemoryGb: number | null;
  softwareCount: number;
  hardwareUpdatedAt: string | null;
  groups: { id: string; name: string; color: string; icon: string | null }[];
  tags: { id: string; name: string; color: string }[];
}

interface InventoryChange {
  id: number;
  category: string;
  changeType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs max-w-[60%] truncate" title={value}>{value}</span>
    </div>
  );
}

function getStatusBadge(lastSeen: string) {
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const diffMinutes = (now.getTime() - lastSeenDate.getTime()) / 1000 / 60;
  
  if (diffMinutes < 5) {
    return <Badge className="bg-green-600 text-white">Online</Badge>;
  } else if (diffMinutes < 60) {
    return <Badge className="bg-yellow-600 text-white">Away</Badge>;
  } else {
    return <Badge variant="secondary">Offline</Badge>;
  }
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

interface CriticalCookiesData {
  nodeId: string;
  criticalCookies: {
    username: string;
    browser: string;
    profile: string;
    domain: string;
    name: string;
    category: string;
    isSecure: boolean;
    isHttpOnly: boolean;
    isSession: boolean;
    isExpired: boolean;
    expiresUtc: string | null;
  }[];
  count: number;
  summary: Record<string, { count: number; domains: string[] }>;
  warnings: string[];
}

interface HardwareData {
  data?: {
    cpu?: { name?: string; cores?: number; threads?: number; speed?: string };
    memory?: { totalGb?: number; usedGb?: number; slots?: { capacity?: string; type?: string }[] };
    disks?: { name?: string; size?: string; type?: string; partitions?: { name?: string; size?: string; freeSpace?: string }[] }[];
    gpus?: { name?: string; memory?: string; driver?: string }[];
    motherboard?: { manufacturer?: string; product?: string };
    bios?: { manufacturer?: string; version?: string; releaseDate?: string };
    network?: { name?: string; mac?: string; speed?: string }[];
  };
}

interface SoftwareItem {
  name: string;
  version: string;
  publisher?: string;
  installDate?: string;
  installSource?: string;
  productCode?: string;
}

interface HotfixData {
  hotfixes: { hotfixId: string; description?: string; installedOn?: string }[];
  updateHistory: { title?: string; date?: string; result?: string }[];
}

interface SystemData {
  data?: {
    users?: { name?: string; enabled?: boolean; lastLogon?: string }[];
    services?: { name?: string; displayName?: string; status?: string; startType?: string }[];
    scheduledTasks?: { name?: string; status?: string; nextRunTime?: string; lastRunResult?: string }[];
    startupItems?: { name?: string; command?: string; location?: string }[];
  };
}

interface SecurityData {
  data?: {
    antivirus?: { name?: string; enabled?: boolean; upToDate?: boolean };
    firewall?: { enabled?: boolean; profiles?: Record<string, boolean> };
    uac?: { enabled?: boolean; level?: string };
    bitlocker?: { drives?: { drive?: string; status?: string; protectionStatus?: string }[] };
    secureboot?: { enabled?: boolean };
    tpm?: { present?: boolean; version?: string };
  };
}

interface NetworkData {
  data?: {
    adapters?: { name?: string; mac?: string; ipv4?: string[]; ipv6?: string[]; dhcpEnabled?: boolean }[];
    dns?: string[];
    routes?: { destination?: string; gateway?: string; metric?: number }[];
    shares?: { name?: string; path?: string; description?: string }[];
  };
}

interface BrowserData {
  data?: {
    browsers?: { name?: string; version?: string; isDefault?: boolean; profileCount?: number }[];
    extensions?: { browser?: string; name?: string; version?: string; enabled?: boolean }[];
  };
}

interface EventlogEntry {
  id: number;
  logName: string;
  eventId: number;
  level: number;
  levelName: string;
  source: string;
  message: string;
  eventTime: string;
}

export default function NodeDetailPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const [loading, setLoading] = useState(true);
  const [node, setNode] = useState<NodeDetails | null>(null);
  const [history, setHistory] = useState<InventoryChange[]>([]);
  const [hardware, setHardware] = useState<HardwareData | null>(null);
  const [software, setSoftware] = useState<SoftwareItem[]>([]);
  const [hotfixes, setHotfixes] = useState<HotfixData>({ hotfixes: [], updateHistory: [] });
  const [system, setSystem] = useState<SystemData | null>(null);
  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [browser, setBrowser] = useState<BrowserData | null>(null);
  const [criticalCookies, setCriticalCookies] = useState<CriticalCookiesData | null>(null);
  const [events, setEvents] = useState<EventlogEntry[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshInventory() {
    setRefreshing(true);
    try {
      const headers = getAuthHeader();
      
      const [hwRes, swRes, hfRes, sysRes, secRes, netRes, brRes, critRes] = await Promise.all([
        fetch(`${API_BASE}/inventory/hardware/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/software/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/hotfixes/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/system/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/security/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/network/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/browser/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/browser/${nodeId}/critical`, { headers }),
      ]);

      if (hwRes.ok) {
        const data = await hwRes.json();
        setHardware(data.data || {});
      }
      if (swRes.ok) {
        const data = await swRes.json();
        setSoftware(data.data?.installedPrograms || []);
      }
      if (hfRes.ok) {
        const data = await hfRes.json();
        setHotfixes({
          hotfixes: data.data?.hotfixes || [],
          updateHistory: data.data?.updateHistory || []
        });
      }
      if (sysRes.ok) {
        const data = await sysRes.json();
        setSystem(data.data || {});
      }
      if (secRes.ok) {
        const data = await secRes.json();
        setSecurity(data.data || {});
      }
      if (netRes.ok) {
        const data = await netRes.json();
        setNetwork(data.data || {});
      }
      if (brRes.ok) {
        const data = await brRes.json();
        setBrowser(data.data || {});
      }
      if (critRes.ok) {
        setCriticalCookies(await critRes.json());
      }
    } catch (err) {
      console.error("Failed to refresh inventory:", err);
    } finally {
      setRefreshing(false);
    }
  }

  async function fetchNodeDetails() {
    setLoading(true);
    try {
      const headers = getAuthHeader();
      
      const [nodeRes, historyRes, hwRes, swRes, hfRes, sysRes, secRes, netRes, brRes, critRes] = await Promise.all([
        fetch(`${API_BASE}/nodes/${nodeId}`, { headers }),
        fetch(`${API_BASE}/nodes/${nodeId}/history?limit=50`, { headers }),
        fetch(`${API_BASE}/inventory/hardware/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/software/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/hotfixes/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/system/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/security/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/network/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/browser/${nodeId}`, { headers }),
        fetch(`${API_BASE}/inventory/browser/${nodeId}/critical`, { headers }),
      ]);

      if (nodeRes.ok) setNode(await nodeRes.json());
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistory(data.changes || []);
      }
      if (hwRes.ok) {
        const data = await hwRes.json();
        setHardware(data.data || {});
      }
      if (swRes.ok) {
        const data = await swRes.json();
        setSoftware(data.data?.installedPrograms || []);
      }
      if (hfRes.ok) {
        const data = await hfRes.json();
        setHotfixes({
          hotfixes: data.data?.hotfixes || [],
          updateHistory: data.data?.updateHistory || []
        });
      }
      if (sysRes.ok) {
        const data = await sysRes.json();
        setSystem(data.data || {});
      }
      if (secRes.ok) {
        const data = await secRes.json();
        setSecurity(data.data || {});
      }
      if (netRes.ok) {
        const data = await netRes.json();
        setNetwork(data.data || {});
      }
      if (brRes.ok) {
        const data = await brRes.json();
        setBrowser(data.data || {});
      }
      if (critRes.ok) {
        setCriticalCookies(await critRes.json());
      }
      
      // Fetch eventlog separately (may not exist for all nodes)
      try {
        const eventsRes = await fetch(`${API_BASE}/nodes/${nodeId}/eventlog?limit=100`, { headers });
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          setEvents(eventsData.events || []);
        }
      } catch {
        // Eventlog might not be available
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNodeDetails();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground">Lade Daten...</p>
        </div>
      </main>
    );
  }

  if (!node && !hardware) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            ← Zurück zum Dashboard
          </Link>
          <Card className="mt-8 p-12 text-center">
            <CardContent>
              <p className="text-xl text-muted-foreground">Node nicht gefunden</p>
              <p className="text-sm text-muted-foreground mt-2">ID: {nodeId}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const hwData: any = hardware || {};
  const sysData: any = system || {};
  const secData: any = security || {};
  const netData: any = network || {};
  const browserData: any = browser || {};
  const ramData: any = (hwData as any).ram || hwData.data?.memory || {};
  const gpuList: any[] = (hwData as any).gpu || hwData.data?.gpus || [];
  const nicsList: any = (hwData as any).nics || hwData.data?.network || {};
  const totalUpdatesCount = hotfixes.hotfixes.length + hotfixes.updateHistory.length;

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <Breadcrumb items={[{ label: "Nodes", href: "/nodes" }, { label: node?.hostname || nodeId }]} />
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-4 mt-2">
              <h1 className="text-3xl font-bold">{node?.hostname || nodeId}</h1>
              {node && getStatusBadge(node.last_seen)}
            </div>
            {/* Groups and Tags */}
            {node && (node.groups.length > 0 || node.tags.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-2">
                {node.groups.map(group => (
                  <Badge key={group.id} style={{ backgroundColor: group.color, color: 'white' }}>
                    {group.icon && `${group.icon} `}{group.name}
                  </Badge>
                ))}
                {node.tags.map(tag => (
                  <Badge key={tag.id} variant="outline" style={{ borderColor: tag.color, color: tag.color }}>
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {node && (
              <ManageTagsDialog 
                nodeId={node.id} 
                nodeTags={node.tags} 
                onTagsChanged={fetchNodeDetails} 
              />
            )}
            <Link href={`/nodes/${nodeId}/screen`}>
              <Button variant="outline" className="bg-purple-500/10 border-purple-500 text-purple-500 hover:bg-purple-500/20">
                🖥️ Screen
              </Button>
            </Link>
            <Button 
              variant="outline" 
              onClick={refreshInventory}
              disabled={refreshing}
            >
              {refreshing ? "⏳ Lade..." : "📊 Inventory abrufen"}
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="performance">📊 Performance</TabsTrigger>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
            <TabsTrigger value="software">Software ({software.length})</TabsTrigger>
            <TabsTrigger value="updates">Updates ({totalUpdatesCount})</TabsTrigger>
            <TabsTrigger value="network">Netzwerk</TabsTrigger>
            <TabsTrigger value="security">Sicherheit</TabsTrigger>
            <TabsTrigger value="browser">Browser</TabsTrigger>
            <TabsTrigger value="events">Events ({events.length})</TabsTrigger>
            <TabsTrigger value="history">Timeline</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Betriebssystem</CardDescription>
                  <CardTitle className="text-lg">{sysData.osName || node?.os_name || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{sysData.osVersion || node?.os_version}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>CPU</CardDescription>
                  <CardTitle className="text-lg truncate">{hwData.cpu?.name || node?.cpuName || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{hwData.cpu?.cores || '-'} Kerne / {hwData.cpu?.logicalProcessors || '-'} Threads</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>RAM</CardDescription>
                  <CardTitle className="text-lg">{ramData.totalGB?.toFixed(1) || node?.totalMemoryGb?.toFixed(1) || '-'} GB</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{ramData.modules?.length || 0} Module</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Grafikkarte</CardDescription>
                  <CardTitle className="text-lg truncate">{gpuList[0]?.name || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{gpuList[0]?.videoMemoryGB || '-'} GB VRAM</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>System Info</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Mainboard" value={hwData.mainboard?.product ? `${hwData.mainboard.manufacturer} ${hwData.mainboard.product}` : null} />
                  <InfoRow label="BIOS Version" value={hwData.bios?.smbiosVersion || hwData.bios?.name} />
                  <InfoRow label="BIOS Datum" value={hwData.bios?.releaseDate} />
                  <InfoRow label="System UUID" value={hwData.bios?.uuid} />
                  {sysData.uptimeFormatted && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">⏱️ Uptime</span>
                      <span className="font-mono">{sysData.uptimeFormatted}</span>
                    </div>
                  )}
                  {hwData.bios?.isUefi !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Boot Modus</span>
                      <Badge variant={hwData.bios?.isUefi ? "default" : "secondary"}>
                        {hwData.bios?.isUefi ? "UEFI" : "Legacy BIOS"}
                      </Badge>
                    </div>
                  )}
                  {hwData.bios?.secureBootState && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Secure Boot</span>
                      <Badge variant={hwData.bios?.secureBootState === "Enabled" ? "default" : "secondary"}>
                        {hwData.bios?.secureBootState}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader><CardTitle>Virtualisierung & Domain</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {hwData.virtualization ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Typ</span>
                        <Badge variant={hwData.virtualization.isVirtual ? "secondary" : "default"}>
                          {hwData.virtualization.hypervisor || (hwData.virtualization.isVirtual ? "Virtual" : "Physical")}
                        </Badge>
                      </div>
                      <InfoRow label="Hersteller" value={hwData.virtualization.manufacturer} />
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">Keine Daten</div>
                  )}
                  <InfoRow label="Computer Name" value={sysData.computerName || node?.hostname} />
                  <InfoRow label="Domain" value={sysData.domain} />
                  <InfoRow label="Workgroup" value={sysData.workgroup} />
                  <InfoRow label="Domain Role" value={sysData.domainRole} />
                </CardContent>
              </Card>
            </div>

            {/* Timestamps */}
            {node && (
              <Card>
                <CardHeader><CardTitle>📅 Zeitstempel & Version</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Erste Erfassung</p>
                    <p className="font-medium">{formatDateTime(node.first_seen)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Zuletzt gesehen</p>
                    <p className="font-medium">{formatDateTime(node.last_seen)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Änderungen erfasst</p>
                    <p className="font-medium">{history.length}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Agent Version</p>
                    <p className="font-medium font-mono">{node.agent_version || '-'}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance">
            {node && <PerformanceTab nodeId={node.node_id} />}
          </TabsContent>

          {/* Hardware Tab */}
          <TabsContent value="hardware" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* CPU */}
              <Card>
                <CardHeader><CardTitle>🔲 Prozessor</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Name" value={hwData.cpu?.name} />
                  <InfoRow label="Kerne" value={hwData.cpu?.cores?.toString()} />
                  <InfoRow label="Threads" value={hwData.cpu?.logicalProcessors?.toString()} />
                  <InfoRow label="Max. Takt" value={hwData.cpu?.maxClockSpeedMHz ? `${hwData.cpu.maxClockSpeedMHz} MHz` : null} />
                  <InfoRow label="L2 Cache" value={hwData.cpu?.l2CacheKB ? `${(hwData.cpu.l2CacheKB / 1024).toFixed(0)} MB` : null} />
                  <InfoRow label="L3 Cache" value={hwData.cpu?.l3CacheKB ? `${(hwData.cpu.l3CacheKB / 1024).toFixed(0)} MB` : null} />
                  <InfoRow label="Architektur" value={hwData.cpu?.architecture} />
                  <InfoRow label="Socket" value={hwData.cpu?.socketDesignation} />
                </CardContent>
              </Card>

              {/* RAM */}
              <Card>
                <CardHeader><CardTitle>💾 Arbeitsspeicher</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold mb-4">{ramData.totalGB?.toFixed(0) || '-'} GB Total</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Slot</TableHead>
                        <TableHead>Größe</TableHead>
                        <TableHead>Typ</TableHead>
                        <TableHead>Speed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ramData.modules?.map((mod: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{mod.deviceLocator || mod.bankLabel}</TableCell>
                          <TableCell>{mod.capacityGB} GB</TableCell>
                          <TableCell>{mod.memoryType}</TableCell>
                          <TableCell>{mod.speedMHz} MHz</TableCell>
                        </TableRow>
                      )) || (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground">Keine Daten</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* GPU */}
              <Card>
                <CardHeader><CardTitle>🎮 Grafikkarten</CardTitle></CardHeader>
                <CardContent>
                  {gpuList.length === 0 ? (
                    <p className="text-muted-foreground">Keine Daten</p>
                  ) : (
                    <div className="space-y-4">
                      {gpuList.map((gpu: any, i: number) => (
                        <div key={i} className="p-3 border rounded-lg">
                          <p className="font-medium">{gpu.name}</p>
                          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                            <InfoRow label="VRAM" value={gpu.videoMemoryGB ? `${gpu.videoMemoryGB} GB` : null} />
                            <InfoRow label="Treiber" value={gpu.driverVersion} />
                            <InfoRow label="Auflösung" value={gpu.currentResolution} />
                            <InfoRow label="Refresh" value={gpu.refreshRate ? `${gpu.refreshRate} Hz` : null} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Disks */}
              <Card>
                <CardHeader><CardTitle>💿 Festplatten</CardTitle></CardHeader>
                <CardContent>
                  {hwData.disks?.physical?.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Modell</TableHead>
                          <TableHead>Größe</TableHead>
                          <TableHead>Typ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hwData.disks.physical.map((disk: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="truncate max-w-[200px]">{disk.model}</TableCell>
                            <TableCell>{disk.sizeGB?.toFixed(0)} GB</TableCell>
                            <TableCell>{disk.interfaceType}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground">Keine Daten</p>
                  )}
                  
                  {hwData.disks?.volumes?.length > 0 && (
                    <>
                      <p className="font-medium mt-4 mb-2">Volumes</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Laufwerk</TableHead>
                            <TableHead>Frei</TableHead>
                            <TableHead>Gesamt</TableHead>
                            <TableHead>Belegt</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hwData.disks.volumes.filter((v: any) => v.sizeGB > 0).map((vol: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell>{vol.driveLetter} {vol.volumeName && `(${vol.volumeName})`}</TableCell>
                              <TableCell>{vol.freeGB?.toFixed(0)} GB</TableCell>
                              <TableCell>{vol.sizeGB?.toFixed(0)} GB</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full ${vol.usedPercent > 90 ? 'bg-red-500' : vol.usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                      style={{ width: `${vol.usedPercent}%` }}
                                    />
                                  </div>
                                  <span className="text-xs">{vol.usedPercent?.toFixed(0)}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Software Tab */}
          <TabsContent value="software">
            <Card>
              <CardHeader>
                <CardTitle>Installierte Software ({software.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Herausgeber</TableHead>
                      <TableHead>Installiert</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {software.slice(0, 100).map((sw: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="truncate max-w-[300px]">{sw.name}</TableCell>
                        <TableCell>{sw.version || '-'}</TableCell>
                        <TableCell className="truncate max-w-[200px]">{sw.publisher || '-'}</TableCell>
                        <TableCell>{sw.installDate || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {software.length > 100 && (
                  <p className="text-sm text-muted-foreground mt-2">Zeige 100 von {software.length}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Updates Tab */}
          <TabsContent value="updates" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Windows Updates ({totalUpdatesCount})</CardTitle></CardHeader>
              <CardContent>
                {hotfixes.hotfixes.length > 0 && (
                  <>
                    <p className="font-medium mb-2">Installierte Hotfixes ({hotfixes.hotfixes.length})</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>KB</TableHead>
                          <TableHead>Beschreibung</TableHead>
                          <TableHead>Installiert</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hotfixes.hotfixes.slice(0, 20).map((hf: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell><Badge variant="outline">{hf.hotfixId}</Badge></TableCell>
                            <TableCell>{hf.description || '-'}</TableCell>
                            <TableCell>{hf.installedOn || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
                
                {hotfixes.updateHistory.length > 0 && (
                  <>
                    <p className="font-medium mb-2 mt-6">Update-Verlauf ({hotfixes.updateHistory.length})</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>KB</TableHead>
                          <TableHead>Titel</TableHead>
                          <TableHead>Datum</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hotfixes.updateHistory.slice(0, 50).map((upd: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell><Badge variant="outline">{upd.kb || '-'}</Badge></TableCell>
                            <TableCell className="truncate max-w-[300px]">{upd.title || '-'}</TableCell>
                            <TableCell>{upd.installedDate ? new Date(upd.installedDate).toLocaleDateString('de-DE') : '-'}</TableCell>
                            <TableCell>
                              <Badge variant={upd.resultCode === 2 ? "default" : "secondary"}>
                                {upd.resultCode === 2 ? "✓ OK" : upd.resultCode === 4 ? "⚠ Fehler" : upd.resultCode}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Network Tab */}
          <TabsContent value="network" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Netzwerkadapter</CardTitle></CardHeader>
              <CardContent>
                {nicsList.adapters?.length > 0 ? (
                  <div className="space-y-4">
                    {nicsList.adapters.map((nic: any, i: number) => {
                      const config = nicsList.configurations?.[nic.deviceId] || {};
                      return (
                        <div key={i} className="p-4 border rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium">{nic.name}</p>
                            <Badge variant={nic.connectionStatus === "Connected" ? "default" : "secondary"}>
                              {nic.connectionStatus}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <InfoRow label="MAC" value={nic.macAddress} />
                            <InfoRow label="Speed" value={nic.speedMbps ? `${nic.speedMbps} Mbps` : null} />
                            <InfoRow label="IP" value={config.ipAddresses?.join(", ")} />
                            <InfoRow label="Gateway" value={config.gateways?.join(", ")} />
                            <InfoRow label="DNS" value={config.dnsServers?.join(", ")} />
                            <InfoRow label="DHCP" value={config.dhcpEnabled ? "Ja" : "Nein"} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Keine Daten</p>
                )}
              </CardContent>
            </Card>

            {netData.connections?.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Aktive Verbindungen ({netData.connections.length})</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lokal</TableHead>
                        <TableHead>Remote</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Prozess</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {netData.connections.slice(0, 30).map((conn: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{conn.localAddress}:{conn.localPort}</TableCell>
                          <TableCell className="font-mono text-xs">{conn.remoteAddress}:{conn.remotePort}</TableCell>
                          <TableCell><Badge variant="outline">{conn.state}</Badge></TableCell>
                          <TableCell>{conn.processName || conn.owningProcess}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>🛡️ Windows Firewall</CardTitle></CardHeader>
                <CardContent>
                  {secData.firewall?.profiles ? (
                    <div className="space-y-2">
                      {Object.entries(secData.firewall.profiles).map(([profile, data]: [string, any]) => (
                        <div key={profile} className="flex justify-between items-center">
                          <span>{profile}</span>
                          <Badge variant={data?.enabled ? "default" : "destructive"}>
                            {data?.enabled ? "Aktiv" : "Inaktiv"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Keine Daten</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>🔐 TPM</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {secData.tpm ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={secData.tpm.isPresent ? "default" : "secondary"}>
                          {secData.tpm.isPresent ? "Vorhanden" : "Nicht vorhanden"}
                        </Badge>
                      </div>
                      <InfoRow label="Version" value={secData.tpm.specVersion} />
                      <InfoRow label="Hersteller" value={secData.tpm.manufacturer} />
                    </>
                  ) : (
                    <p className="text-muted-foreground">Keine Daten</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>🔒 BitLocker</CardTitle></CardHeader>
                <CardContent>
                  {secData.bitlocker?.volumes?.length > 0 ? (
                    <div className="space-y-2">
                      {secData.bitlocker.volumes.map((vol: any, i: number) => (
                        <div key={i} className="flex justify-between items-center">
                          <span>{vol.driveLetter}</span>
                          <Badge variant={vol.protectionStatus === "On" ? "default" : "secondary"}>
                            {vol.protectionStatus}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">Keine Daten</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>👤 UAC</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {secData.uac ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Aktiviert</span>
                        <Badge variant={secData.uac.enabled ? "default" : "destructive"}>
                          {secData.uac.enabled ? "Ja" : "Nein"}
                        </Badge>
                      </div>
                      <InfoRow label="Consent Prompt" value={secData.uac.consentPromptBehaviorAdmin?.toString()} />
                    </>
                  ) : (
                    <p className="text-muted-foreground">Keine Daten</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Local Admins - E1-07 */}
            {secData.localAdmins && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    👑 Lokale Administratoren
                    <Badge variant="outline">{secData.localAdmins.count || secData.localAdmins.members?.length || 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {secData.localAdmins.members?.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Domain</TableHead>
                          <TableHead>Typ</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {secData.localAdmins.members.map((admin: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{admin.name}</TableCell>
                            <TableCell className="text-muted-foreground">{admin.domain || '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{admin.accountType || 'User'}</Badge>
                            </TableCell>
                            <TableCell>
                              {admin.isBuiltIn && (
                                <Badge variant="secondary">Built-in</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : secData.localAdmins.error ? (
                    <p className="text-sm text-destructive">{secData.localAdmins.error}</p>
                  ) : (
                    <p className="text-muted-foreground">Keine Daten</p>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Browser Tab */}
          <TabsContent value="browser" className="space-y-4">
            {/* Security Warnings */}
            {criticalCookies && criticalCookies.warnings.length > 0 && (
              <Card className="border-yellow-500 bg-yellow-500/10">
                <CardHeader>
                  <CardTitle className="text-yellow-600 dark:text-yellow-400">⚠️ Sicherheitshinweise</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {criticalCookies.warnings.map((warning, i) => (
                      <li key={i} className="text-sm">{warning}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Critical Cookies Summary */}
            {criticalCookies && criticalCookies.count > 0 && (
              <Card className="border-red-500/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    🔐 Kritische Cookies <Badge variant="destructive">{criticalCookies.count}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Cookies von sensitiven Domains (Banking, Auth, Cloud, etc.)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Category Summary */}
                  <div className="grid gap-4 md:grid-cols-3 mb-6">
                    {Object.entries(criticalCookies.summary).map(([category, data]) => (
                      <div key={category} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{category}</span>
                          <Badge variant="outline">{data.count}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {data.domains.slice(0, 5).map(domain => (
                            <Badge key={domain} variant="secondary" className="text-xs">
                              {domain}
                            </Badge>
                          ))}
                          {data.domains.length > 5 && (
                            <Badge variant="secondary" className="text-xs">+{data.domains.length - 5}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Critical Cookies Table */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Cookie</TableHead>
                        <TableHead>Kategorie</TableHead>
                        <TableHead>Browser</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {criticalCookies.criticalCookies.slice(0, 20).map((cookie, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{cookie.domain}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate" title={cookie.name}>
                            {cookie.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{cookie.category}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{cookie.browser}</TableCell>
                          <TableCell className="space-x-1">
                            {cookie.isSecure ? (
                              <Badge className="bg-green-600 text-xs">Secure</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">!Secure</Badge>
                            )}
                            {cookie.isHttpOnly ? (
                              <Badge className="bg-green-600 text-xs">HttpOnly</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">!HttpOnly</Badge>
                            )}
                            {cookie.isSession && (
                              <Badge variant="secondary" className="text-xs">Session</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {criticalCookies.criticalCookies.length > 20 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      ... und {criticalCookies.criticalCookies.length - 20} weitere kritische Cookies
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Browser Stats per User */}
            {browserData.users && Object.keys(browserData.users).length > 0 ? (
              Object.entries(browserData.users).map(([username, browsers]: [string, any]) => (
                <Card key={username}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      👤 {username}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(browsers).map(([browserName, data]: [string, any]) => {
                        const icon = browserName === 'Chrome' ? '🌐' : browserName === 'Edge' ? '📘' : '🦊';
                        const profile = data.profiles?.[0];
                        const cookiesCount = profile?.cookiesCount || 0;
                        return (
                          <div key={browserName} className="p-4 border rounded-lg">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-2xl">{icon}</span>
                              <span className="font-medium">{browserName}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex items-center gap-1">
                                <span>📜</span>
                                <span className="text-muted-foreground">History</span>
                              </div>
                              <span className="font-mono text-right">{(profile?.historyCount || 0).toLocaleString()}</span>
                              
                              <div className="flex items-center gap-1">
                                <span>🔖</span>
                                <span className="text-muted-foreground">Bookmarks</span>
                              </div>
                              <span className="font-mono text-right">{(profile?.bookmarkCount || 0).toLocaleString()}</span>
                              
                              <div className="flex items-center gap-1">
                                <span>🍪</span>
                                <span className="text-muted-foreground">Cookies</span>
                              </div>
                              <span className="font-mono text-right">
                                {cookiesCount === -1 ? (
                                  <Badge variant="destructive" className="text-xs">Gesperrt</Badge>
                                ) : (
                                  cookiesCount.toLocaleString()
                                )}
                              </span>
                              
                              <div className="flex items-center gap-1">
                                <span>🧩</span>
                                <span className="text-muted-foreground">Extensions</span>
                              </div>
                              <span className="font-mono text-right">{data.extensionCount || 0}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : Object.keys(browserData).length > 0 && !browserData.users ? (
              // Legacy format fallback
              <Card>
                <CardHeader><CardTitle>Browser-Daten</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">Legacy-Format erkannt. Bitte Agent aktualisieren.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p>Keine Browser-Daten vorhanden</p>
                  <p className="text-sm mt-2">Der Agent muss als SYSTEM-Dienst laufen und alle Benutzerprofile scannen</p>
                </CardContent>
              </Card>
            )}

            {/* Cookies Summary by Domain */}
            {browserData.cookies && Object.keys(browserData.cookies).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>🍪 Alle Cookies nach Domain</CardTitle>
                  <CardDescription>Top-Domains pro Benutzer</CardDescription>
                </CardHeader>
                <CardContent>
                  {Object.entries(browserData.cookies).map(([username, cookieList]: [string, any]) => (
                    <div key={username} className="mb-6">
                      <p className="font-medium mb-2">👤 {username}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Browser</TableHead>
                            <TableHead>Profil</TableHead>
                            <TableHead>Domain</TableHead>
                            <TableHead className="text-right">Anzahl</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Array.isArray(cookieList) && cookieList.slice(0, 15).map((cookie: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell>{cookie.browser}</TableCell>
                              <TableCell>{cookie.profile}</TableCell>
                              <TableCell className="font-mono text-xs">{cookie.domain}</TableCell>
                              <TableCell className="text-right font-mono">{cookie.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {Array.isArray(cookieList) && cookieList.length > 15 && (
                        <p className="text-sm text-muted-foreground mt-2">
                          ... und {cookieList.length - 15} weitere Domains
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Events Tab */}
          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>📋 Windows Eventlog</CardTitle>
                <CardDescription>System, Security & Application Events</CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>Keine Events gesammelt</p>
                    <p className="text-sm mt-2">Führe einen Eventlog Collection Job aus</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-red-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-red-400">
                          {events.filter(e => e.level <= 2).length}
                        </div>
                        <div className="text-xs text-muted-foreground">Critical/Error</div>
                      </div>
                      <div className="bg-yellow-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-yellow-400">
                          {events.filter(e => e.level === 3).length}
                        </div>
                        <div className="text-xs text-muted-foreground">Warnings</div>
                      </div>
                      <div className="bg-blue-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-400">
                          {events.filter(e => e.logName === 'Security').length}
                        </div>
                        <div className="text-xs text-muted-foreground">Security</div>
                      </div>
                      <div className="bg-zinc-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-zinc-400">
                          {events.length}
                        </div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                    </div>
                    
                    {/* Events Table */}
                    <div className="max-h-[500px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Zeit</TableHead>
                            <TableHead className="w-[80px]">Level</TableHead>
                            <TableHead className="w-[80px]">Log</TableHead>
                            <TableHead className="w-[80px]">Event ID</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead>Message</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {events.slice(0, 100).map((event) => (
                            <TableRow key={event.id}>
                              <TableCell className="text-xs font-mono">
                                {new Date(event.eventTime).toLocaleString('de-DE', {
                                  month: '2-digit', day: '2-digit',
                                  hour: '2-digit', minute: '2-digit'
                                })}
                              </TableCell>
                              <TableCell>
                                <Badge className={
                                  event.level <= 1 ? 'bg-red-600' :
                                  event.level === 2 ? 'bg-red-500' :
                                  event.level === 3 ? 'bg-yellow-500' :
                                  'bg-zinc-600'
                                }>
                                  {event.levelName || `L${event.level}`}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{event.logName}</TableCell>
                              <TableCell>
                                <code className="text-xs bg-zinc-800 px-1 rounded">{event.eventId}</code>
                              </TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate" title={event.source}>
                                {event.source}
                              </TableCell>
                              <TableCell className="text-xs max-w-[300px] truncate" title={event.message}>
                                {event.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* History/Timeline Tab */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>📜 Änderungsverlauf</CardTitle>
                <CardDescription>Erkannte Änderungen am System</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>Noch keine Änderungen erfasst</p>
                  </div>
                ) : (
                  <Timeline changes={history} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
