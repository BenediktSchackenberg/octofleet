"use client";

import { useEffect, useState, useRef } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  recent_actions: ActivityEvent[];
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
  "terminal-poll": "Terminal Poll",
  "shell-poll": "Shell Poll",
  "screen-poll": "Screen Poll",
  "remediation-poll": "Remediation Poll",
  "health-report": "Health Report",
  "live-data": "Live Data",
  "remediation-result": "Remediation Result",
  "job-result": "Job Result",
  poll: "Poll",
};

const STATUS_CONFIG = {
  active: { color: "bg-green-500", text: "text-green-500", label: "Active", pulse: true },
  idle: { color: "bg-yellow-500", text: "text-yellow-500", label: "Idle", pulse: false },
  stale: { color: "bg-orange-500", text: "text-orange-500", label: "Stale", pulse: false },
  offline: { color: "bg-red-500", text: "text-red-500", label: "Offline", pulse: false },
  unknown: { color: "bg-gray-500", text: "text-gray-500", label: "Unknown", pulse: false },
};

function formatAgo(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function AgentMonitorPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const activityRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch initial data
  const fetchData = async () => {
    try {
      const headers = getAuthHeader();
      const [statusRes, actRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/agent-status`, { headers }),
        fetch(`${API_URL}/api/v1/admin/agent-activity?limit=200`, { headers }),
      ]);
      if (statusRes.ok) {
        const d = await statusRes.json();
        setAgents(d.agents || []);
      }
      if (actRes.ok) {
        const d = await actRes.json();
        setActivity(d.events || []);
      }
    } catch (err) {
      console.error("Failed to fetch agent data", err);
    } finally {
      setLoading(false);
    }
  };

  // Connect SSE for live updates
  useEffect(() => {
    fetchData();

    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const sseUrl = `${API_URL}/api/v1/admin/agent-live${token ? `?token=${token}` : ""}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      // Reconnect after 5s
      setTimeout(() => {
        if (eventSourceRef.current === es) {
          es.close();
          fetchData();
        }
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
              if (idx >= 0) {
                updated[idx] = { ...updated[idx], ...s };
              }
            }
            return updated;
          });
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    // Also poll every 10s as fallback
    const interval = setInterval(fetchData, 10000);

    return () => {
      es.close();
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  const activeCount = agents.filter((a) => a.status === "active").length;
  const totalCount = agents.length;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Admin" },
          { label: "Agent Monitor" },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="h-8 w-8 text-green-500" />
            Agent Monitor
          </h1>
          <p className="text-muted-foreground mt-1">
            Live-Übersicht aller Agenten und ihrer Aktivitäten
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`h-3 w-3 rounded-full ${
              connected ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-muted-foreground">
            {connected ? "Live Connected" : "Reconnecting..."}
          </span>
        </div>
      </div>

      {/* Summary */}
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
              <div className="text-2xl font-bold">{totalCount}</div>
              <div className="text-xs text-muted-foreground">Total Agents</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Cpu className="h-8 w-8 text-yellow-500" />
            <div>
              <div className="text-2xl font-bold">
                {agents.reduce((s, a) => s + a.running_jobs, 0)}
              </div>
              <div className="text-xs text-muted-foreground">Running Jobs</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Wrench className="h-8 w-8 text-purple-500" />
            <div>
              <div className="text-2xl font-bold">
                {agents.reduce((s, a) => s + a.pending_remediation + a.running_remediation, 0)}
              </div>
              <div className="text-xs text-muted-foreground">Remediation Jobs</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent Cards */}
        <div className="lg:col-span-1 space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Monitor className="h-5 w-5" /> Agents
          </h2>
          {agents.map((agent) => {
            const sc = STATUS_CONFIG[agent.status];
            return (
              <Card key={agent.id} className="overflow-hidden">
                <div className={`h-1 ${sc.color}`} />
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-3 w-3 rounded-full ${sc.color} ${
                          sc.pulse ? "animate-pulse" : ""
                        }`}
                      />
                      <span className="font-semibold">{agent.hostname}</span>
                    </div>
                    <span className={`text-xs font-medium ${sc.text}`}>
                      {sc.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatAgo(agent.seconds_ago)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      v{agent.agent_version || "?"}
                    </div>
                    <div>{agent.os_name || "—"}</div>
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {agent.running_jobs} running
                    </div>
                  </div>

                  {(agent.queued_jobs > 0 ||
                    agent.pending_remediation > 0 ||
                    agent.running_remediation > 0) && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {agent.queued_jobs > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-500">
                          {agent.queued_jobs} queued
                        </span>
                      )}
                      {agent.pending_remediation > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-purple-500/10 text-purple-500">
                          {agent.pending_remediation} remed. pending
                        </span>
                      )}
                      {agent.running_remediation > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/10 text-orange-500">
                          {agent.running_remediation} remed. running
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Live Activity Feed */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
            <Activity className="h-5 w-5 text-green-500" /> Live Activity
            <span className="text-xs text-muted-foreground font-normal ml-2">
              ({activity.length} events)
            </span>
          </h2>
          <Card>
            <CardContent className="p-0">
              <div
                ref={activityRef}
                className="h-[600px] overflow-y-auto divide-y divide-border"
              >
                {activity.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Warte auf Agent-Aktivitäten...</p>
                    <p className="text-xs mt-1">
                      Events erscheinen hier sobald Agents pollen
                    </p>
                  </div>
                ) : (
                  activity.map((evt, idx) => {
                    const IconComp = ACTION_ICONS[evt.action] || Activity;
                    const label = ACTION_LABELS[evt.action] || evt.action;
                    const isError = evt.status_code >= 400;
                    const time = new Date(evt.timestamp);
                    const timeStr = time.toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });

                    return (
                      <div
                        key={`${evt.timestamp}-${idx}`}
                        className={`flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/50 transition-colors ${
                          idx === 0 ? "bg-primary/5" : ""
                        }`}
                      >
                        <span className="text-xs text-muted-foreground font-mono w-[65px] shrink-0">
                          {timeStr}
                        </span>
                        <IconComp
                          className={`h-4 w-4 shrink-0 ${
                            isError ? "text-red-500" : "text-muted-foreground"
                          }`}
                        />
                        <span className="font-medium w-[130px] shrink-0 truncate">
                          {evt.hostname}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                            isError
                              ? "bg-red-500/10 text-red-500"
                              : evt.action.includes("result")
                              ? "bg-green-500/10 text-green-500"
                              : evt.action.includes("health") || evt.action.includes("live")
                              ? "bg-blue-500/10 text-blue-500"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {label}
                        </span>
                        <span className="text-xs text-muted-foreground truncate flex-1">
                          {evt.ip}
                        </span>
                        {isError && (
                          <span className="text-xs text-red-500 font-mono">
                            {evt.status_code}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
