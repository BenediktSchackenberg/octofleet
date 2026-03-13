"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useNodeDetails } from "@/hooks/useNodeDetails";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { ManageTagsDialog } from "@/components/manage-tags-dialog";
import { PerformanceTab } from "@/components/performance-tab";
import { Copy, Check, Zap, FolderTree, FileText, ExternalLink, ShieldAlert, Bug, Briefcase, Bell } from "lucide-react";
import { MonitoringHealthPanel } from "@/components/monitoring-health-panel";
import { FavoriteButton } from "@/components/FavoriteButton";
import { apiClient } from "@/lib/api-client";

// Copy to clipboard component
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-muted transition-colors ${className}`}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? (
        <><Check className="h-3 w-3 text-green-500" /> Copied!</>
      ) : (
        <><Copy className="h-3 w-3" /> Copy</>
      )}
    </button>
  );
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

// Move to Group dropdown button
function MoveToGroupButton({ nodeId, onMoved }: { nodeId: string; onMoved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && groups.length === 0) {
      setLoading(true);
      apiClient.get<any>("/groups")
        .then((data) => setGroups(Array.isArray(data) ? data : data?.groups || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const moveToGroup = async (groupId: string) => {
    try {
      await apiClient.post(`/groups/${groupId}/members`, { node_ids: [nodeId] });
      setOpen(false);
      onMoved?.();
    } catch {}
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        className="bg-indigo-500/10 border-indigo-500 text-indigo-500 hover:bg-indigo-500/20"
        onClick={() => setOpen(!open)}
      >
        <FolderTree className="h-4 w-4 mr-1" /> Move to Group
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-md border bg-popover p-1 shadow-md">
          {loading ? (
            <p className="text-sm text-muted-foreground p-2">Lade...</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">Keine Gruppen</p>
          ) : (
            groups.map((g: any) => (
              <button
                key={g.id}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent flex items-center gap-2"
                onClick={() => moveToGroup(g.id)}
              >
                {g.icon && <span>{g.icon}</span>}
                {g.color && <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: g.color }} />}
                {g.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Quick Links card - cross-module deep links
function QuickLinksBar({ nodeId }: { nodeId: string }) {
  const [links, setLinks] = useState<{ label: string; count: number; href: string; icon: React.ReactNode }[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      const results: typeof links = [];

      const fetchers = [
        apiClient.get<any>(`/patches/compliance?node_id=${nodeId}`)
          .then((d) => {
            const count = d?.pending ?? d?.pendingCount ?? (Array.isArray(d) ? d.length : 0);
            if (count > 0) results.push({ label: "Patches", count, href: `/patches?node=${nodeId}`, icon: <ShieldAlert className="h-4 w-4" /> });
          }).catch(() => {}),
        apiClient.get<any>("/vulnerabilities/by-node")
          .then((d) => {
            const arr = Array.isArray(d) ? d : d?.nodes || [];
            const entry = arr.find((n: any) => n.node_id === nodeId || n.nodeId === nodeId);
            const count = entry?.count ?? entry?.vulnerabilities?.length ?? 0;
            if (count > 0) results.push({ label: "Vulnerabilities", count, href: `/vulnerabilities?node=${nodeId}`, icon: <Bug className="h-4 w-4" /> });
          }).catch(() => {}),
        apiClient.get<any>(`/jobs?target_id=${nodeId}&limit=5`)
          .then((d) => {
            const count = Array.isArray(d) ? d.length : d?.jobs?.length ?? d?.total ?? 0;
            if (count > 0) results.push({ label: "Jobs", count, href: `/jobs?node=${nodeId}`, icon: <Briefcase className="h-4 w-4" /> });
          }).catch(() => {}),
        apiClient.get<any>("/alerts/rules")
          .then((d) => {
            const arr = Array.isArray(d) ? d : d?.rules || [];
            const count = arr.filter((r: any) => r.node_id === nodeId || r.nodeId === nodeId || r.target === nodeId).length;
            if (count > 0) results.push({ label: "Alerts", count, href: `/alerts?node=${nodeId}`, icon: <Bell className="h-4 w-4" /> });
          }).catch(() => {}),
      ];

      await Promise.allSettled(fetchers);
      setLinks(results);
    };
    fetchAll();
  }, [nodeId]);

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {links.map((link) => (
        <Link key={link.label} href={link.href}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-accent transition-colors cursor-pointer">
            {link.icon}
            <span className="text-sm font-medium">{link.label}</span>
            <Badge variant="secondary" className="ml-1">{link.count}</Badge>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function NodeDetailPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const { loading, node, history, hardware, software, hotfixes, system, security, network, browser, criticalCookies, events, eventsLoading, refreshing, linuxData, hwData, sysData, secData, netData, browserData, ramData, gpuList, nicsList, totalUpdatesCount, refreshInventory, fetchNodeDetails } = useNodeDetails(nodeId);

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


  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
{/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-4 mt-2">
              <h1 className="text-3xl font-bold">{node?.hostname || nodeId}</h1>
              {node && <FavoriteButton type="node" id={nodeId} label={node.hostname || nodeId} href={`/nodes/${nodeId}`} />}
              {node && getStatusBadge(node.last_seen)}
            </div>
            {/* Groups and Tags */}
            {node && (node.groups?.length > 0 || node.tags?.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-2">
                {node.groups?.map(group => (
                  <Badge key={group.id} style={{ backgroundColor: group.color, color: 'white' }}>
                    {group.icon && `${group.icon} `}{group.name}
                  </Badge>
                ))}
                {node.tags?.map(tag => (
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
            <Link href={`/nodes/${nodeId}/terminal`}>
              <Button variant="outline" className="bg-green-500/10 border-green-500 text-green-500 hover:bg-green-500/20">
                &gt;_ Terminal
              </Button>
            </Link>
            <Link href={`/nodes/${nodeId}/screen`}>
              <Button variant="outline" className="bg-purple-500/10 border-purple-500 text-purple-500 hover:bg-purple-500/20">
                🖥️ Screen
              </Button>
            </Link>
            <Link href={`/nodes/${nodeId}/shell`}>
              <Button variant="outline" className="bg-orange-500/10 border-orange-500 text-orange-500 hover:bg-orange-500/20">
                🐚 Shell
              </Button>
            </Link>
            <Button 
              variant="outline" 
              onClick={refreshInventory}
              disabled={refreshing}
            >
              {refreshing ? "⏳ Lade..." : "📊 Inventory abrufen"}
            </Button>
            <Link href={`/jobs?target=${nodeId}`}>
              <Button variant="outline" className="bg-blue-500/10 border-blue-500 text-blue-500 hover:bg-blue-500/20">
                <Zap className="h-4 w-4 mr-1" /> Start Job
              </Button>
            </Link>
            <MoveToGroupButton nodeId={nodeId} onMoved={fetchNodeDetails} />
            <Link href={`/reports?node=${nodeId}`}>
              <Button variant="outline" className="bg-slate-500/10 border-slate-500 text-slate-400 hover:bg-slate-500/20">
                <FileText className="h-4 w-4 mr-1" /> Generate Report
              </Button>
            </Link>
          </div>
        </div>

        {/* Quick Links - Cross-Module Deep Links */}
        <QuickLinksBar nodeId={nodeId} />

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
            <TabsTrigger value="monitoring">🛡️ Monitoring</TabsTrigger>
            {linuxData && <TabsTrigger value="linux">🐧 Linux</TabsTrigger>}
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
                  <CardTitle className="text-lg truncate">{String(gpuList[0]?.name || '-')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{String(gpuList[0]?.videoMemoryGB || '-')} GB VRAM</p>
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

            {/* Timestamps & IDs */}
            {node && (
              <Card>
                <CardHeader><CardTitle>📅 Zeitstempel & Identifikation</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-5">
                  <div>
                    <p className="text-sm text-muted-foreground">Node ID</p>
                    <div className="flex items-center gap-2">
                      <p className="font-medium font-mono text-xs truncate max-w-[120px]" title={node.node_id}>{node.node_id}</p>
                      <CopyButton text={node.node_id} />
                    </div>
                  </div>
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
                        {hwData.disks?.physical?.map((disk: any, i: number) => (
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
                          {hwData.disks?.volumes?.filter((v: any) => v.sizeGB > 0).map((vol: any, i: number) => (
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
                        <TableCell className="truncate max-w-[300px]">
                          {sw.id ? (
                            <Link href={`/packages/${sw.id}`} className="text-blue-500 hover:underline">{sw.name}</Link>
                          ) : sw.name}
                        </TableCell>
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
                        {hotfixes.hotfixes?.slice(0, 20).map((hf: any, i: number) => (
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
                        {hotfixes.updateHistory?.slice(0, 50).map((upd: any, i: number) => (
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
                {(nicsList.adapters?.length ?? 0) > 0 ? (
                  <div className="space-y-4">
                    {nicsList.adapters?.map((nic: any, i: number) => {
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

            {(netData.connections?.length ?? 0) > 0 && (
              <Card>
                <CardHeader><CardTitle>Aktive Verbindungen ({netData.connections?.length})</CardTitle></CardHeader>
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
                      {netData.connections?.slice(0, 30).map((conn: any, i: number) => (
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
                      {Object.entries(secData.firewall?.profiles || {}).map(([profile, data]: [string, any]) => (
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
                      {secData.bitlocker?.volumes?.map((vol: any, i: number) => (
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
                        {secData.localAdmins?.members?.map((admin: any, i: number) => (
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

            {/* Deep Links to Security modules */}
            <div className="flex flex-wrap gap-3 mt-2">
              <Link href={`/security/findings?node=${nodeId}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <ShieldAlert className="h-4 w-4" /> Alle Security Findings anzeigen <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
              <Link href={`/vulnerabilities?node=${nodeId}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Bug className="h-4 w-4" /> Alle Vulnerabilities anzeigen <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </TabsContent>

          {/* Browser Tab */}
          <TabsContent value="browser" className="space-y-4">
            {/* Security Warnings */}
            {criticalCookies && criticalCookies.warnings?.length > 0 && (
              <Card className="border-yellow-500 bg-yellow-500/10">
                <CardHeader>
                  <CardTitle className="text-yellow-600 dark:text-yellow-400">⚠️ Sicherheitshinweise</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {criticalCookies.warnings?.map((warning, i) => (
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
                    {Object.entries(criticalCookies?.summary || {}).map(([category, data]) => (
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
                          {data.domains?.length > 5 && (
                            <Badge variant="secondary" className="text-xs">+{data.domains?.length - 5}</Badge>
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
                      {criticalCookies.criticalCookies?.slice(0, 20).map((cookie, i) => (
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
                  {criticalCookies.criticalCookies?.length > 20 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      ... und {criticalCookies.criticalCookies?.length - 20} weitere kritische Cookies
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Browser Stats per User */}
            {browserData.users && Object.keys(browserData?.users || {}).length > 0 ? (
              Object.entries(browserData?.users || {}).map(([username, browsers]: [string, any]) => (
                <Card key={username}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      👤 {username}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(browsers || {}).map(([browserName, data]: [string, any]) => {
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
            ) : Object.keys(browserData || {}).length > 0 && !browserData.users ? (
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
                  {Object.entries(browserData?.cookies || {}).map(([username, cookieList]: [string, any]) => (
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

          {/* Linux Data Tab */}
          {linuxData && (
            <TabsContent value="linux" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Load Average Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Load Average</CardDescription>
                    <CardTitle className="text-lg">
                      {linuxData.performance?.loadAverage?.load1?.toFixed(2) || '-'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      5m: {linuxData.performance?.loadAverage?.load5?.toFixed(2)} / 15m: {linuxData.performance?.loadAverage?.load15?.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>

                {/* Services Summary Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Services</CardDescription>
                    <CardTitle className="text-lg text-green-600">
                      {linuxData.services?.summary?.active || 0} aktiv
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {linuxData.services?.summary?.failed || 0} fehlgeschlagen / {linuxData.services?.summary?.total || 0} total
                    </p>
                  </CardContent>
                </Card>

                {/* Updates Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Updates verfügbar</CardDescription>
                    <CardTitle className="text-lg">
                      {linuxData.updates?.totalUpdates || 0}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {linuxData.updates?.securityUpdates || 0} Security / via {linuxData.updates?.packageManager}
                    </p>
                  </CardContent>
                </Card>

                {/* Swap Usage Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Swap</CardDescription>
                    <CardTitle className="text-lg">
                      {linuxData.performance?.swap?.usedBytes 
                        ? ((linuxData.performance.swap.usedBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB')
                        : '0 GB'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      von {linuxData.performance?.swap?.totalBytes 
                        ? ((linuxData.performance.swap.totalBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB')
                        : '0 GB'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* CPU Cores */}
                <Card>
                  <CardHeader><CardTitle>🔲 CPU Cores</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-2">
                      {linuxData.performance?.cpuCores?.slice(0, 32).map((core) => (
                        <div key={core.core} className="text-center p-2 border rounded">
                          <p className="text-xs text-muted-foreground">Core {core.core}</p>
                          <p className={`font-bold ${core.usagePercent > 80 ? 'text-red-500' : core.usagePercent > 50 ? 'text-yellow-500' : 'text-green-500'}`}>
                            {core.usagePercent?.toFixed(0)}%
                          </p>
                        </div>
                      )) || <p className="col-span-4 text-muted-foreground">Keine Daten</p>}
                    </div>
                    {(linuxData.performance?.cpuCores?.length || 0) > 32 && (
                      <p className="text-sm text-muted-foreground mt-2">
                        +{(linuxData.performance?.cpuCores?.length || 0) - 32} weitere Cores
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Memory Details */}
                <Card>
                  <CardHeader><CardTitle>💾 Memory Details</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Total" value={linuxData.performance?.memory?.totalBytes 
                      ? ((linuxData.performance.memory.totalBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB') : null} />
                    <InfoRow label="Available" value={linuxData.performance?.memory?.availableBytes 
                      ? ((linuxData.performance.memory.availableBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB') : null} />
                    <InfoRow label="Buffers" value={linuxData.performance?.memory?.buffersBytes 
                      ? ((linuxData.performance.memory.buffersBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB') : null} />
                    <InfoRow label="Cached" value={linuxData.performance?.memory?.cachedBytes 
                      ? ((linuxData.performance.memory.cachedBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB') : null} />
                  </CardContent>
                </Card>

                {/* Disk Space */}
                <Card>
                  <CardHeader><CardTitle>💿 Disk Space</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mount</TableHead>
                          <TableHead>Frei</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Belegt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.performance?.diskSpace?.slice(0, 10).map((disk, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{disk.mount}</TableCell>
                            <TableCell>{(disk.availableBytes / 1024 / 1024 / 1024).toFixed(0)} GB</TableCell>
                            <TableCell>{(disk.totalBytes / 1024 / 1024 / 1024).toFixed(0)} GB</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full ${disk.usedPercent > 90 ? 'bg-red-500' : disk.usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                    style={{ width: `${disk.usedPercent}%` }}
                                  />
                                </div>
                                <span className="text-xs">{disk.usedPercent?.toFixed(0)}%</span>
                              </div>
                            </TableCell>
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

                {/* Services */}
                <Card>
                  <CardHeader>
                    <CardTitle>⚙️ Services ({linuxData.services?.summary?.total || 0})</CardTitle>
                    <CardDescription>
                      🟢 {linuxData.services?.summary?.active || 0} aktiv / 
                      🔴 {linuxData.services?.summary?.failed || 0} failed / 
                      ⚫ {linuxData.services?.summary?.inactive || 0} inaktiv
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Beschreibung</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.services?.services
                          ?.filter(s => s.activeState === 'failed' || s.activeState === 'active')
                          .slice(0, 50)
                          .map((svc, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{svc.name}</TableCell>
                            <TableCell>
                              <Badge className={
                                svc.activeState === 'active' ? 'bg-green-600' : 
                                svc.activeState === 'failed' ? 'bg-red-600' : 'bg-muted/500'
                              }>
                                {svc.activeState}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[200px]">{svc.description}</TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground">Keine Daten</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              {/* Package Updates */}
              {(linuxData.updates?.totalUpdates || 0) > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>📦 Verfügbare Updates ({linuxData.updates?.totalUpdates})</CardTitle>
                    <CardDescription>
                      Package Manager: {linuxData.updates?.packageManager} / 
                      Security: {linuxData.updates?.securityUpdates || 0}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Paket</TableHead>
                          <TableHead>Neue Version</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.updates?.updates?.slice(0, 30).map((pkg, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{pkg.name}</TableCell>
                            <TableCell>{pkg.newVersion}</TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">Keine Updates</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    {(linuxData.updates?.updates?.length || 0) > 30 && (
                      <p className="text-sm text-muted-foreground mt-2">
                        +{(linuxData.updates?.updates?.length || 0) - 30} weitere Pakete
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Disk Health */}
              {linuxData.diskHealth?.smartctlAvailable && (linuxData.diskHealth?.disks?.length || 0) > 0 && (
                <Card>
                  <CardHeader><CardTitle>🩺 Disk Health (SMART)</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Device</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Temp</TableHead>
                          <TableHead>Betriebsstunden</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.diskHealth?.disks?.map((disk, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{disk.device}</TableCell>
                            <TableCell>{disk.model}</TableCell>
                            <TableCell>
                              <Badge className={disk.healthStatus === 'PASSED' ? 'bg-green-600' : 'bg-red-600'}>
                                {disk.healthStatus}
                              </Badge>
                            </TableCell>
                            <TableCell>{disk.temperature}°C</TableCell>
                            <TableCell>{disk.powerOnHours?.toLocaleString()}h</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

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

          {/* Monitoring Health Tab */}
          <TabsContent value="monitoring" className="space-y-4">
            <MonitoringHealthPanel nodeId={nodeId} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
