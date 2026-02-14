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

export default function LiveViewPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'processes'>('overview');
  const [logFilter, setLogFilter] = useState('');
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    
    const token = localStorage.getItem('token');
    const url = `${API_BASE}/live/${nodeId}?token=${token}`;
    
    const es = new EventSource(url);
    eventSourceRef.current = es;
    
    es.onopen = () => {
      setConnected(true);
      setError(null);
    };
    
    es.onerror = () => {
      setConnected(false);
      setError("Connection lost. Retrying...");
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
    
    es.addEventListener('heartbeat', (e) => {
      const data = JSON.parse(e.data);
      setLastHeartbeat(data.ts);
    });
    
    es.addEventListener('disconnected', () => {
      setConnected(false);
    });
    
    return () => {
      es.close();
    };
  }, [nodeId, paused, activeTab]);

  const togglePause = () => {
    if (!paused && eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setPaused(!paused);
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
            <Badge variant={connected ? "default" : "destructive"} className={connected ? "bg-green-500" : ""}>
              {connected ? "● Connected" : "○ Disconnected"}
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
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500 rounded-lg text-red-500">
            {error}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b">
          {(['overview', 'logs', 'processes'] as const).map(tab => (
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
      </div>
    </main>
  );
}
