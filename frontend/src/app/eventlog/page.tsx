"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { EventlogChart } from "@/components/EventlogChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API_URL = "http://192.168.0.5:8080";
const API_KEY = "openclaw-inventory-dev-key";

interface EventlogSummary {
  nodeId: string;
  hostname: string;
  logName: string;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  totalCount: number;
  lastCollected: string;
}

interface CriticalEvent {
  id: number;
  nodeId: string;
  hostname: string;
  logName: string;
  eventId: number;
  level: number;
  levelName: string;
  source: string;
  message: string;
  eventTime: string;
}

function LevelBadge({ level, name }: { level: number; name?: string }) {
  const styles: Record<number, string> = {
    0: "bg-blue-500/20 text-blue-400",  // Audit Success
    1: "bg-red-600/20 text-red-400",    // Critical
    2: "bg-red-500/20 text-red-400",    // Error
    3: "bg-yellow-500/20 text-yellow-400", // Warning
    4: "bg-zinc-500/20 text-zinc-400",  // Information
    5: "bg-zinc-600/20 text-zinc-500",  // Verbose
  };
  
  const labels: Record<number, string> = {
    0: "Audit",
    1: "Critical",
    2: "Error",
    3: "Warning",
    4: "Info",
    5: "Verbose",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[level] || styles[4]}`}>
      {name || labels[level] || `Level ${level}`}
    </span>
  );
}

function EventIdBadge({ eventId }: { eventId: number }) {
  // Highlight important security events
  const important = [4624, 4625, 4634, 4720, 4726, 4732, 4672, 7045, 1102];
  const isImportant = important.includes(eventId);
  
  return (
    <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
      isImportant ? "bg-purple-500/20 text-purple-400" : "bg-zinc-700 text-zinc-400"
    }`}>
      {eventId}
    </span>
  );
}

export default function EventlogPage() {
  const [summary, setSummary] = useState<EventlogSummary[]>([]);
  const [criticalEvents, setCriticalEvents] = useState<CriticalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [hours]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/eventlog/summary?hours=${hours}`, {
        headers: getAuthHeader(),
      });
      const data = await res.json();
      setSummary(data.summaryByNode || []);
      setCriticalEvents(data.recentCritical || []);
    } finally {
      setLoading(false);
    }
  }

  // Aggregate by node
  const nodeStats = summary.reduce((acc, s) => {
    if (!acc[s.nodeId]) {
      acc[s.nodeId] = { 
        hostname: s.hostname, 
        critical: 0, 
        error: 0, 
        warning: 0, 
        total: 0,
        lastCollected: s.lastCollected
      };
    }
    acc[s.nodeId].critical += s.criticalCount;
    acc[s.nodeId].error += s.errorCount;
    acc[s.nodeId].warning += s.warningCount;
    acc[s.nodeId].total += s.totalCount;
    return acc;
  }, {} as Record<string, { hostname: string; critical: number; error: number; warning: number; total: number; lastCollected: string }>);

  const filteredEvents = selectedNode 
    ? criticalEvents.filter(e => e.nodeId === selectedNode)
    : criticalEvents;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-7xl mx-auto p-6">
        <Breadcrumb items={[{ label: "Eventlog" }]} />
        
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">📋 Windows Eventlog</h1>
            <p className="text-zinc-400 text-sm">Security, System & Application Events</p>
          </div>
          
          <div className="flex items-center gap-3">
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm"
            >
              <option value={1}>Letzte Stunde</option>
              <option value={6}>Letzte 6 Stunden</option>
              <option value={24}>Letzte 24 Stunden</option>
              <option value={48}>Letzte 48 Stunden</option>
              <option value={168}>Letzte 7 Tage</option>
            </select>
            
            <button
              onClick={fetchData}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
            >
              🔄 Aktualisieren
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            {/* Eventlog Trend Chart */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-lg">📈 Error & Warning Trends (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <EventlogChart days={7} chartType="bar" />
              </CardContent>
            </Card>
            
            {/* Node Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {Object.entries(nodeStats).map(([nodeId, stats]) => (
                <div 
                  key={nodeId}
                  onClick={() => setSelectedNode(selectedNode === nodeId ? null : nodeId)}
                  className={`bg-zinc-900 rounded-lg border p-4 cursor-pointer transition-colors ${
                    selectedNode === nodeId 
                      ? "border-blue-500" 
                      : "border-zinc-800 hover:border-zinc-700"
                  }`}
                >
                  <div className="font-semibold mb-2">{stats.hostname}</div>
                  <div className="grid grid-cols-3 gap-2 text-center text-sm">
                    <div>
                      <div className="text-red-400 font-bold">{stats.critical + stats.error}</div>
                      <div className="text-zinc-500 text-xs">Errors</div>
                    </div>
                    <div>
                      <div className="text-yellow-400 font-bold">{stats.warning}</div>
                      <div className="text-zinc-500 text-xs">Warnings</div>
                    </div>
                    <div>
                      <div className="text-zinc-400 font-bold">{stats.total}</div>
                      <div className="text-zinc-500 text-xs">Total</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-600 mt-2">
                    {new Date(stats.lastCollected).toLocaleString("de-DE")}
                  </div>
                </div>
              ))}
              
              {Object.keys(nodeStats).length === 0 && (
                <div className="col-span-full text-center py-8 text-zinc-500">
                  <div className="text-4xl mb-2">📭</div>
                  <p>Keine Eventlog-Daten vorhanden</p>
                  <p className="text-sm mt-1">Führe einen Eventlog Collection Job aus</p>
                </div>
              )}
            </div>

            {/* Critical/Error Events Table */}
            {filteredEvents.length > 0 && (
              <div className="bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="font-semibold">
                    🚨 Kritische & Sicherheits-Events
                    {selectedNode && (
                      <span className="text-zinc-500 font-normal ml-2">
                        ({nodeStats[selectedNode]?.hostname})
                      </span>
                    )}
                  </h2>
                  {selectedNode && (
                    <button 
                      onClick={() => setSelectedNode(null)}
                      className="text-sm text-blue-400 hover:text-blue-300"
                    >
                      Filter aufheben
                    </button>
                  )}
                </div>
                
                <div className="divide-y divide-zinc-800 max-h-[600px] overflow-y-auto">
                  {filteredEvents.map((event) => (
                    <div key={event.id} className="p-4 hover:bg-zinc-800/50">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <EventIdBadge eventId={event.eventId} />
                          <LevelBadge level={event.level} name={event.levelName} />
                          <span className="text-zinc-500 text-xs">{event.logName}</span>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {new Date(event.eventTime).toLocaleString("de-DE")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <Link 
                          href={`/nodes/${event.nodeId}`}
                          className="text-blue-400 hover:text-blue-300 text-sm"
                        >
                          {event.hostname}
                        </Link>
                        <span className="text-zinc-600">•</span>
                        <span className="text-zinc-500 text-sm">{event.source}</span>
                      </div>
                      <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-950 p-2 rounded">
                        {event.message}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
