"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

import { API_BASE } from "@/lib/api-config";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import {
  Shield, AlertTriangle, FileSearch, Users, Settings, Database,
  Eye, Activity, ChevronRight, TrendingUp, TrendingDown
} from "lucide-react";

interface DashboardData {
  findings_by_severity: { severity: string; status: string; count: number }[];
  events_24h: number;
  file_events_24h: number;
  active_monitoring: number;
  top_event_types: { event_type: string; count: number }[];
}

export default function SecurityPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/security/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);


  const severityColors: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-blue-500",
    info: "bg-zinc-500",
  };

  const findingsTotal = data?.findings_by_severity?.reduce((sum, f) => sum + f.count, 0) || 0;
  const openFindings = data?.findings_by_severity?.filter(f => f.status === "open").reduce((sum, f) => sum + f.count, 0) || 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
<div className="flex items-center gap-3 mb-6">
          <Shield className="h-8 w-8 text-red-400" />
          <div>
            <h1 className="text-2xl font-bold">Security & Compliance</h1>
            <p className="text-zinc-400 text-sm">Monitor, detect, and respond to security events across your fleet</p>
          </div>
        </div>

        {/* Tabs removed — navigation is now in the Navbar mega dropdown */}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
          </div>
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400 text-sm">Open Findings</span>
                  <AlertTriangle className="h-5 w-5 text-orange-400" />
                </div>
                <div className="text-3xl font-bold">{openFindings}</div>
                <div className="text-xs text-zinc-500 mt-1">{findingsTotal} total findings</div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400 text-sm">Security Events (24h)</span>
                  <Activity className="h-5 w-5 text-blue-400" />
                </div>
                <div className="text-3xl font-bold">{data?.events_24h?.toLocaleString() || 0}</div>
                <div className="text-xs text-zinc-500 mt-1">Normalized events</div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400 text-sm">File Events (24h)</span>
                  <FileSearch className="h-5 w-5 text-green-400" />
                </div>
                <div className="text-3xl font-bold">{data?.file_events_24h?.toLocaleString() || 0}</div>
                <div className="text-xs text-zinc-500 mt-1">File audit events</div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400 text-sm">Active Monitoring</span>
                  <Eye className="h-5 w-5 text-purple-400" />
                </div>
                <div className="text-3xl font-bold">{data?.active_monitoring || 0}</div>
                <div className="text-xs text-zinc-500 mt-1">Active assignments</div>
              </div>
            </div>

            {/* Two column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Findings by Severity */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-400" />
                  Findings by Severity
                </h2>
                {data?.findings_by_severity && data.findings_by_severity.length > 0 ? (
                  <div className="space-y-3">
                    {["critical", "high", "medium", "low", "info"].map((sev) => {
                      const count = data.findings_by_severity
                        .filter((f) => f.severity === sev)
                        .reduce((sum, f) => sum + f.count, 0);
                      if (count === 0) return null;
                      return (
                        <div key={sev} className="flex items-center gap-3">
                          <div className={`w-3 h-3 rounded-full ${severityColors[sev]}`}></div>
                          <span className="capitalize text-sm flex-1">{sev}</span>
                          <span className="font-mono font-bold">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">No findings yet. Assign monitoring profiles to start detecting issues.</p>
                )}
              </div>

              {/* Top Event Types */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-400" />
                  Top Event Types (24h)
                </h2>
                {data?.top_event_types && data.top_event_types.length > 0 ? (
                  <div className="space-y-3">
                    {data.top_event_types.map((evt, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500 w-5">{i + 1}.</span>
                        <span className="text-sm flex-1 font-mono">{evt.event_type}</span>
                        <span className="font-mono font-bold">{evt.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-zinc-500 text-sm">No events in the last 24 hours.</p>
                )}
              </div>
            </div>

            {/* Quick Links */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link href="/security/profiles" className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-purple-500/50 transition-colors group">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Eye className="h-5 w-5 text-purple-400" />
                      Monitoring Profiles
                    </h3>
                    <p className="text-zinc-400 text-sm mt-1">Configure sensors, sampling, and file paths</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-purple-400 transition-colors" />
                </div>
              </Link>

              <Link href="/security/policies" className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-yellow-500/50 transition-colors group">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Settings className="h-5 w-5 text-yellow-400" />
                      Security Policies
                    </h3>
                    <p className="text-zinc-400 text-sm mt-1">Define behavior rules and thresholds</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-yellow-400 transition-colors" />
                </div>
              </Link>

              <Link href="/security/retention" className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-blue-500/50 transition-colors group">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      <Database className="h-5 w-5 text-blue-400" />
                      Data Retention
                    </h3>
                    <p className="text-zinc-400 text-sm mt-1">Manage lifecycle, archiving, and legal hold</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-blue-400 transition-colors" />
                </div>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
