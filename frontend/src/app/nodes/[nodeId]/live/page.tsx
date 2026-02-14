"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { getAuthHeader } from "@/lib/auth-context";
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

export default function LiveViewPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [history, setHistory] = useState<MetricHistory[]>([]);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  
  const eventSourceRef = useRef<EventSource | null>(null);

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
      
      // Add to history (keep last 60 points = 2 min at 2s interval)
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
  }, [nodeId, paused]);

  const togglePause = () => {
    if (!paused && eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setPaused(!paused);
  };

  // Simple sparkline component
  const Sparkline = ({ data, color }: { data: number[], color: string }) => {
    if (data.length < 2) return null;
    const max = Math.max(...data, 100);
    const min = 0;
    const range = max - min || 1;
    const width = 200;
    const height = 40;
    
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    
    return (
      <svg width={width} height={height} className="inline-block">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
        />
      </svg>
    );
  };

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

        {/* Metrics Cards */}
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

        {/* Processes Table */}
        <Card>
          <CardHeader>
            <CardTitle>🔄 Top Processes</CardTitle>
            <CardDescription>
              {processes.length > 0 ? `${processes.length} processes by CPU usage` : 'Waiting for data...'}
            </CardDescription>
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
      </div>
    </main>
  );
}
