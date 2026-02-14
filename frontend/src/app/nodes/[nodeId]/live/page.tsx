"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080/api/v1';

interface Metrics {
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  netIn: number | null;
  netOut: number | null;
  timestamp: string | null;
}

interface Process {
  name: string;
  pid: number;
  cpu: number | null;
  memoryMb: number | null;
  user: string | null;
}

interface MetricHistory {
  timestamp: number;
  cpu: number;
  memory: number;
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

export default function LiveViewPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [network, setNetwork] = useState<NetworkInterface[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLogEntry[]>([]);
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'processes' | 'performance' | 'network' | 'agentLogs'>('overview');
  const [logFilter, setLogFilter] = useState('');
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
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
      
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
      const backoff = Math.min(1000 * Math.pow(2, reconnectCount), 30000);
      setError(`Connection lost. Reconnecting in ${backoff / 1000}s...`);
      setReconnectCount(prev => prev + 1);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!paused) {
          connect();
        }
      }, backoff);
    };
    
    es.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      console.log('Live session started:', data.sessionId);
    });
    
    es.addEventListener('metrics', (e) => {
      const { data } = JSON.parse(e.data);
      setMetrics(data);
      
      if (data.cpu !== null && data.memory !== null) {
        setHistory(prev => {
          const newHistory = [...prev, {
            timestamp: Date.now(),
            cpu: data.cpu,
            memory: data.memory
          }];
          return newHistory.slice(-60);
        });
      }
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
      if (activeTab === 'logs') {
        setTimeout(() => {
          logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
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
    
    es.addEventListener('heartbeat', (e) => {
      const data = JSON.parse(e.data);
      setLastHeartbeat(data.ts);
    });
    
    es.addEventListener('disconnected', () => {
      setConnected(false);
    });
  };

  useEffect(() => {
    if (paused) return;
    connect();
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [nodeId, paused]);

  const togglePause = () => {
    if (!paused && eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    setPaused(!paused);
    if (paused) {
      setReconnectCount(0);
      connect();
    }
  };

  const manualReconnect = () => {
    setReconnectCount(0);
    connect();
  };

  const clearLogs = () => setLogs([]);

  const Sparkline = ({ data, color }: { data: number[], color: string }) => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 100);
    const width = 200;
    const height = 40;
    
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    }).join(' ');
    
    return (
      <svg width={width} height={height} className="inline-block">
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
      </svg>
    );
  };

  const getLevelBadge = (level: number, levelName: string | null) => {
    const name = levelName || `Level ${level}`;
    if (level <= 2) return <Badge variant="destructive">{name}</Badge>;
    if (level === 3) return <Badge className="bg-yellow-500">{name}</Badge>;
    return <Badge variant="outline">{name}</Badge>;
  };

  const filteredLogs = logs.filter(log => {
    if (!logFilter) return true;
    const search = logFilter.toLowerCase();
    return (
      log.message?.toLowerCase().includes(search) ||
      log.source?.toLowerCase().includes(search) ||
      log.logName.toLowerCase().includes(search)
    );
  });

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <Breadcrumb items={[
          { label: "Nodes", href: "/nodes" },
          { label: nodeId, href: `/nodes/${nodeId}` },
          { label: "Live View" }
        ]} />
        
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold">🔴 Live View</h1>
            <Badge 
              variant={connected ? "default" : connecting ? "outline" : "destructive"} 
              className={connected ? "bg-green-500" : connecting ? "border-yellow-500 text-yellow-500" : ""}
            >
              {connected ? "● Connected" : connecting ? "◐ Connecting..." : "○ Disconnected"}
            </Badge>
            {lastHeartbeat > 0 && (
              <span className="text-sm text-muted-foreground">
                Last: {new Date(lastHeartbeat).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant={paused ? "default" : "outline"} onClick={togglePause}>
              {paused ? "▶ Resume" : "⏸ Pause"}
            </Button>
            <Link href={`/nodes/${nodeId}`}>
              <Button variant="outline">← Back to Node</Button>
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-500 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>⚠️ {error}</span>
              {reconnectCount > 0 && (
                <Badge variant="outline" className="text-red-500 border-red-500">
                  Retry #{reconnectCount}
                </Badge>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={manualReconnect} className="border-red-500 text-red-500">
              🔄 Reconnect Now
            </Button>
          </div>
        )}

        {connecting && !connected && !error && (
          <div className="mb-4 p-4 bg-yellow-500/10 border border-yellow-500 rounded-lg text-yellow-500">
            ⏳ Connecting to live stream...
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b">
          {(['overview', 'logs', 'processes', 'performance', 'network', 'agentLogs'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === tab 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'overview' && '📊 Overview'}
              {tab === 'logs' && `📜 Logs (${logs.length})`}
              {tab === 'processes' && `⚙️ Processes (${processes.length})`}
              {tab === 'performance' && '📈 Performance'}
              {tab === 'network' && `🌐 Network (${network.length})`}
              {tab === 'agentLogs' && `🤖 Agent (${agentLogs.length})`}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>CPU Usage</CardDescription>
                  <CardTitle className="text-3xl">
                    {metrics && metrics.cpu !== null ? `${metrics.cpu.toFixed(1)}%` : '-'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Sparkline data={history.map(h => h.cpu)} color="#3b82f6" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Memory Usage</CardDescription>
                  <CardTitle className="text-3xl">
                    {metrics && metrics.memory !== null ? `${metrics.memory.toFixed(1)}%` : '-'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Sparkline data={history.map(h => h.memory)} color="#10b981" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Disk Usage</CardDescription>
                  <CardTitle className="text-3xl">
                    {metrics && metrics.disk !== null ? `${metrics.disk.toFixed(1)}%` : '-'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${(metrics?.disk ?? 0) > 90 ? 'bg-red-500' : (metrics?.disk ?? 0) > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${metrics?.disk ?? 0}%` }}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Network</CardDescription>
                  <CardTitle className="text-xl">
                    ↓ {metrics && metrics.netIn !== null ? `${metrics.netIn.toFixed(1)} MB` : '-'} 
                    <span className="mx-2">|</span>
                    ↑ {metrics && metrics.netOut !== null ? `${metrics.netOut.toFixed(1)} MB` : '-'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-sm text-muted-foreground">Total transferred</span>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity Summary */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">📜 Recent Logs</CardTitle>
                </CardHeader>
                <CardContent className="max-h-[200px] overflow-y-auto">
                  {logs.slice(-5).map(log => (
                    <div key={log.id} className="text-sm py-1 border-b last:border-0">
                      <span className="text-muted-foreground">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '-'}
                      </span>
                      {' '}
                      {getLevelBadge(log.level, log.levelName)}
                      {' '}
                      <span className="font-mono">{log.source}</span>
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-muted-foreground">No logs yet...</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">⚙️ Top Processes</CardTitle>
                </CardHeader>
                <CardContent className="max-h-[200px] overflow-y-auto">
                  {processes.slice(0, 5).map((proc, i) => (
                    <div key={`${proc.pid}-${i}`} className="text-sm py-1 border-b last:border-0 flex justify-between">
                      <span className="font-medium truncate">{proc.name}</span>
                      <span className={proc.cpu && proc.cpu > 50 ? 'text-red-500 font-bold' : 'text-muted-foreground'}>
                        {proc.cpu !== null ? `${proc.cpu.toFixed(1)}%` : '-'}
                      </span>
                    </div>
                  ))}
                  {processes.length === 0 && <p className="text-muted-foreground">No processes yet...</p>}
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>📜 Event Logs</CardTitle>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Filter logs..." 
                    value={logFilter}
                    onChange={(e) => setLogFilter(e.target.value)}
                    className="w-64"
                  />
                  <Button variant="outline" size="sm" onClick={clearLogs}>Clear</Button>
                </div>
              </div>
              <CardDescription>{filteredLogs.length} logs (max 500)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[500px] overflow-y-auto font-mono text-sm bg-black/5 dark:bg-white/5 rounded p-2">
                {filteredLogs.map(log => (
                  <div key={log.id} className="py-1 border-b border-border/30 hover:bg-accent/50">
                    <span className="text-muted-foreground">
                      {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '--:--:--'}
                    </span>
                    {' '}
                    {getLevelBadge(log.level, log.levelName)}
                    {' '}
                    <span className="text-blue-500">[{log.logName}]</span>
                    {' '}
                    <span className="text-purple-500">{log.source}</span>
                    {': '}
                    <span className="text-foreground">{log.message || '(no message)'}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
                {filteredLogs.length === 0 && (
                  <p className="text-muted-foreground text-center py-8">
                    {logs.length === 0 ? 'Waiting for logs...' : 'No logs match filter'}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Processes Tab */}
        {activeTab === 'processes' && (
          <Card>
            <CardHeader>
              <CardTitle>⚙️ Running Processes</CardTitle>
              <CardDescription>Top {processes.length} processes by CPU usage</CardDescription>
            </CardHeader>
            <CardContent>
              {processes.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Process</TableHead>
                      <TableHead className="text-right">PID</TableHead>
                      <TableHead className="text-right">CPU %</TableHead>
                      <TableHead className="text-right">Memory</TableHead>
                      <TableHead>User</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processes.map((proc, i) => (
                      <TableRow key={`${proc.pid}-${i}`}>
                        <TableCell className="font-medium">{proc.name}</TableCell>
                        <TableCell className="text-right font-mono">{proc.pid}</TableCell>
                        <TableCell className="text-right">
                          <span className={proc.cpu && proc.cpu > 50 ? 'text-red-500 font-bold' : ''}>
                            {proc.cpu !== null ? `${proc.cpu.toFixed(1)}%` : '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {proc.memoryMb !== null ? `${proc.memoryMb.toFixed(0)} MB` : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{proc.user || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {connected ? 'Loading processes...' : 'Connect to see processes'}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <PerformanceChart nodeId={nodeId} />
        )}

        {/* Network Tab */}
        {activeTab === 'network' && (
          <Card>
            <CardHeader>
              <CardTitle>🌐 Network Interfaces</CardTitle>
              <CardDescription>
                {network.length > 0 ? `${network.length} interfaces` : 'Waiting for data...'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {network.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {network.map((iface, i) => (
                    <Card key={i} className={!iface.linkUp ? 'opacity-50 border-red-500' : ''}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{iface.name}</CardTitle>
                          <Badge variant={iface.linkUp ? "default" : "destructive"} className={iface.linkUp ? "bg-green-500" : ""}>
                            {iface.linkUp ? '🟢 Up' : '🔴 Down'}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs truncate">{iface.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Speed</span>
                            <div className="font-mono">{iface.speedMbps > 0 ? `${iface.speedMbps} Mbps` : '-'}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total</span>
                            <div className="font-mono">
                              ↓{iface.rxTotalMb.toFixed(0)}MB ↑{iface.txTotalMb.toFixed(0)}MB
                            </div>
                          </div>
                          <div>
                            <span className="text-green-500">↓ Download</span>
                            <div className="font-mono text-lg font-bold">
                              {formatBytesPerSec(iface.rxBytesPerSec)}
                            </div>
                          </div>
                          <div>
                            <span className="text-blue-500">↑ Upload</span>
                            <div className="font-mono text-lg font-bold">
                              {formatBytesPerSec(iface.txBytesPerSec)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {connected ? 'Waiting for network data...' : 'Connect to see network interfaces'}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Agent Logs Tab */}
        {activeTab === 'agentLogs' && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>🤖 Agent Service Logs</CardTitle>
                  <CardDescription>Logs from the OpenClaw Agent service</CardDescription>
                </div>
                <span className="text-sm text-muted-foreground">{agentLogs.length} entries</span>
              </div>
            </CardHeader>
            <CardContent>
              {agentLogs.length > 0 ? (
                <div className="space-y-2 font-mono text-sm max-h-[600px] overflow-y-auto">
                  {agentLogs.map((log, i) => (
                    <div key={i} className="flex gap-2 p-2 rounded hover:bg-muted/50 border-b border-muted">
                      <span className="text-muted-foreground whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <Badge 
                        variant={log.level === 'Error' ? 'destructive' : log.level === 'Warning' ? 'secondary' : 'outline'}
                        className={`min-w-[80px] justify-center ${
                          log.level === 'Information' ? 'bg-blue-500/20 text-blue-400' :
                          log.level === 'Warning' ? 'bg-yellow-500/20 text-yellow-400' :
                          log.level === 'Error' ? 'bg-red-500/20 text-red-400' : ''
                        }`}
                      >
                        {log.level}
                      </Badge>
                      <span className="text-muted-foreground">[{log.source}]</span>
                      <span className="flex-1 break-all">{log.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {connected ? 'Waiting for agent logs... (requires agent v0.4.23+)' : 'Connect to see agent logs'}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

// Helper to format bytes/sec
function formatBytesPerSec(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${bytes.toFixed(0)} B/s`;
}

// Separate component for Performance Charts
function PerformanceChart({ nodeId }: { nodeId: string }) {
  const [historyData, setHistoryData] = useState<Array<{
    timestamp: string;
    cpu: number | null;
    memory: number | null;
    disk: number | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [interval, setInterval] = useState('5m');

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080/api/v1';

  useEffect(() => {
    fetchHistory();
  }, [nodeId, hours, interval]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(
        `${API_BASE}/nodes/${nodeId}/metrics/history?hours=${hours}&interval=${interval}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
    setLoading(false);
  };

  // Simple line chart using SVG
  const LineChart = ({ data, dataKey, color, label }: { 
    data: typeof historyData, 
    dataKey: 'cpu' | 'memory' | 'disk',
    color: string,
    label: string 
  }) => {
    const values = data.map(d => d[dataKey]).filter((v): v is number => v !== null);
    if (values.length < 2) return <div className="text-muted-foreground text-center py-8">Not enough data</div>;
    
    const max = Math.max(...values, 100);
    const min = 0;
    const width = 800;
    const height = 200;
    const padding = 40;
    
    const points = data.map((d, i) => {
      const v = d[dataKey];
      if (v === null) return null;
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / (max - min)) * (height - padding * 2);
      return { x, y, value: v, time: d.timestamp };
    }).filter(Boolean) as Array<{ x: number; y: number; value: number; time: string }>;
    
    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    
    // Area fill
    const areaD = pathD + ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
    
    return (
      <div className="relative">
        <div className="text-sm font-medium mb-2">{label}</div>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(v => {
            const y = height - padding - (v / 100) * (height - padding * 2);
            return (
              <g key={v}>
                <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#333" strokeDasharray="2,2" opacity={0.3} />
                <text x={padding - 5} y={y + 4} textAnchor="end" fontSize="10" fill="#888">{v}%</text>
              </g>
            );
          })}
          
          {/* Area */}
          <path d={areaD} fill={color} opacity={0.1} />
          
          {/* Line */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
          
          {/* Current value */}
          {points.length > 0 && (
            <text x={width - padding} y={20} textAnchor="end" fontSize="14" fontWeight="bold" fill={color}>
              {points[points.length - 1].value.toFixed(1)}%
            </text>
          )}
        </svg>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>📈 Performance History</CardTitle>
          <div className="flex gap-2">
            <select 
              value={hours} 
              onChange={(e) => setHours(Number(e.target.value))}
              className="px-2 py-1 border rounded text-sm bg-background"
            >
              <option value={1}>Last 1h</option>
              <option value={6}>Last 6h</option>
              <option value={24}>Last 24h</option>
              <option value={72}>Last 3d</option>
              <option value={168}>Last 7d</option>
            </select>
            <select 
              value={interval} 
              onChange={(e) => setInterval(e.target.value)}
              className="px-2 py-1 border rounded text-sm bg-background"
            >
              <option value="1m">1 min</option>
              <option value="5m">5 min</option>
              <option value="15m">15 min</option>
              <option value="1h">1 hour</option>
            </select>
            <Button variant="outline" size="sm" onClick={fetchHistory}>
              🔄 Refresh
            </Button>
          </div>
        </div>
        <CardDescription>
          {loading ? 'Loading...' : `${historyData.length} data points`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading historical data...</div>
        ) : historyData.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No historical data available</div>
        ) : (
          <>
            <LineChart data={historyData} dataKey="cpu" color="#3b82f6" label="CPU Usage" />
            <LineChart data={historyData} dataKey="memory" color="#10b981" label="Memory Usage" />
            <LineChart data={historyData} dataKey="disk" color="#f59e0b" label="Disk Usage" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
