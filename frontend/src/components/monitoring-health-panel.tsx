"use client";

import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import { Shield, Activity, Cpu, HardDrive, AlertTriangle, CheckCircle, Clock, Wifi, WifiOff, FileSearch, Network, KeyRound, Settings, Eye, FolderLock } from "lucide-react";

interface Capabilities {
  node_id: string;
  sensors: Record<string, boolean> | string;
  agent_version: string;
  os_type: string;
  os_version: string;
  kernel_build: string;
  permissions: Record<string, unknown> | string;
  last_seen: string;
}

interface HealthEntry {
  ts: string;
  queue_depth: number;
  drop_count: number;
  watcher_count: number;
  cpu_overhead_estimate: string;
}

// Sensor display config: icon, label, description
const SENSOR_INFO: Record<string, { icon: typeof Shield; label: string; description: string }> = {
  file_audit: { icon: FileSearch, label: "File Audit", description: "Tracks file system changes, creations, deletions" },
  process_monitor: { icon: Cpu, label: "Process Monitor", description: "Monitors process creation and termination" },
  network_monitor: { icon: Network, label: "Network Monitor", description: "Tracks network connections and traffic" },
  registry_monitor: { icon: Settings, label: "Registry Monitor", description: "Watches Windows registry changes" },
  logon_events: { icon: KeyRound, label: "Logon Events", description: "Captures user login/logout activity" },
  service_changes: { icon: Eye, label: "Service Changes", description: "Detects Windows service modifications" },
};

function parseSensors(raw: Record<string, boolean> | string | null): Record<string, boolean> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function parsePermissions(raw: Record<string, unknown> | string | null): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MonitoringHealthPanel({ nodeId }: { nodeId: string }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [health, setHealth] = useState<HealthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeId) return;

    Promise.all([
      apiClient.get<Capabilities>(`/agents/${nodeId}/capabilities`, { showErrorToast: false })
        .catch(() => null),
      apiClient.get<{ history: HealthEntry[] }>(`/agents/${nodeId}/health/history?limit=20`, { showErrorToast: false })
        .then(r => r || { history: [] }).catch(() => ({ history: [] as HealthEntry[] })),
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
          Make sure the agent is running and has a monitoring profile assigned.
        </p>
      </div>
    );
  }

  const sensors = parseSensors(caps?.sensors ?? null);
  const permissions = parsePermissions(caps?.permissions ?? null);
  const isOnline = caps?.last_seen && (Date.now() - new Date(caps.last_seen).getTime()) < 10 * 60 * 1000;
  const lastHealth = health[0];
  const hasDrops = lastHealth && lastHealth.drop_count > 0;
  const activeSensors = Object.entries(sensors).filter(([, v]) => v).length;
  const totalSensors = Object.keys(sensors).length;

  return (
    <div className="space-y-4">
      {/* Agent Status Card */}
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
          <div className="p-3 bg-zinc-800/50 rounded-lg">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Version</span>
            <div className="font-mono text-sm mt-1 text-purple-300">{caps?.agent_version || "—"}</div>
          </div>
          <div className="p-3 bg-zinc-800/50 rounded-lg">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">OS</span>
            <div className="text-sm mt-1">{caps?.os_type} Build {caps?.kernel_build}</div>
          </div>
          <div className="p-3 bg-zinc-800/50 rounded-lg">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Running As</span>
            <div className="text-sm mt-1 flex items-center gap-1">
              {permissions.is_admin ? (
                <span className="text-amber-400 flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</span>
              ) : (
                <span className="text-zinc-300">{String(permissions.service_account || "—")}</span>
              )}
            </div>
          </div>
          <div className="p-3 bg-zinc-800/50 rounded-lg">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Last Seen</span>
            <div className="text-sm mt-1">{caps?.last_seen ? timeAgo(caps.last_seen) : "—"}</div>
          </div>
        </div>
      </div>

      {/* Sensors Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            Security Sensors
          </h2>
          <span className="text-sm text-zinc-400">
            <span className="text-green-400 font-bold">{activeSensors}</span> / {totalSensors} active
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(sensors).map(([sensor, active]) => {
            const info = SENSOR_INFO[sensor] || { icon: FolderLock, label: sensor.replace(/_/g, " "), description: "" };
            const SensorIcon = info.icon;
            return (
              <div key={sensor} className={`flex items-start gap-3 p-4 rounded-lg border transition-colors ${
                active 
                  ? "bg-green-500/5 border-green-500/20 hover:bg-green-500/10" 
                  : "bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800"
              }`}>
                <div className={`p-2 rounded-lg ${active ? "bg-green-500/20" : "bg-zinc-700/50"}`}>
                  <SensorIcon className={`h-4 w-4 ${active ? "text-green-400" : "text-zinc-500"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium capitalize ${active ? "text-green-300" : "text-zinc-400"}`}>
                      {info.label}
                    </span>
                    {active ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border border-zinc-600 shrink-0" />
                    )}
                  </div>
                  {info.description && (
                    <p className="text-xs text-zinc-500 mt-0.5 leading-tight">{info.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Health Stats */}
      {lastHealth && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Cpu className="h-5 w-5 text-green-400" />
            Agent Health
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-zinc-800/50 rounded-lg">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Queue Depth</span>
              <div className={`text-2xl font-bold mt-1 ${lastHealth.queue_depth > 1000 ? "text-red-400" : lastHealth.queue_depth > 100 ? "text-yellow-400" : "text-green-400"}`}>
                {lastHealth.queue_depth.toLocaleString()}
              </div>
            </div>
            <div className="p-3 bg-zinc-800/50 rounded-lg">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Dropped Events</span>
              <div className={`text-2xl font-bold mt-1 ${hasDrops ? "text-red-400" : "text-green-400"}`}>
                {lastHealth.drop_count.toLocaleString()}
              </div>
            </div>
            <div className="p-3 bg-zinc-800/50 rounded-lg">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">Active Watchers</span>
              <div className="text-2xl font-bold mt-1 text-blue-400">{lastHealth.watcher_count}</div>
            </div>
            <div className="p-3 bg-zinc-800/50 rounded-lg">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">CPU Overhead</span>
              <div className="text-2xl font-bold mt-1 text-green-400">{lastHealth.cpu_overhead_estimate}</div>
            </div>
          </div>

          {hasDrops && (
            <div className="mt-4 flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Events are being dropped! Consider reducing monitored paths or increasing batch intervals.
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
                <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                  <th className="text-left p-2 pb-3">Time</th>
                  <th className="text-right p-2 pb-3">Queue</th>
                  <th className="text-right p-2 pb-3">Drops</th>
                  <th className="text-right p-2 pb-3">Watchers</th>
                  <th className="text-right p-2 pb-3">CPU</th>
                </tr>
              </thead>
              <tbody>
                {health.slice(0, 10).map((h, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="p-2 text-xs text-zinc-400">{timeAgo(h.ts)}</td>
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
