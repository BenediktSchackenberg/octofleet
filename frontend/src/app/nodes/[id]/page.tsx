import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { notFound } from "next/navigation";

const API_BASE = 'http://localhost:8080/api/v1';
const API_KEY = 'openclaw-inventory-dev-key';

async function fetchData(endpoint: string) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { 'X-API-Key': API_KEY },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NodeDetail({ params }: PageProps) {
  const { id } = await params;
  const nodeId = decodeURIComponent(id);
  
  // Fetch all data in parallel
  const [hardware, software, hotfixes, system, security, network, browser] = await Promise.all([
    fetchData(`/inventory/hardware/${nodeId}`),
    fetchData(`/inventory/software/${nodeId}`),
    fetchData(`/inventory/hotfixes/${nodeId}`),
    fetchData(`/inventory/system/${nodeId}`),
    fetchData(`/inventory/security/${nodeId}`),
    fetchData(`/inventory/network/${nodeId}`),
    fetchData(`/inventory/browser/${nodeId}`),
  ]);

  if (!hardware && !system) {
    notFound();
  }

  const hwData = hardware?.data || {};
  const sysData = system?.data || {};
  const secData = security?.data || {};
  const netData = network?.data || {};
  const swList = software?.data?.installedPrograms || [];
  const hfList = hotfixes?.data?.hotfixes || [];
  const updateHistoryList = hotfixes?.data?.updateHistory || [];
  const browserData = browser?.data || {};
  
  // Hardware uses: ram (not memory), gpu (not gpus), nics (not networkAdapters)
  const ramData = hwData.ram || {};
  const gpuList = hwData.gpu || [];
  const nicsList = hwData.nics || [];
  
  // Total updates count
  const totalUpdatesCount = hfList.length + updateHistoryList.length;

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" asChild>
            <Link href="/">← Zurück</Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{hwData.computerName || nodeId}</h1>
            <p className="text-muted-foreground">{nodeId}</p>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
            <TabsTrigger value="software">Software ({swList.length})</TabsTrigger>
            <TabsTrigger value="hotfixes">Updates ({totalUpdatesCount})</TabsTrigger>
            <TabsTrigger value="network">Netzwerk</TabsTrigger>
            <TabsTrigger value="security">Sicherheit</TabsTrigger>
            <TabsTrigger value="browser">Browser</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Betriebssystem</CardDescription>
                  <CardTitle className="text-lg">{sysData.osName || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{sysData.osVersion || sysData.osBuild}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>CPU</CardDescription>
                  <CardTitle className="text-lg truncate">{hwData.cpu?.name || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{hwData.cpu?.cores || '-'} Kerne / {hwData.cpu?.logicalProcessors || '-'} Threads</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>RAM</CardDescription>
                  <CardTitle className="text-lg">{ramData.totalGb?.toFixed(1) || ramData.totalGB?.toFixed(1) || '-'} GB</CardTitle>
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
                  <p className="text-sm text-muted-foreground">{gpuList[0]?.driverVersion || '-'}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>System Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Mainboard" value={hwData.mainboard?.product ? `${hwData.mainboard.manufacturer} ${hwData.mainboard.product}` : null} />
                  <InfoRow label="BIOS Version" value={hwData.bios?.smbiosVersion || hwData.bios?.name} />
                  <InfoRow label="BIOS Datum" value={hwData.bios?.releaseDate} />
                  <InfoRow label="System UUID" value={hwData.bios?.uuid} />
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
                <CardHeader>
                  <CardTitle>Virtualisierung & Domain</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {hwData.virtualization ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Typ</span>
                        <Badge variant={hwData.virtualization.isVirtual ? "secondary" : "default"}>
                          {hwData.virtualization.hypervisor || (hwData.virtualization.isVirtual ? "Virtual" : "Physical")}
                        </Badge>
                      </div>
                      {hwData.virtualization.isVirtual && (
                        <InfoRow label="VM Model" value={hwData.virtualization.model} />
                      )}
                    </>
                  ) : (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Typ</span>
                      <Badge variant="outline">
                        ⏳ Warte auf Agent-Update
                      </Badge>
                    </div>
                  )}
                  {/* Support both nested (sysData.os.computerName) and flat (hwData.computerName) structure */}
                  <InfoRow label="Computer Name" value={sysData.os?.computerName || hwData.computerName || nodeId} />
                  {(sysData.os?.isDomainJoined !== undefined || sysData.isDomainJoined !== undefined) ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Domain Status</span>
                        <Badge variant={(sysData.os?.isDomainJoined || sysData.isDomainJoined) ? "default" : "secondary"}>
                          {(sysData.os?.isDomainJoined || sysData.isDomainJoined) ? "Domain-joined" : "Workgroup"}
                        </Badge>
                      </div>
                      <InfoRow 
                        label={(sysData.os?.isDomainJoined || sysData.isDomainJoined) ? "Domain" : "Workgroup"} 
                        value={(sysData.os?.isDomainJoined || sysData.isDomainJoined) 
                          ? (sysData.os?.domain || sysData.domain) 
                          : (sysData.os?.workgroup || sysData.workgroup)} 
                      />
                      <InfoRow label="Domain Role" value={sysData.os?.domainRole || sysData.domainRole} />
                    </>
                  ) : (
                    <p className="text-muted-foreground text-xs mt-2">
                      💡 Domain-Daten erscheinen nach Agent-Update
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Netzwerk</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Verbindungen" value={netData.connections?.total?.toString()} />
                  {netData.connections?.summary?.slice(0, 3).map((s: { state: string; count: number }, i: number) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{s.state}</span>
                      <span>{s.count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="hardware">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Prozessor</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Name" value={hwData.cpu?.name} />
                  <InfoRow label="Kerne" value={hwData.cpu?.cores} />
                  <InfoRow label="Threads" value={hwData.cpu?.logicalProcessors} />
                  <InfoRow label="Max Clock" value={hwData.cpu?.maxClockSpeedMHz ? `${hwData.cpu.maxClockSpeedMHz} MHz` : null} />
                  <InfoRow label="Architektur" value={hwData.cpu?.architecture} />
                  <InfoRow label="Socket" value={hwData.cpu?.socketDesignation} />
                  <InfoRow label="L2 Cache" value={hwData.cpu?.l2CacheKB ? `${(hwData.cpu.l2CacheKB / 1024).toFixed(0)} MB` : null} />
                  <InfoRow label="L3 Cache" value={hwData.cpu?.l3CacheKB ? `${(hwData.cpu.l3CacheKB / 1024).toFixed(0)} MB` : null} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>BIOS / UEFI</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Hersteller" value={hwData.bios?.manufacturer} />
                  <InfoRow label="Version" value={hwData.bios?.smbiosVersion || hwData.bios?.name} />
                  <InfoRow label="Datum" value={hwData.bios?.releaseDate} />
                  <InfoRow label="UUID" value={hwData.bios?.uuid} />
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
                <CardHeader>
                  <CardTitle>Mainboard</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Hersteller" value={hwData.mainboard?.manufacturer} />
                  <InfoRow label="Produkt" value={hwData.mainboard?.product} />
                  <InfoRow label="Version" value={hwData.mainboard?.version} />
                  <InfoRow label="Seriennummer" value={hwData.mainboard?.serialNumber} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Virtualisierung</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {hwData.virtualization ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Typ</span>
                        <Badge variant={hwData.virtualization.isVirtual ? "secondary" : "default"}>
                          {hwData.virtualization.isVirtual ? "Virtual Machine" : "Physical Hardware"}
                        </Badge>
                      </div>
                      <InfoRow label="Hypervisor" value={hwData.virtualization.hypervisor} />
                      <InfoRow label="Hersteller" value={hwData.virtualization.manufacturer} />
                      <InfoRow label="Model" value={hwData.virtualization.model} />
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">Keine Virtualisierungsdaten</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Grafikkarte(n)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {gpuList.length > 0 ? gpuList.map((gpu: { name: string; vramMB: number; videoMemoryGB: number; driverVersion: string; driverDate: string; currentResolution: string; refreshRate: string }, i: number) => (
                    <div key={i} className="mb-3 pb-3 border-b last:border-0">
                      <InfoRow label="Name" value={gpu.name} />
                      <InfoRow label="VRAM" value={gpu.videoMemoryGB ? `${gpu.videoMemoryGB} GB` : (gpu.vramMB ? `${(gpu.vramMB / 1024).toFixed(0)} GB` : null)} />
                      <InfoRow label="Treiber" value={gpu.driverVersion} />
                      <InfoRow label="Treiber Datum" value={gpu.driverDate} />
                      <InfoRow label="Auflösung" value={gpu.currentResolution && gpu.currentResolution !== "x" ? `${gpu.currentResolution} @ ${gpu.refreshRate}Hz` : null} />
                    </div>
                  )) : <p className="text-muted-foreground text-sm">Keine GPU-Daten</p>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Speicher (RAM)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Gesamt" value={ramData.totalGb ? `${ramData.totalGb.toFixed(1)} GB` : (ramData.totalGB ? `${ramData.totalGB.toFixed(1)} GB` : null)} />
                  <InfoRow label="Module" value={ramData.moduleCount?.toString()} />
                  {(ramData.modules || []).map((mod: { capacityGb: number; capacityGB: number; speedMHz: number; manufacturer: string; partNumber: string; memoryType: string; deviceLocator: string }, i: number) => (
                    <div key={i} className="text-sm text-muted-foreground border-t pt-2 mt-2">
                      <div className="font-medium text-foreground">{mod.deviceLocator || `Slot ${i + 1}`}</div>
                      <div>{mod.capacityGb || mod.capacityGB} GB {mod.memoryType} @ {mod.speedMHz} MHz</div>
                      <div>{mod.manufacturer} {mod.partNumber}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Festplatten</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium mb-2">Physische Laufwerke</h4>
                    {(hwData.disks?.physical || []).map((disk: { model: string; sizeGB: number; mediaType: string; interfaceType: string; serialNumber: string }, i: number) => (
                      <div key={i} className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground truncate max-w-[300px]">{disk.model}</span>
                        <span>{disk.sizeGB?.toFixed(0)} GB ({disk.interfaceType})</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="text-sm font-medium mb-2">Volumes</h4>
                    {(hwData.disks?.volumes || []).map((vol: { driveLetter: string; volumeName: string; sizeGB: number; freeGB: number; fileSystem: string; usedPercent: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{vol.driveLetter} {vol.volumeName && `(${vol.volumeName})`}</span>
                        <span>{vol.freeGB?.toFixed(0)}/{vol.sizeGB?.toFixed(0)} GB frei ({vol.fileSystem})</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="software">
            <Card>
              <CardHeader>
                <CardTitle>Installierte Software ({swList.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Hersteller</TableHead>
                      <TableHead>Installiert</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {swList.slice(0, 100).map((sw: { name: string; version: string; publisher: string; installDate: string }, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{sw.name}</TableCell>
                        <TableCell>{sw.version || '-'}</TableCell>
                        <TableCell>{sw.publisher || '-'}</TableCell>
                        <TableCell>{sw.installDate || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {swList.length > 100 && (
                  <p className="text-sm text-muted-foreground mt-4">
                    Zeige 100 von {swList.length} Einträgen
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="hotfixes">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Klassische Hotfixes ({hfList.length})</CardTitle>
                  <CardDescription>Via WMI / Get-HotFix</CardDescription>
                </CardHeader>
                <CardContent>
                  {hfList.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>HotfixID</TableHead>
                          <TableHead>Beschreibung</TableHead>
                          <TableHead>Installiert am</TableHead>
                          <TableHead>Installiert von</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hfList.map((hf: { hotfixId: string; description: string; installedOn: string; installedBy: string }, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{hf.hotfixId}</TableCell>
                            <TableCell>{hf.description || '-'}</TableCell>
                            <TableCell>{hf.installedOn || '-'}</TableCell>
                            <TableCell>{hf.installedBy || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground text-sm">Keine klassischen Hotfixes gefunden</p>
                  )}
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader>
                  <CardTitle>Windows Update History ({updateHistoryList.length})</CardTitle>
                  <CardDescription>Alle installierten Updates via Windows Update</CardDescription>
                </CardHeader>
                <CardContent>
                  {updateHistoryList.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">KB</TableHead>
                          <TableHead>Titel</TableHead>
                          <TableHead className="w-[150px]">Installiert am</TableHead>
                          <TableHead className="w-[100px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {updateHistoryList.slice(0, 100).map((upd: { kbId: string; title: string; installedOn: string; resultCode: string; operation: string; supportUrl: string; categories: string[] }, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{upd.kbId || '-'}</TableCell>
                            <TableCell className="max-w-[400px] truncate" title={upd.title}>
                              {upd.supportUrl ? (
                                <a href={upd.supportUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  {upd.title}
                                </a>
                              ) : upd.title}
                            </TableCell>
                            <TableCell className="text-xs">{upd.installedOn?.replace('T', ' ').slice(0, 19) || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={upd.resultCode === 'Succeeded' ? 'default' : upd.resultCode === 'Failed' ? 'destructive' : 'secondary'}>
                                {upd.resultCode || upd.operation}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground text-sm">Keine Update History vorhanden</p>
                  )}
                  {updateHistoryList.length > 100 && (
                    <p className="text-sm text-muted-foreground mt-4">
                      Zeige 100 von {updateHistoryList.length} Einträgen
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="network">
            <div className="space-y-4">
              {netData.adapters?.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Netzwerkadapter</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {netData.adapters?.map((adapter: { name: string; status: string; macAddress: string; ipAddresses?: string[]; gateway?: string; dnsServers?: string[] }, i: number) => (
                        <div key={i} className="border rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium">{adapter.name}</span>
                            <Badge variant={adapter.status === 'Up' ? 'default' : 'secondary'}>
                              {adapter.status}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <InfoRow label="MAC" value={adapter.macAddress} />
                            <InfoRow label="IP" value={adapter.ipAddresses?.join(', ')} />
                            <InfoRow label="Gateway" value={adapter.gateway} />
                            <InfoRow label="DNS" value={adapter.dnsServers?.join(', ')} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
              
              <Card>
                <CardHeader>
                  <CardTitle>Aktive Verbindungen ({netData.connections?.total || 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  {netData.connections?.summary?.length > 0 ? (
                    <div className="mb-4 flex gap-4">
                      {netData.connections.summary.map((s: { state: string; count: number }, i: number) => (
                        <Badge key={i} variant="outline">{s.state}: {s.count}</Badge>
                      ))}
                    </div>
                  ) : null}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lokal</TableHead>
                        <TableHead>Remote</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(netData.connections?.connections || []).filter((c: { remoteAddress: string }) => !c.remoteAddress.startsWith('127.')).slice(0, 30).map((conn: { localAddress: string; localPort: number; remoteAddress: string; remotePort: number; state: string }, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{conn.localAddress}:{conn.localPort}</TableCell>
                          <TableCell className="font-mono text-xs">{conn.remoteAddress}:{conn.remotePort}</TableCell>
                          <TableCell>
                            <Badge variant={conn.state === 'Established' ? 'default' : 'secondary'}>{conn.state}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="security">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Windows Defender</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {secData.defender && Object.keys(secData.defender).length > 0 ? (
                    <>
                      <InfoRow label="Echtzeitschutz" value={secData.defender.realTimeProtection ? '✅ Aktiv' : '❌ Inaktiv'} />
                      <InfoRow label="Definitionen" value={secData.defender.definitionsUpToDate ? '✅ Aktuell' : '⚠️ Veraltet'} />
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">Keine Defender-Daten</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Firewall</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {secData.firewall?.profiles?.map((profile: { name: string; enabled: boolean }, i: number) => (
                    <InfoRow key={i} label={profile.name} value={profile.enabled ? '✅ Aktiv' : '❌ Inaktiv'} />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>TPM</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Vorhanden" value={secData.tpm?.present ? '✅ Ja' : '❌ Nein'} />
                  <InfoRow label="Aktiviert" value={secData.tpm?.enabled ? '✅ Ja' : '❌ Nein'} />
                  <InfoRow label="Version" value={secData.tpm?.manufacturerVersion} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>UAC</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Aktiviert" value={secData.uac?.enabled ? '✅ Ja' : '❌ Nein'} />
                  <InfoRow label="Secure Desktop" value={secData.uac?.secureDesktopPrompt ? '✅ Ja' : '❌ Nein'} />
                </CardContent>
              </Card>
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>BitLocker</CardTitle>
                </CardHeader>
                <CardContent>
                  {secData.bitlocker?.available ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Volume</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Schutz</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {secData.bitlocker.volumes?.map((vol: { mountPoint: string; volumeStatus: string; protectionStatus: string }, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{vol.mountPoint}</TableCell>
                            <TableCell>{vol.volumeStatus === '0' ? 'Nicht verschlüsselt' : 'Verschlüsselt'}</TableCell>
                            <TableCell>{vol.protectionStatus === '0' ? '🔓 Aus' : '🔒 An'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground text-sm">BitLocker nicht verfügbar</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="browser">
            <div className="grid gap-4 md:grid-cols-3">
              {browserData.Chrome && (
                <Card>
                  <CardHeader>
                    <CardTitle>🌐 Chrome</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Profile" value={browserData.Chrome.profiles?.length?.toString() || '0'} />
                    <InfoRow label="Extensions" value={browserData.Chrome.extensionCount?.toString()} />
                    {browserData.Chrome.profiles?.map((p: { name: string; historyCount: number; bookmarkCount: number }, i: number) => (
                      <div key={i} className="text-xs text-muted-foreground mt-2 border-t pt-2">
                        <p className="font-medium">{p.name}</p>
                        <p>History: {p.historyCount || 0} | Bookmarks: {p.bookmarkCount || 0}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {browserData.Edge && (
                <Card>
                  <CardHeader>
                    <CardTitle>🔷 Edge</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Profile" value={browserData.Edge.profiles?.length?.toString() || '0'} />
                    <InfoRow label="Extensions" value={browserData.Edge.extensionCount?.toString()} />
                    {browserData.Edge.profiles?.map((p: { name: string; historyCount: number; bookmarkCount: number }, i: number) => (
                      <div key={i} className="text-xs text-muted-foreground mt-2 border-t pt-2">
                        <p className="font-medium">{p.name}</p>
                        <p>History: {p.historyCount || 0} | Bookmarks: {p.bookmarkCount || 0}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {browserData.Firefox && (
                <Card>
                  <CardHeader>
                    <CardTitle>🦊 Firefox</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Profile" value={browserData.Firefox.profiles?.length?.toString() || '0'} />
                    <InfoRow label="Extensions" value={browserData.Firefox.extensionCount?.toString()} />
                  </CardContent>
                </Card>
              )}
              {!browserData.Chrome && !browserData.Edge && !browserData.Firefox && (
                <p className="text-muted-foreground col-span-3">Keine Browser-Daten vorhanden</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value || '-'}</span>
    </div>
  );
}
