"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
} from "recharts";
import { RefreshCw, Cpu, MemoryStick, HardDrive, Network } from "lucide-react";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

interface HistoryPoint {
  time: string;
  cpu: { avg: number | null; max: number | null };
  ram: { avg: number | null; max: number | null };
  disk: { avg: number | null };
  network: { in: number | null; out: number | null };
  samples: number;
}

interface HistoryData {
  nodeId: string;
  days: number;
  dataPoints: number;
  history: HistoryPoint[];
}

interface Props {
  nodeId: string;
}

export function PerformanceTab({ nodeId }: Props) {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    fetchHistory();
  }, [nodeId, days]);

  async function fetchHistory() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/nodes/${nodeId}/metrics/history?days=${days}`, {
        headers: { "X-API-Key": API_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch metrics history:", e);
    } finally {
      setLoading(false);
    }
  }

  // Transform data for charts
  const chartData = data?.history.map((point) => ({
    time: new Date(point.time).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    cpuAvg: point.cpu.avg,
    cpuMax: point.cpu.max,
    ramAvg: point.ram.avg,
    ramMax: point.ram.max,
    diskAvg: point.disk.avg,
    netIn: point.network.in,
    netOut: point.network.out,
  })) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!data || data.dataPoints === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Keine Performance-Daten verfügbar</p>
          <p className="text-sm text-muted-foreground mt-2">
            Der Agent muss Metriken an den Server senden.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[1, 7, 14, 30].map((d) => (
            <Button
              key={d}
              variant={days === d ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(d)}
            >
              {d} {d === 1 ? "Tag" : "Tage"}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {data.dataPoints} Datenpunkte
          </span>
          <Button variant="outline" size="sm" onClick={fetchHistory}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* CPU Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Cpu className="h-5 w-5 text-blue-500" />
            CPU Auslastung
          </CardTitle>
          <CardDescription>Durchschnitt und Maximum pro Stunde</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="cpuMax"
                  name="Max CPU"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.1}
                />
                <Area
                  type="monotone"
                  dataKey="cpuAvg"
                  name="Avg CPU"
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* RAM Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MemoryStick className="h-5 w-5 text-green-500" />
            RAM Auslastung
          </CardTitle>
          <CardDescription>Speichernutzung über Zeit</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="ramMax"
                  name="Max RAM"
                  stroke="#22c55e"
                  fill="#22c55e"
                  fillOpacity={0.1}
                />
                <Area
                  type="monotone"
                  dataKey="ramAvg"
                  name="Avg RAM"
                  stroke="#16a34a"
                  fill="#16a34a"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Disk Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="h-5 w-5 text-purple-500" />
            Disk Auslastung
          </CardTitle>
          <CardDescription>Festplattennutzung über Zeit</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="diskAvg"
                  name="Disk %"
                  stroke="#a855f7"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Network Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Network className="h-5 w-5 text-orange-500" />
            Netzwerk Traffic
          </CardTitle>
          <CardDescription>Durchschnittlicher Traffic pro Stunde (MB/s)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="netIn"
                  name="In (MB/s)"
                  stroke="#f97316"
                  fill="#f97316"
                  fillOpacity={0.3}
                />
                <Area
                  type="monotone"
                  dataKey="netOut"
                  name="Out (MB/s)"
                  stroke="#ea580c"
                  fill="#ea580c"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
