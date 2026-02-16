"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { RefreshCw, Cpu, MemoryStick, HardDrive, TrendingUp, Activity, ArrowUpDown } from "lucide-react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "openclaw-inventory-dev-key";

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
}

interface FleetData {
  timestamp: string;
  hoursAggregated: number;
  totalNodes: number;
  nodesWithMetrics: number;
  fleet: { avgCpu: number | null; avgRam: number | null; avgDisk: number | null };
  nodes: NodeMetrics[];
}

type SortField = "hostname" | "avgCpu" | "maxCpu" | "avgRam" | "avgDisk" | "netIn" | "netOut";
type SortDir = "asc" | "desc";

export default function PerformancePage() {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sortField, setSortField] = useState<SortField>("avgCpu");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  async function fetchData() {
    try {
      const res = await fetch(`${API_BASE}/metrics/fleet?hours=1`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefresh(new Date());
      }
    } catch (e) {
      console.error("Failed to fetch fleet metrics:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedNodes = data?.nodes.slice().sort((a, b) => {
    if (sortField === "hostname") {
      return sortDir === "asc"
        ? (a.hostname || "").localeCompare(b.hostname || "")
        : (b.hostname || "").localeCompare(a.hostname || "");
    }
    
    let aVal: number | null = null;
    let bVal: number | null = null;
    
    switch (sortField) {
      case "avgCpu": aVal = a.cpu.avg; bVal = b.cpu.avg; break;
      case "maxCpu": aVal = a.cpu.max; bVal = b.cpu.max; break;
      case "avgRam": aVal = a.ram.avg; bVal = b.ram.avg; break;
      case "avgDisk": aVal = a.disk.avg; bVal = b.disk.avg; break;
      case "netIn": aVal = a.network.avgIn; bVal = b.network.avgIn; break;
      case "netOut": aVal = a.network.avgOut; bVal = b.network.avgOut; break;
    }

    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  const PercentBar = ({ value, color }: { value: number | null; color: string }) => {
    if (value === null) return <span className="text-muted-foreground">-</span>;
    const percent = Math.min(value, 100);
    const bgColor = value > 90 ? "bg-red-500" : value > 70 ? "bg-yellow-500" : 
                    color === "green" ? "bg-green-500" : color === "purple" ? "bg-purple-500" : "bg-blue-500";
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${bgColor}`} style={{ width: `${percent}%` }} />
        </div>
        <span className="text-sm font-mono w-12">{value.toFixed(1)}%</span>
      </div>
    );
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
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-[1600px] mx-auto">
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Performance" }]} />

        {/* Header */}
        <div className="flex items-center justify-between mb-6 mt-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Activity className="h-8 w-8 text-blue-500" />
              Fleet Performance
            </h1>
            <p className="text-muted-foreground">Echtzeit-Übersicht aller Nodes • Letzte Stunde</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
              Auto-Refresh (30s)
            </label>
            <Button variant="outline" onClick={fetchData} className="gap-1">
              <RefreshCw className="h-4 w-4" /> Aktualisieren
            </Button>
            {lastRefresh && <span className="text-xs text-muted-foreground">{lastRefresh.toLocaleTimeString("de-DE")}</span>}
          </div>
        </div>

        {/* Fleet Summary Cards */}
        {data && (
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Nodes mit Metriken</CardDescription>
                <CardTitle className="text-3xl">{data.nodesWithMetrics} / {data.totalNodes}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><Cpu className="h-4 w-4" /> Fleet Avg CPU</CardDescription>
                <CardTitle className="text-3xl">{data.fleet.avgCpu?.toFixed(1) ?? "-"}%</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><MemoryStick className="h-4 w-4" /> Fleet Avg RAM</CardDescription>
                <CardTitle className="text-3xl">{data.fleet.avgRam?.toFixed(1) ?? "-"}%</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1"><HardDrive className="h-4 w-4" /> Fleet Avg Disk</CardDescription>
                <CardTitle className="text-3xl">{data.fleet.avgDisk?.toFixed(1) ?? "-"}%</CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Performance Table */}
        {data && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Node Performance</CardTitle>
              <CardDescription>Klicke auf einen Node für 7-Tage Performance-Charts</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("hostname")}>
                      Hostname {sortField === "hostname" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("avgCpu")}>
                      Avg CPU {sortField === "avgCpu" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("maxCpu")}>
                      Max CPU {sortField === "maxCpu" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("avgRam")}>
                      Avg RAM {sortField === "avgRam" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("avgDisk")}>
                      Avg Disk {sortField === "avgDisk" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("netIn")}>
                      Net In {sortField === "netIn" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("netOut")}>
                      Net Out {sortField === "netOut" && <ArrowUpDown className="inline h-3 w-3" />}
                    </TableHead>
                    <TableHead>Samples</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedNodes?.map((node) => (
                    <TableRow key={node.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">
                        <Link href={`/nodes/${node.nodeId}?tab=performance`} className="hover:text-primary hover:underline">
                          {node.hostname}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {node.isOnline ? <Badge className="bg-green-600">Online</Badge> : <Badge variant="secondary">Offline</Badge>}
                      </TableCell>
                      <TableCell><PercentBar value={node.cpu.avg} color="blue" /></TableCell>
                      <TableCell><PercentBar value={node.cpu.max} color="blue" /></TableCell>
                      <TableCell><PercentBar value={node.ram.avg} color="green" /></TableCell>
                      <TableCell><PercentBar value={node.disk.avg} color="purple" /></TableCell>
                      <TableCell className="font-mono text-sm">{node.network.avgIn?.toFixed(2) ?? "-"}</TableCell>
                      <TableCell className="font-mono text-sm">{node.network.avgOut?.toFixed(2) ?? "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{node.dataPoints}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {!data && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Keine Performance-Daten verfügbar</p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
