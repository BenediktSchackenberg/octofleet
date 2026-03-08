"use client";

import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import { Shield, Activity, Cpu, HardDrive, AlertTriangle, CheckCircle, Clock, Wifi, WifiOff } from "lucide-react";

interface Capabilities {
  node_id: string;
  sensors: Record<string, boolean>;
  agent_version: string;
  os_type: string;
  os_version: string;
  kernel_build: string;
  permissions: Record<string, unknown>;
  last_seen: string;
}

interface HealthEntry {
  ts: string;
  queue_depth: number;
  drop_count: number;
  watcher_count: number;
  cpu_overhead_estimate: string;
}

export function MonitoringHealthPanel({ nodeId }: { nodeId: string }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [health, setHealth] = useState<HealthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) return;

    Promise.all([
      apiClient.get(`/agents/${nodeId}/capabilities`, { showErrorToast: false })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      apiClient.get(`/agents/${nodeId}/health/history?limit=20`, { showErrorToast: false })
        .then(r => r.ok ? r.json() : { history: [] }).catch(() => ({ history: [] })),
    ]).then(([capsData, healthData]) => {
      setCaps(capsData);
      setHealth(healthData?.history || []);
      if (!capsData) setError("No monitoring agent connected to this node");
      setLoading(false);
    });
  }, [nodeId]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (error && !caps) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
        <WifiOff className="h-12 w-12 text-zinc-600 mx-auto mb-3" />
        <h3 className="text-lg font-semibold mb-1">No Monitoring Data</h3>
        <p className="text-zinc-400 text-sm">
          This node hasn&apos;t reported any monitoring capabilities yet.<br />
          The agent needs to be updated to support security monitoring (v0.5.1+).
        </p>
      </div>
    );
  }

  const isOnline = caps?.last_seen && (Date.now() - new Date(caps.last_seen).getTime()) < 10 * 60 * 1000;
  const lastHealth = health[0];
  const hasDrops = lastHealth && lastHealth.drop_count > 0;

  return (
    <div className="space-y-4">
      {/* Agent Info Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-400" />
            Monitoring Agent
          </h2>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${isOnline ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isOnline ? "Online" : "Offline"}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-zinc-500">Agent Version</span>
            <div className="font-mono text-sm">{caps?.agent_version || "—"}</div>
          </div>
          <div>
            <span className="text-xs text-zinc-500">OS</span>
            <div className="text-sm">{caps?.os_type} {caps?.os_version?.split(' ').slice(0, 3).join(' ')}</div>
          </div>
          <div>
            <span className="text-xs text-zinc-500">Build</span>
            <div className="font-mono text-sm">{caps?.kernel_build || "—"}</div>
          </div>
          <div>
            <span className="text-xs text-zinc-500">Last Seen</span>
            <div className="text-sm">{caps?.last_seen ? new Date(caps.last_seen).toLocaleString() : "—"}</div>
          </div>
        </div>
      </div>

      {/* Sensors Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-blue-400" />
          Sensors
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {caps?.sensors && Object.entries(caps.sensors).map(([sensor, active]) => (
            <div key={sensor} className={`flex items-center gap-2 p-3 rounded-lg border ${active ? "bg-green-500/10 border-green-500/30" : "bg-zinc-800 border-zinc-700"}`}>
              {active ? <CheckCircle className="h-4 w-4 text-green-400" /> : <div className="h-4 w-4 rounded-full bg-zinc-600" />}
              <span className="text-sm capitalize">{sensor.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Health Stats */}
      {lastHealth && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Cpu className="h-5 w-5 text-green-400" />
            Health Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-zinc-800 rounded-lg">
              <span className="text-xs text-zinc-500">Queue Depth</span>
              <div className={`text-2xl font-bold ${lastHealth.queue_depth > 1000 ? "text-red-400" : lastHealth.queue_depth > 100 ? "text-yellow-400" : "text-green-400"}`}>
                {lastHealth.queue_depth}
              </div>
            </div>
            <div className="p-3 bg-zinc-800 rounded-lg">
              <span className="text-xs text-zinc-500">Dropped Events</span>
              <div className={`text-2xl font-bold ${hasDrops ? "text-red-400" : "text-green-400"}`}>
                {lastHealth.drop_count}
              </div>
            </div>
            <div className="p-3 bg-zinc-800 rounded-lg">
              <span className="text-xs text-zinc-500">Active Watchers</span>
              <div className="text-2xl font-bold text-blue-400">{lastHealth.watcher_count}</div>
            </div>
            <div className="p-3 bg-zinc-800 rounded-lg">
              <span className="text-xs text-zinc-500">CPU Overhead</span>
              <div className="text-2xl font-bold text-green-400">{lastHealth.cpu_overhead_estimate}</div>
            </div>
          </div>

          {hasDrops && (
            <div className="mt-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
              <AlertTriangle className="h-4 w-4" />
              Events are being dropped! The agent queue is overloaded. Consider reducing monitored paths or increasing batch intervals.
            </div>
          )}
        </div>
      )}

      {/* Health History */}
      {health.length > 1 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Clock className="h-5 w-5 text-zinc-400" />
            Health History
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800">
                  <th className="text-left p-2">Time</th>
                  <th className="text-right p-2">Queue</th>
                  <th className="text-right p-2">Drops</th>
                  <th className="text-right p-2">Watchers</th>
                  <th className="text-right p-2">CPU</th>
                </tr>
              </thead>
              <tbody>
                {health.slice(0, 10).map((h, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="p-2 text-xs text-zinc-400">{new Date(h.ts).toLocaleString()}</td>
                    <td className="p-2 text-right font-mono">{h.queue_depth}</td>
                    <td className={`p-2 text-right font-mono ${h.drop_count > 0 ? "text-red-400" : ""}`}>{h.drop_count}</td>
                    <td className="p-2 text-right font-mono">{h.watcher_count}</td>
                    <td className="p-2 text-right">{h.cpu_overhead_estimate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
