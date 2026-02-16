"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { RefreshCw, Cpu, MemoryStick, HardDrive, Network, Wifi, WifiOff, Play, Pause, Trash2, Search } from "lucide-react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";

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

interface Process {
  name: string;
  pid: number;
  cpu: number | null;
  memoryMb: number | null;
  user: string | null;
}

interface LogEntry {
  id: number;
  logName: string;
  eventId: number;
  level: number;
  levelName: string | null;
  source: string | null;
  message: string | null;
  timestamp: string | null;
}

interface NetworkInterface {
  name: string;
  description: string;
  linkUp: boolean;
  speedMbps: number;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxTotalMb: number;
  txTotalMb: number;
}

interface AgentLogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  eventId?: number;
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
  const [processes, setProcesses] = useState<Process[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [network, setNetwork] = useState<NetworkInterface[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'processes' | 'network' | 'agent'>('overview');
  const [logFilter, setLogFilter] = useState('');
  const [processSort, setProcessSort] = useState<'cpu' | 'memory' | 'name'>('cpu');
  const [timeRange, setTimeRange] = useState<'live' | '24h' | '7d' | '14d' | '30d'>('live');
  const [historicalData, setHistoricalData] = useState<MetricHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load historical data when timeRange changes
  const loadHistoricalData = async (range: '24h' | '7d' | '14d' | '30d') => {
    setLoadingHistory(true);
    const hoursMap = { '24h': 24, '7d': 168, '14d': 336, '30d': 720 };
    const intervalMap = { '24h': '15m', '7d': '1h', '14d': '6h', '30d': '1d' };
    const hours = hoursMap[range];
    const interval = intervalMap[range];
    
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(
        `${API_BASE}/nodes/${nodeId}/metrics/history?hours=${hours}&interval=${interval}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (res.ok) {
        const json = await res.json();
        const data = json.data.map((d: any) => ({
          timestamp: new Date(d.timestamp).getTime(),
          time: new Date(d.timestamp).toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          }),
          cpu: d.cpu,
          memory: d.memory,
          disk: d.disk,
          netIn: d.netIn,
          netOut: d.netOut
        }));
        setHistoricalData(data);
      }
    } catch (e) {
      console.error('Failed to load historical data:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (timeRange !== 'live') {
      loadHistoricalData(timeRange);
      // Pause live stream when viewing historical
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        setConnected(false);
      }
    } else {
      setHistoricalData([]);
      if (!paused) {
        connect();
      }
    }
  }, [timeRange]);

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

    es.addEventListener('processes', (e) => {
      const { data } = JSON.parse(e.data);
      setProcesses(data);
    });
    
    es.addEventListener('logs', (e) => {
      const { data } = JSON.parse(e.data);
      setLogs(prev => {
        const newLogs = [...prev, ...data];
        return newLogs.slice(-500);
      });
    });
    
    es.addEventListener('network', (e) => {
      const { data } = JSON.parse(e.data);
      if (data?.interfaces) {
        setNetwork(data.interfaces);
      }
    });
    
    es.addEventListener('agentLogs', (e) => {
      const { data } = JSON.parse(e.data);
      if (data?.logs) {
        setAgentLogs(data.logs);
      }
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

  const currentCpu = metrics?.cpu ?? 0;
  const currentMem = metrics?.memory ?? 0;
  const currentDisk = metrics?.disk ?? 0;
  const currentNetIn = metrics?.netIn ?? 0;
  const currentNetOut = metrics?.netOut ?? 0;

  const filteredLogs = logs.filter(log => {
    if (!logFilter) return true;
    const search = logFilter.toLowerCase();
    return (
      log.message?.toLowerCase().includes(search) ||
      log.source?.toLowerCase().includes(search) ||
      log.logName.toLowerCase().includes(search)
    );
  });

  const sortedProcesses = [...processes].sort((a, b) => {
    if (processSort === 'cpu') return (b.cpu || 0) - (a.cpu || 0);
    if (processSort === 'memory') return (b.memoryMb || 0) - (a.memoryMb || 0);
    return a.name.localeCompare(b.name);
  });

  const getLevelBadge = (level: number, levelName: string | null) => {
    const name = levelName || `Level ${level}`;
    if (level <= 2) return <Badge variant="destructive">{name}</Badge>;
    if (level === 3) return <Badge className="bg-yellow-500">{name}</Badge>;
    return <Badge variant="outline">{name}</Badge>;
  };

  return (
    <div className="space-y-4">
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
          <Button variant="outline" size="sm" onClick={togglePause}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={connect} disabled={connecting}>
            <RefreshCw className={`h-4 w-4 ${connecting ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex gap-1 border-b">
        {(['overview', 'logs', 'processes', 'network', 'agent'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab 
                ? 'border-primary text-primary' 
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'overview' && `📊 Übersicht`}
            {tab === 'logs' && `📜 Logs (${logs.length})`}
            {tab === 'processes' && `⚙️ Prozesse (${processes.length})`}
            {tab === 'network' && `🌐 Netzwerk (${network.length})`}
            {tab === 'agent' && `🤖 Agent (${agentLogs.length})`}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
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
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">CPU & RAM {timeRange === 'live' ? 'Live' : 'Verlauf'}</CardTitle>
                  <CardDescription>
                    {timeRange === 'live' && 'Echtzeit-Auslastung (letzte 5 Minuten)'}
                    {timeRange === '24h' && 'Letzte 24 Stunden (15 Min Intervall)'}
                    {timeRange === '7d' && 'Letzte 7 Tage (1 Std Intervall)'}
                    {timeRange === '14d' && 'Letzte 14 Tage (6 Std Intervall)'}
                    {timeRange === '30d' && 'Letzte 30 Tage (Tages-Durchschnitt)'}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  {(['live', '24h', '7d', '14d', '30d'] as const).map(range => (
                    <Button
                      key={range}
                      variant={timeRange === range ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTimeRange(range)}
                      disabled={loadingHistory}
                    >
                      {range === 'live' ? '⚡ Live' : range}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                {loadingHistory ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Lade historische Daten...
                  </div>
                ) : (timeRange === 'live' ? history : historicalData).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeRange === 'live' ? history : historicalData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 10 }} 
                        interval="preserveStartEnd"
                        angle={timeRange !== 'live' ? -45 : 0}
                        textAnchor={timeRange !== 'live' ? 'end' : 'middle'}
                        height={timeRange !== 'live' ? 60 : 30}
                      />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}
                        formatter={(value: number | undefined) => value !== undefined ? `${value.toFixed(1)}%` : ""}
                      />
                      <Area type="monotone" dataKey="cpu" name="CPU" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} isAnimationActive={false} />
                      <Area type="monotone" dataKey="memory" name="RAM" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {connecting ? <><RefreshCw className="h-5 w-5 animate-spin mr-2" /> Verbinde...</> : <>Warte auf Daten...</>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats Row */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Top Processes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Top Prozesse</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedProcesses.slice(0, 5).map((proc, i) => (
                    <div key={i} className="flex justify-between items-center text-sm">
                      <span className="truncate max-w-[200px]">{proc.name}</span>
                      <span className="text-muted-foreground">{proc.cpu?.toFixed(1)}%</span>
                    </div>
                  ))}
                  {processes.length === 0 && <p className="text-muted-foreground text-sm">Keine Daten</p>}
                </div>
              </CardContent>
            </Card>

            {/* Recent Logs */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Letzte Events</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {logs.slice(-5).reverse().map((log, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('de-DE') : ''}
                      </span>
                      {getLevelBadge(log.level, log.levelName)}
                      <span className="truncate">{log.source}</span>
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-muted-foreground text-sm">Keine Logs</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Windows Event Logs</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter logs..."
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    className="pl-8 w-64"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setLogs([])}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Zeit</TableHead>
                    <TableHead className="w-[100px]">Level</TableHead>
                    <TableHead className="w-[150px]">Quelle</TableHead>
                    <TableHead>Nachricht</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.slice(-100).reverse().map((log, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('de-DE') : ''}
                      </TableCell>
                      <TableCell>{getLevelBadge(log.level, log.levelName)}</TableCell>
                      <TableCell className="text-xs truncate max-w-[150px]">{log.source}</TableCell>
                      <TableCell className="text-xs truncate max-w-[400px]">{log.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filteredLogs.length === 0 && (
                <p className="text-center text-muted-foreground py-8">Keine Logs</p>
              )}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Processes Tab */}
      {activeTab === 'processes' && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Laufende Prozesse</CardTitle>
              <div className="flex gap-2">
                <Button variant={processSort === 'cpu' ? 'default' : 'outline'} size="sm" onClick={() => setProcessSort('cpu')}>CPU</Button>
                <Button variant={processSort === 'memory' ? 'default' : 'outline'} size="sm" onClick={() => setProcessSort('memory')}>RAM</Button>
                <Button variant={processSort === 'name' ? 'default' : 'outline'} size="sm" onClick={() => setProcessSort('name')}>Name</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[80px]">PID</TableHead>
                    <TableHead className="w-[100px]">CPU %</TableHead>
                    <TableHead className="w-[100px]">RAM MB</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedProcesses.map((proc, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm">{proc.name}</TableCell>
                      <TableCell className="text-muted-foreground">{proc.pid}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${Math.min(proc.cpu || 0, 100)}%` }} />
                          </div>
                          <span className="text-xs">{proc.cpu?.toFixed(1)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{proc.memoryMb?.toFixed(0)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{proc.user || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {processes.length === 0 && (
                <p className="text-center text-muted-foreground py-8">Keine Prozesse</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network Tab */}
      {activeTab === 'network' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Netzwerk Interfaces</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {network.map((iface, i) => (
                <div key={i} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={iface.linkUp ? "default" : "secondary"}>
                        {iface.linkUp ? "🟢 Up" : "🔴 Down"}
                      </Badge>
                      <span className="font-medium">{iface.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{iface.speedMbps} Mbps</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{iface.description}</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">↓ Download:</span>
                      <span className="ml-2">{(iface.rxBytesPerSec / 1024 / 1024).toFixed(2)} MB/s</span>
                      <span className="text-muted-foreground ml-2">({iface.rxTotalMb.toFixed(0)} MB total)</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">↑ Upload:</span>
                      <span className="ml-2">{(iface.txBytesPerSec / 1024 / 1024).toFixed(2)} MB/s</span>
                      <span className="text-muted-foreground ml-2">({iface.txTotalMb.toFixed(0)} MB total)</span>
                    </div>
                  </div>
                </div>
              ))}
              {network.length === 0 && (
                <p className="text-center text-muted-foreground py-8">Keine Netzwerk-Daten</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agent Logs Tab */}
      {activeTab === 'agent' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Agent Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Zeit</TableHead>
                    <TableHead className="w-[80px]">Level</TableHead>
                    <TableHead className="w-[150px]">Source</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentLogs.map((log, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">
                        {new Date(log.timestamp).toLocaleTimeString('de-DE')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.level === 'Error' ? 'destructive' : log.level === 'Warning' ? 'secondary' : 'outline'}>
                          {log.level}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{log.source}</TableCell>
                      <TableCell className="text-xs truncate max-w-[400px]">{log.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {agentLogs.length === 0 && (
                <p className="text-center text-muted-foreground py-8">Keine Agent Logs</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
