"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { RefreshCw, Cpu, MemoryStick, HardDrive, Network, ArrowUpDown, TrendingUp, Activity } from "lucide-react";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/metrics/fleet?hours=1`, {
        headers: { "X-API-Key": API_KEY },
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
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedNodes = data?.nodes.slice().sort((a, b) => {
    let aVal: number | null = null;
    let bVal: number | null = null;

    switch (sortField) {
      case "hostname":
        return sortDir === "asc"
          ? (a.hostname || "").localeCompare(b.hostname || "")
          : (b.hostname || "").localeCompare(a.hostname || "");
      case "avgCpu":
        aVal = a.cpu.avg;
        bVal = b.cpu.avg;
        break;
      case "maxCpu":
        aVal = a.cpu.max;
        bVal = b.cpu.max;
        break;
      case "avgRam":
        aVal = a.ram.avg;
        bVal = b.ram.avg;
        break;
      case "avgDisk":
        aVal = a.disk.avg;
        bVal = b.disk.avg;
        break;
      case "netIn":
        aVal = a.network.avgIn;
        bVal = b.network.avgIn;
        break;
      case "netOut":
        aVal = a.network.avgOut;
        bVal = b.network.avgOut;
        break;
    }

    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sortDir === "asc" ? aVal - bVal : bVal - aVal;
  });

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <ArrowUpDown className={`h-3 w-3 ${sortDir === "desc" ? "rotate-180" : ""}`} />
        )}
      </div>
    </TableHead>
  );

  const PercentBar = ({ value, max = 100, color = "blue" }: { value: number | null; max?: number; color?: string }) => {
    if (value === null) return <span className="text-muted-foreground">-</span>;
    const percent = Math.min((value / max) * 100, 100);
    const colorClass =
      value > 90 ? "bg-red-500" : value > 70 ? "bg-yellow-500" : `bg-${color}-500`;
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${colorClass}`} style={{ width: `${percent}%` }} />
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
        {/* Breadcrumb */}
        <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "Performance" }]} />

        {/* Header */}
        <div className="flex items-center justify-between mb-6 mt-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Activity className="h-8 w-8 text-blue-500" />
              Fleet Performance
            </h1>
            <p className="text-muted-foreground">
              Echtzeit-Übersicht aller Nodes • Letzte Stunde
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-Refresh (30s)
            </label>
            <Button variant="outline" onClick={fetchData} className="gap-1">
              <RefreshCw className="h-4 w-4" />
              Aktualisieren
            </Button>
            {lastRefresh && (
              <span className="text-xs text-muted-foreground">
                {lastRefresh.toLocaleTimeString("de-DE")}
              </span>
            )}
          </div>
        </div>

        {/* Fleet Summary Cards */}
        {data && (
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Nodes mit Metriken</CardDescription>
                <CardTitle className="text-3xl">
                  {data.nodesWithMetrics} / {data.totalNodes}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Cpu className="h-4 w-4" /> Fleet Avg CPU
                </CardDescription>
                <CardTitle className="text-3xl">
                  {data.fleet.avgCpu?.toFixed(1) ?? "-"}%
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <MemoryStick className="h-4 w-4" /> Fleet Avg RAM
                </CardDescription>
                <CardTitle className="text-3xl">
                  {data.fleet.avgRam?.toFixed(1) ?? "-"}%
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <HardDrive className="h-4 w-4" /> Fleet Avg Disk
                </CardDescription>
                <CardTitle className="text-3xl">
                  {data.fleet.avgDisk?.toFixed(1) ?? "-"}%
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Node Performance
            </CardTitle>
            <CardDescription>
              Klicke auf einen Node für 7-Tage Performance-Charts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader field="hostname">Hostname</SortHeader>
                    <TableHead>Status</TableHead>
                    <SortHeader field="avgCpu">Avg CPU</SortHeader>
                    <SortHeader field="maxCpu">Max CPU</SortHeader>
                    <SortHeader field="avgRam">Avg RAM</SortHeader>
                    <SortHeader field="avgDisk">Avg Disk</SortHeader>
                    <SortHeader field="netIn">Net In (MB/s)</SortHeader>
                    <SortHeader field="netOut">Net Out (MB/s)</SortHeader>
                    <TableHead>Samples</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedNodes?.map((node) => (
                    <TableRow
                      key={node.id}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/nodes/${node.id}?tab=performance`}
                          className="hover:text-primary hover:underline"
                        >
                          {node.hostname}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {node.isOnline ? (
                          <Badge className="bg-green-600">Online</Badge>
                        ) : (
                          <Badge variant="secondary">Offline</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <PercentBar value={node.cpu.avg} color="blue" />
                      </TableCell>
                      <TableCell>
                        <PercentBar value={node.cpu.max} color="blue" />
                      </TableCell>
                      <TableCell>
                        <PercentBar value={node.ram.avg} color="green" />
                      </TableCell>
                      <TableCell>
                        <PercentBar value={node.disk.avg} color="purple" />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {node.network.avgIn?.toFixed(2) ?? "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {node.network.avgOut?.toFixed(2) ?? "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {node.dataPoints}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
