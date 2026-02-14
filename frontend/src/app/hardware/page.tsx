"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { getAuthHeader } from "@/lib/auth-context";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080/api/v1';

interface PhysicalDisk {
  nodeId: string;
  hostname: string;
  model: string;
  sizeGB: number;
  busType: string;
  isSsd: boolean | null;
  healthStatus: string;
  temperature: number | null;
  wearLevel: number | null;
}

interface FleetHardware {
  nodeCount: number;
  cpuTypes: { name: string; count: number }[];
  ramDistribution: { "8GB": number; "16GB": number; "32GB": number; "64GB+": number };
  storage: {
    totalTB: number;
    freeTB: number;
    usedTB: number;
    usedPercent: number;
  };
  diskHealth: { healthy: number; warning: number; critical: number };
  physicalDiskHealth: { healthy: number; warning: number; unhealthy: number; unknown: number };
  diskTypes: { ssd: number; hdd: number; unknown: number };
  busTypes: { name: string; count: number }[];
  physicalDisks: PhysicalDisk[];
  issues: { nodeId: string; hostname: string; issue: string; severity: string }[];
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full h-4 bg-secondary rounded-full overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function HealthBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'healthy') return <Badge className="bg-green-500">✓ Healthy</Badge>;
  if (s === 'warning') return <Badge className="bg-yellow-500">⚠ Warning</Badge>;
  if (s === 'unhealthy') return <Badge variant="destructive">✗ Unhealthy</Badge>;
  return <Badge variant="outline">? Unknown</Badge>;
}

export default function FleetHardwarePage() {
  const [data, setData] = useState<FleetHardware | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`${API_BASE}/hardware/fleet`, { headers: getAuthHeader() });
        if (res.ok) {
          setData(await res.json());
        }
      } catch (err) {
        console.error("Failed to fetch fleet hardware:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground">Lade Hardware-Übersicht...</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground">Keine Daten verfügbar</p>
        </div>
      </main>
    );
  }

  const ramTotal = data.ramDistribution["8GB"] + data.ramDistribution["16GB"] + 
                   data.ramDistribution["32GB"] + data.ramDistribution["64GB+"];
  const diskTotal = data.diskHealth.healthy + data.diskHealth.warning + data.diskHealth.critical;
  const physicalTotal = data.physicalDiskHealth.healthy + data.physicalDiskHealth.warning + 
                        data.physicalDiskHealth.unhealthy + data.physicalDiskHealth.unknown;
  const diskTypeTotal = data.diskTypes.ssd + data.diskTypes.hdd + data.diskTypes.unknown;

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <Breadcrumb items={[{ label: "Hardware Fleet" }]} />
        
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">🖥️ Hardware Fleet Overview</h1>
            <p className="text-muted-foreground mt-1">{data.nodeCount} Nodes erfasst</p>
          </div>
        </div>

        {/* Issues Banner */}
        {data.issues.length > 0 && (
          <Card className="mb-6 border-yellow-500 bg-yellow-500/10">
            <CardHeader>
              <CardTitle className="text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
                ⚠️ Auffälligkeiten
                <Badge variant="outline">{data.issues.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.issues.slice(0, 5).map((issue, i) => (
                  <div key={i} className="flex items-center justify-between p-2 border rounded">
                    <div className="flex items-center gap-2">
                      <Badge variant={issue.severity === "critical" ? "destructive" : "secondary"}>
                        {issue.severity === "critical" ? "🔴" : "🟡"} {issue.severity}
                      </Badge>
                      <Link href={`/nodes/${issue.nodeId}`} className="font-medium hover:underline">
                        {issue.hostname}
                      </Link>
                    </div>
                    <span className="text-sm text-muted-foreground">{issue.issue}</span>
                  </div>
                ))}
                {data.issues.length > 5 && (
                  <p className="text-sm text-muted-foreground text-center">
                    ... und {data.issues.length - 5} weitere
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid - Row 1 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gesamtspeicher</CardDescription>
              <CardTitle className="text-2xl">{data.storage.totalTB.toFixed(1)} TB</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Belegt</span>
                  <span>{data.storage.usedTB.toFixed(1)} TB ({data.storage.usedPercent}%)</span>
                </div>
                <ProgressBar 
                  value={data.storage.usedTB} 
                  max={data.storage.totalTB} 
                  color={data.storage.usedPercent > 80 ? "bg-red-500" : data.storage.usedPercent > 60 ? "bg-yellow-500" : "bg-green-500"}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Physical Disk Health</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                {data.physicalDiskHealth.unhealthy > 0 ? "🔴" : data.physicalDiskHealth.warning > 0 ? "🟡" : "🟢"}
                {physicalTotal} Disks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 text-sm flex-wrap">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>{data.physicalDiskHealth.healthy}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span>{data.physicalDiskHealth.warning}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span>{data.physicalDiskHealth.unhealthy}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-gray-500" />
                  <span>{data.physicalDiskHealth.unknown}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>SSD vs HDD</CardDescription>
              <CardTitle className="text-2xl">{diskTypeTotal} Disks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>💾 SSD</span>
                  <span className="font-mono">{data.diskTypes.ssd}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>📀 HDD</span>
                  <span className="font-mono">{data.diskTypes.hdd}</span>
                </div>
                {data.diskTypes.unknown > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>❓ Unknown</span>
                    <span className="font-mono">{data.diskTypes.unknown}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Bus Types</CardDescription>
              <CardTitle className="text-2xl">{data.busTypes.length} Typen</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                {data.busTypes.slice(0, 4).map((bus, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{bus.name}</span>
                    <Badge variant="outline">{bus.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stats Grid - Row 2 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Volume Health</CardDescription>
              <CardTitle className="text-2xl flex items-center gap-2">
                {data.diskHealth.critical > 0 ? "🔴" : data.diskHealth.warning > 0 ? "🟡" : "🟢"}
                {diskTotal} Volumes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>{data.diskHealth.healthy} OK</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span>{data.diskHealth.warning} Warn</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span>{data.diskHealth.critical} Crit</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>RAM Verteilung</CardDescription>
              <CardTitle className="text-2xl">{ramTotal} Nodes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>64GB+</span>
                  <span className="font-mono">{data.ramDistribution["64GB+"]}</span>
                </div>
                <div className="flex justify-between">
                  <span>32GB</span>
                  <span className="font-mono">{data.ramDistribution["32GB"]}</span>
                </div>
                <div className="flex justify-between">
                  <span>16GB</span>
                  <span className="font-mono">{data.ramDistribution["16GB"]}</span>
                </div>
                <div className="flex justify-between">
                  <span>≤8GB</span>
                  <span className="font-mono">{data.ramDistribution["8GB"]}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardDescription>CPU Typen</CardDescription>
              <CardTitle className="text-2xl">{data.cpuTypes.length} Modelle</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {data.cpuTypes.slice(0, 6).map((cpu, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="truncate max-w-[200px]" title={cpu.name}>{cpu.name}</span>
                    <Badge variant="outline" className="ml-2 shrink-0">{cpu.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Physical Disks Table */}
        {data.physicalDisks.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>💽 Physical Disks</CardTitle>
              <CardDescription>Alle physischen Festplatten in der Fleet mit SMART-Status</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Node</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Bus</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead className="text-right">Temp</TableHead>
                    <TableHead className="text-right">Wear</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.physicalDisks.map((disk, i) => (
                    <TableRow key={i} className={disk.healthStatus.toLowerCase() === 'unhealthy' ? 'bg-red-500/10' : disk.healthStatus.toLowerCase() === 'warning' ? 'bg-yellow-500/10' : ''}>
                      <TableCell>
                        <Link href={`/nodes/${disk.nodeId}`} className="hover:underline font-medium">
                          {disk.hostname}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm max-w-[200px] truncate" title={disk.model}>
                        {disk.model || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {disk.sizeGB > 1000 ? `${(disk.sizeGB / 1024).toFixed(1)} TB` : `${disk.sizeGB} GB`}
                      </TableCell>
                      <TableCell>
                        {disk.isSsd === true ? '💾 SSD' : disk.isSsd === false ? '📀 HDD' : '❓'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{disk.busType}</Badge>
                      </TableCell>
                      <TableCell>
                        <HealthBadge status={disk.healthStatus} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {disk.temperature != null ? (
                          <span className={disk.temperature > 60 ? 'text-red-500' : disk.temperature > 50 ? 'text-yellow-500' : ''}>
                            {disk.temperature}°C
                          </span>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {disk.wearLevel != null ? (
                          <span className={disk.wearLevel > 80 ? 'text-red-500' : disk.wearLevel > 50 ? 'text-yellow-500' : ''}>
                            {disk.wearLevel}%
                          </span>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* CPU Types Table */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>🔲 CPU Typen</CardTitle>
            <CardDescription>Verteilung der Prozessoren in der Fleet</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CPU Modell</TableHead>
                  <TableHead className="text-right">Anzahl</TableHead>
                  <TableHead className="text-right">Anteil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cpuTypes.map((cpu, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{cpu.name}</TableCell>
                    <TableCell className="text-right font-mono">{cpu.count}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary" 
                            style={{ width: `${(cpu.count / data.nodeCount) * 100}%` }} 
                          />
                        </div>
                        <span className="text-sm text-muted-foreground w-12">
                          {((cpu.count / data.nodeCount) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* RAM Distribution Chart */}
        <Card>
          <CardHeader>
            <CardTitle>💾 RAM Verteilung</CardTitle>
            <CardDescription>Arbeitsspeicher-Ausstattung der Nodes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(data.ramDistribution).map(([size, count]) => (
                <div key={size} className="text-center p-4 border rounded-lg">
                  <div className="text-3xl font-bold">{count}</div>
                  <div className="text-sm text-muted-foreground mt-1">{size}</div>
                  <div className="mt-2">
                    <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500" 
                        style={{ width: `${ramTotal > 0 ? (count / ramTotal) * 100 : 0}%` }} 
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
