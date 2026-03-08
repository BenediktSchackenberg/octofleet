"use client";
import { apiClient } from "@/lib/api-client";

import { useEffect, useState, useRef } from "react";
import { LoadingSpinner } from "@/components/ui-components";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL } from "@/lib/api-config";
import {
  Activity,
  Monitor,
  Wifi,
  WifiOff,
  Clock,
  Cpu,
  Wrench,
  Terminal,
  ArrowDownToLine,
  Shield,
  Heart,
  Zap,
  Eye,
  Database,
} from "lucide-react";

interface AgentStatus {
  id: string;
  hostname: string;
  os_name: string;
  agent_version: string;
  last_seen: string | null;
  seconds_ago: number | null;
  status: "active" | "idle" | "stale" | "offline" | "unknown";
  is_online: boolean;
  running_jobs: number;
  queued_jobs: number;
  pending_remediation: number;
  running_remediation: number;
}

interface ActivityEvent {
  timestamp: string;
  hostname: string;
  action: string;
  detail: string;
  ip: string;
  status_code: number;
}

const ACTION_ICONS: Record<string, any> = {
  "job-poll": ArrowDownToLine,
  "terminal-poll": Terminal,
  "shell-poll": Terminal,
  "screen-poll": Eye,
  "remediation-poll": Shield,
  "health-report": Heart,
  "live-data": Database,
  "remediation-result": Wrench,
  "job-result": Zap,
  poll: ArrowDownToLine,
};

const ACTION_LABELS: Record<string, string> = {
  "job-poll": "Job Poll",
  "terminal-poll": "Terminal",
  "shell-poll": "Shell",
  "screen-poll": "Screen",
  "remediation-poll": "Remediation",
  "health-report": "Health",
  "live-data": "Live Data",
  "remediation-result": "Remed. Result",
  "job-result": "Job Result",
  poll: "Poll",
};

const STATUS_CONFIG = {
  active: { color: "bg-green-500", text: "text-green-500", label: "Active", pulse: true },
  idle: { color: "bg-yellow-500", text: "text-yellow-500", label: "Idle", pulse: false },
  stale: { color: "bg-orange-500", text: "text-orange-500", label: "Stale", pulse: false },
  offline: { color: "bg-red-500", text: "text-red-500", label: "Offline", pulse: false },
  unknown: { color: "bg-muted/500", text: "text-muted-foreground", label: "Unknown", pulse: false },
};

function formatAgo(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function AgentMonitorPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchData = async () => {
    try {
      const [statusRes, actRes] = await Promise.all([
        apiClient.get(`/admin/agent-status`, { showErrorToast: false }),
        apiClient.get(`/admin/agent-activity?limit=500`, { showErrorToast: false }),
      ]);
      if (statusRes) { setAgents(statusRes.agents || []); }
      if (actRes) { setActivity(actRes.events || []); }
    } catch (err) {
      console.error("Failed to fetch agent data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const sseUrl = `${API_URL}/api/v1/admin/agent-live${token ? `?token=${token}` : ""}`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      setTimeout(() => {
        if (eventSourceRef.current === es) { es.close(); fetchData(); }
      }, 5000);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "activity" && data.event) {
          setActivity((prev) => [data.event, ...prev].slice(0, 500));
        }
        if (data.type === "status" && data.agents) {
          setAgents((prev) => {
            const updated = [...prev];
            for (const s of data.agents) {
              const idx = updated.findIndex((a) => a.hostname === s.hostname);
              if (idx >= 0) updated[idx] = { ...updated[idx], ...s };
            }
            return updated;
          });
        }
      } catch (e) {}
    };

    const interval = setInterval(fetchData, 10000);
    return () => { es.close(); clearInterval(interval); };
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>;

  const activeCount = agents.filter((a) => a.status === "active").length;
  const filteredActivity = selectedNode
    ? activity.filter((e) => e.hostname === selectedNode)
    : activity;

  return (
    <div className="p-6 space-y-6">
<div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="h-8 w-8 text-green-500" />
            Agent Monitor
          </h1>
          <p className="text-muted-foreground mt-1">Live-Übersicht aller Agenten und ihrer Aktivitäten</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`h-3 w-3 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-sm text-muted-foreground">{connected ? "Live" : "Reconnecting..."}</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Wifi className="h-8 w-8 text-green-500" />
            <div>
              <div className="text-2xl font-bold">{activeCount}</div>
              <div className="text-xs text-muted-foreground">Active Agents</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Monitor className="h-8 w-8 text-blue-500" />
            <div>
              <div className="text-2xl font-bold">{agents.length}</div>
              <div className="text-xs text-muted-foreground">Total Agents</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Cpu className="h-8 w-8 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold">{agents.reduce((s, a) => s + a.running_jobs, 0)}</div>
              <div className="text-xs text-muted-foreground">Running Jobs</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Wrench className="h-8 w-8 text-purple-500" />
            <div>
              <div className="text-2xl font-bold">{agents.reduce((s, a) => s + a.pending_remediation + a.running_remediation, 0)}</div>
              <div className="text-xs text-muted-foreground">Remediation</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content: Node List + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Node List (Left) */}
        <div className="lg:col-span-3 space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Agents ({agents.length})
          </h2>

          {/* "All" button */}
          <button
            onClick={() => setSelectedNode(null)}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              selectedNode === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 hover:bg-muted text-foreground"
            }`}
          >
            <div className="flex items-center justify-between">
              <span>Alle Agents</span>
              <span className="text-xs opacity-70">{activity.length}</span>
            </div>
          </button>

          {agents.map((agent) => {
            const sc = STATUS_CONFIG[agent.status];
            const evtCount = activity.filter((e) => e.hostname === agent.hostname).length;
            const isSelected = selectedNode === agent.hostname;
            return (
              <button
                key={agent.id}
                onClick={() => setSelectedNode(isSelected ? null : agent.hostname)}
                className={`w-full text-left px-3 py-3 rounded-lg transition-all ${
                  isSelected
                    ? "bg-primary text-primary-foreground ring-2 ring-primary"
                    : "bg-card border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${sc.color} ${sc.pulse ? "animate-pulse" : ""}`} />
                    <span className="font-semibold text-sm">{agent.hostname}</span>
                  </div>
                  <span className={`text-xs ${isSelected ? "opacity-80" : sc.text}`}>
                    {formatAgo(agent.seconds_ago)}
                  </span>
                </div>
                <div className={`flex items-center gap-3 text-xs ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                  <span>v{agent.agent_version || "?"}</span>
                  {agent.running_jobs > 0 && (
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3" /> {agent.running_jobs}
                    </span>
                  )}
                  {(agent.pending_remediation + agent.running_remediation) > 0 && (
                    <span className="flex items-center gap-1">
                      <Shield className="h-3 w-3" /> {agent.pending_remediation + agent.running_remediation}
                    </span>
                  )}
                  <span className="ml-auto">{evtCount} events</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Live Activity Feed (Right) */}
        <div className="lg:col-span-9">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              Live Activity
              {selectedNode && (
                <span className="normal-case font-bold text-foreground ml-1">
                  — {selectedNode}
                </span>
              )}
            </h2>
            <span className="text-xs text-muted-foreground">{filteredActivity.length} events</span>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="h-[calc(100vh-380px)] min-h-[400px] overflow-y-auto">
                {filteredActivity.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Warte auf Aktivitäten{selectedNode ? ` von ${selectedNode}` : ""}...</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b z-10">
                      <tr className="text-xs text-muted-foreground">
                        <th className="text-left py-2 px-3 w-[80px]">Zeit</th>
                        <th className="text-left py-2 px-3 w-[30px]"></th>
                        <th className="text-left py-2 px-3">Agent</th>
                        <th className="text-left py-2 px-3">Aktion</th>
                        <th className="text-left py-2 px-3">IP</th>
                        <th className="text-right py-2 px-3 w-[50px]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredActivity.map((evt, idx) => {
                        const IconComp = ACTION_ICONS[evt.action] || Activity;
                        const label = ACTION_LABELS[evt.action] || evt.action;
                        const isError = evt.status_code >= 400;
                        const time = new Date(evt.timestamp);
                        const timeStr = time.toLocaleTimeString("de-DE", {
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        });

                        return (
                          <tr
                            key={`${evt.timestamp}-${idx}`}
                            className={`hover:bg-muted/50 transition-colors ${
                              idx === 0 ? "bg-green-500/5" : ""
                            } ${isError ? "bg-red-500/5" : ""}`}
                          >
                            <td className="py-1.5 px-3 font-mono text-xs text-muted-foreground">
                              {timeStr}
                            </td>
                            <td className="py-1.5 px-1">
                              <IconComp className={`h-3.5 w-3.5 ${isError ? "text-red-500" : "text-muted-foreground"}`} />
                            </td>
                            <td className="py-1.5 px-3">
                              <button
                                onClick={() => setSelectedNode(
                                  selectedNode === evt.hostname ? null : evt.hostname
                                )}
                                className="font-medium hover:text-primary transition-colors"
                              >
                                {evt.hostname}
                              </button>
                            </td>
                            <td className="py-1.5 px-3">
                              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                isError ? "bg-red-500/10 text-red-500" :
                                evt.action.includes("result") ? "bg-green-500/10 text-green-500" :
                                evt.action.includes("health") || evt.action.includes("live") ? "bg-blue-500/10 text-blue-500" :
                                evt.action.includes("remediation") ? "bg-purple-500/10 text-purple-500" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {label}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-xs text-muted-foreground font-mono">
                              {evt.ip}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <span className={`text-xs font-mono ${isError ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
                                {evt.status_code}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
