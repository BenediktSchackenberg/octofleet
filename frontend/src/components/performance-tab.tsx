"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { RefreshCw, Cpu, MemoryStick, HardDrive, Network, Wifi, WifiOff, Play, Pause } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080/api/v1";

interface LiveMetrics {
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  netIn: number | null;
  netOut: number | null;
  timestamp: string | null;
}

interface MetricHistory {
  timestamp: number;
  time: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  netIn: number | null;
  netOut: number | null;
}

interface Props {
  nodeId: string;
}

export function PerformanceTab({ nodeId }: Props) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [reconnectCount, setReconnectCount] = useState(0);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    setConnecting(true);
    setError(null);
    
    const token = localStorage.getItem('token');
    const url = `${API_BASE}/live/${nodeId}?token=${token}`;
    
    const es = new EventSource(url);
    eventSourceRef.current = es;
    
    es.onopen = () => {
      setConnected(true);
      setConnecting(false);
      setReconnectCount(0);
      setError(null);
    };
    
    es.onerror = () => {
      setConnected(false);
      setConnecting(false);
      
      const backoff = Math.min(1000 * Math.pow(2, reconnectCount), 30000);
      setError(`Verbindung verloren. Reconnect in ${backoff / 1000}s...`);
      setReconnectCount(prev => prev + 1);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!paused) {
          connect();
        }
      }, backoff);
    };
    
    es.addEventListener('metrics', (e) => {
      const { data } = JSON.parse(e.data);
      setMetrics(data);
      
      // Add to history (keep last 60 points = ~5 minutes at 5s intervals)
      const now = Date.now();
      const timeStr = new Date(now).toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      
      setHistory(prev => {
        const newHistory = [...prev, {
          timestamp: now,
          time: timeStr,
          cpu: data.cpu,
          memory: data.memory,
          disk: data.disk,
          netIn: data.netIn,
          netOut: data.netOut
        }];
        return newHistory.slice(-60);
      });
    });
  };

  useEffect(() => {
    connect();
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [nodeId]);

  const togglePause = () => {
    if (paused) {
      setPaused(false);
      connect();
    } else {
      setPaused(true);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      setConnected(false);
    }
  };

  // Current values display
  const currentCpu = metrics?.cpu ?? 0;
  const currentMem = metrics?.memory ?? 0;
  const currentDisk = metrics?.disk ?? 0;
  const currentNetIn = metrics?.netIn ?? 0;
  const currentNetOut = metrics?.netOut ?? 0;

  return (
    <div className="space-y-6">
      {/* Connection Status & Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {connected ? (
            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">
              <Wifi className="h-3 w-3 mr-1" /> Live
            </Badge>
          ) : connecting ? (
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30">
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Verbinde...
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30">
              <WifiOff className="h-3 w-3 mr-1" /> Offline
            </Badge>
          )}
          {error && <span className="text-sm text-muted-foreground">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {history.length} Datenpunkte
          </span>
          <Button variant="outline" size="sm" onClick={togglePause}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={connect} disabled={connecting}>
            <RefreshCw className={`h-4 w-4 ${connecting ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Current Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">CPU</p>
                <p className="text-2xl font-bold">{currentCpu.toFixed(1)}%</p>
              </div>
            </div>
            <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.min(currentCpu, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <MemoryStick className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">RAM</p>
                <p className="text-2xl font-bold">{currentMem.toFixed(1)}%</p>
              </div>
            </div>
            <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${Math.min(currentMem, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-sm text-muted-foreground">Disk</p>
                <p className="text-2xl font-bold">{currentDisk.toFixed(1)}%</p>
              </div>
            </div>
            <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-purple-500 transition-all duration-500"
                style={{ width: `${Math.min(currentDisk, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Network className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm text-muted-foreground">Network</p>
                <p className="text-lg font-bold">
                  ↓{currentNetIn.toFixed(1)} ↑{currentNetOut.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">MB/s</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live CPU & Memory Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">CPU & RAM Live</CardTitle>
          <CardDescription>Echtzeit-Auslastung (letzte 5 Minuten)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
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
                    formatter={(value: number | undefined) => value !== undefined ? `${value.toFixed(1)}%` : ""}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="memory"
                    name="RAM"
                    stroke="#22c55e"
                    fill="#22c55e"
                    fillOpacity={0.3}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {connecting ? (
                  <><RefreshCw className="h-5 w-5 animate-spin mr-2" /> Verbinde...</>
                ) : (
                  <>Warte auf Daten...</>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Live Network Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Network className="h-5 w-5 text-orange-500" />
            Netzwerk Live
          </CardTitle>
          <CardDescription>Traffic in MB/s</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
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
                    formatter={(value: number | undefined) => value !== undefined ? `${value.toFixed(2)} MB/s` : ""}
                  />
                  <Area
                    type="monotone"
                    dataKey="netIn"
                    name="Download"
                    stroke="#f97316"
                    fill="#f97316"
                    fillOpacity={0.3}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="netOut"
                    name="Upload"
                    stroke="#ea580c"
                    fill="#ea580c"
                    fillOpacity={0.2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Warte auf Daten...
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Disk Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <HardDrive className="h-5 w-5 text-purple-500" />
            Disk Auslastung Live
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
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
                    formatter={(value: number | undefined) => value !== undefined ? `${value.toFixed(1)}%` : ""}
                  />
                  <Line
                    type="monotone"
                    dataKey="disk"
                    name="Disk %"
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Warte auf Daten...
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
