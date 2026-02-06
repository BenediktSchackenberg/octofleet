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
  const browserData = browser?.data || {};

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
            <TabsTrigger value="hotfixes">Updates ({hfList.length})</TabsTrigger>
            <TabsTrigger value="network">Netzwerk</TabsTrigger>
            <TabsTrigger value="security">Sicherheit</TabsTrigger>
            <TabsTrigger value="browser">Browser</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Betriebssystem</CardDescription>
                  <CardTitle className="text-lg">{sysData.osName || hwData.osName || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{sysData.osVersion || hwData.osVersion}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>CPU</CardDescription>
                  <CardTitle className="text-lg truncate">{hwData.cpuName || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{hwData.cpuCores} Kerne / {hwData.cpuThreads} Threads</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>RAM</CardDescription>
                  <CardTitle className="text-lg">{hwData.totalMemoryGb?.toFixed(1)} GB</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{hwData.memoryModules?.length || 0} Module</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Grafikkarte</CardDescription>
                  <CardTitle className="text-lg truncate">{hwData.gpuName || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{hwData.gpuDriverVersion || '-'}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>System Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Hostname" value={hwData.computerName} />
                  <InfoRow label="Domain" value={sysData.domain || hwData.domain} />
                  <InfoRow label="Benutzer" value={sysData.currentUser} />
                  <InfoRow label="Boot Zeit" value={sysData.lastBootTime} />
                  <InfoRow label="Uptime" value={sysData.uptime} />
                  <InfoRow label="Timezone" value={sysData.timezone} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Netzwerk</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {netData.adapters?.slice(0, 4).map((adapter: { name: string; ipAddresses?: string[] }, i: number) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground truncate max-w-[150px]">{adapter.name}</span>
                      <span>{adapter.ipAddresses?.[0] || '-'}</span>
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
                  <InfoRow label="Name" value={hwData.cpuName} />
                  <InfoRow label="Kerne" value={hwData.cpuCores} />
                  <InfoRow label="Threads" value={hwData.cpuThreads} />
                  <InfoRow label="Max Clock" value={hwData.cpuMaxClockMhz ? `${hwData.cpuMaxClockMhz} MHz` : null} />
                  <InfoRow label="Architektur" value={hwData.cpuArchitecture} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Grafikkarte</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Name" value={hwData.gpuName} />
                  <InfoRow label="VRAM" value={hwData.gpuVramMb ? `${(hwData.gpuVramMb / 1024).toFixed(0)} GB` : null} />
                  <InfoRow label="Treiber" value={hwData.gpuDriverVersion} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Speicher</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Gesamt" value={hwData.totalMemoryGb ? `${hwData.totalMemoryGb.toFixed(1)} GB` : null} />
                  {hwData.memoryModules?.map((mod: { capacityGb: number; speed: number; manufacturer: string }, i: number) => (
                    <div key={i} className="text-sm text-muted-foreground">
                      Slot {i + 1}: {mod.capacityGb} GB @ {mod.speed} MHz ({mod.manufacturer})
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Festplatten</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {hwData.disks?.map((disk: { model: string; sizeGb: number; mediaType: string }, i: number) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-muted-foreground truncate max-w-[200px]">{disk.model}</span>
                      <span>{disk.sizeGb?.toFixed(0)} GB ({disk.mediaType})</span>
                    </div>
                  ))}
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
            <Card>
              <CardHeader>
                <CardTitle>Windows Updates ({hfList.length})</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="network">
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
          </TabsContent>

          <TabsContent value="security">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Antivirus</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Produkt" value={secData.antivirusProduct} />
                  <InfoRow label="Status" value={secData.antivirusEnabled ? '✅ Aktiv' : '❌ Inaktiv'} />
                  <InfoRow label="Aktuell" value={secData.antivirusUpToDate ? '✅ Ja' : '⚠️ Nein'} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Firewall</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Produkt" value={secData.firewallProduct} />
                  <InfoRow label="Status" value={secData.firewallEnabled ? '✅ Aktiv' : '❌ Inaktiv'} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>BitLocker</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Status" value={secData.bitlockerEnabled ? '🔒 Verschlüsselt' : '🔓 Nicht verschlüsselt'} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Windows Update</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label="Letztes Update" value={secData.lastWindowsUpdate} />
                  <InfoRow label="Ausstehend" value={secData.pendingUpdates?.toString()} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="browser">
            <div className="grid gap-4 md:grid-cols-3">
              {browserData.chrome && (
                <Card>
                  <CardHeader>
                    <CardTitle>🌐 Chrome</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Version" value={browserData.chrome.version} />
                    <InfoRow label="Extensions" value={browserData.chrome.extensionCount?.toString()} />
                  </CardContent>
                </Card>
              )}
              {browserData.firefox && (
                <Card>
                  <CardHeader>
                    <CardTitle>🦊 Firefox</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Version" value={browserData.firefox.version} />
                    <InfoRow label="Extensions" value={browserData.firefox.extensionCount?.toString()} />
                  </CardContent>
                </Card>
              )}
              {browserData.edge && (
                <Card>
                  <CardHeader>
                    <CardTitle>🔷 Edge</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label="Version" value={browserData.edge.version} />
                    <InfoRow label="Extensions" value={browserData.edge.extensionCount?.toString()} />
                  </CardContent>
                </Card>
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
