"use client";

import { StatCard } from "./StatCard";
import { PerformanceCard } from "./PerformanceCard";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Monitor, AlertCircle, Briefcase, Activity, 
  Shield, RefreshCw, Server, Database, CheckCircle2
} from "lucide-react";
import Link from "next/link";

interface DashboardOverviewProps {
  summary: any;
  metrics: any;
  timeseries: any;
  sqlCatalog: any;
  recentAlerts: any[];
  systemHealth: any;
  loading: boolean;
  onRefresh: () => void;
  onNodeSelect: (id: string) => void;
}

export function DashboardOverview({
  summary,
  metrics,
  timeseries,
  sqlCatalog,
  recentAlerts,
  systemHealth,
  loading,
  onRefresh,
  onNodeSelect
}: DashboardOverviewProps) {
  
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      {/* Dynamic Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-black tracking-tight text-foreground bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/50">
            Infrastructure Command
          </h2>
          <p className="text-muted-foreground flex items-center gap-2 font-medium">
            <Server className="h-4 w-4 text-primary" /> Real-time fleet synchronization active
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" className="shadow-sm bg-background/50 border-border/50 hover:bg-muted/50 transition-all font-bold uppercase tracking-widest text-[10px]" onClick={onRefresh}>
            <RefreshCw className={loading ? "h-3.5 w-3.5 mr-2 animate-spin" : "h-3.5 w-3.5 mr-2"} /> 
            Sync Data
          </Button>
        </div>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-12 gap-6">
        
        {/* Row 1: KPI Stats */}
        <div className="col-span-12 md:col-span-3">
          <StatCard 
            title="Active Endpoints"
            value={summary?.counts.total || 0}
            description={`${summary?.counts.online || 0} nodes currently transmitting`}
            icon={<Monitor className="h-5 w-5" />}
            variant="primary"
            className="h-full"
          />
        </div>

        <div className="col-span-12 md:col-span-3">
          <StatCard 
            title="Security Exposure"
            value={summary?.vulnerabilities?.critical || 0}
            description="Critical CVEs detected in fleet"
            icon={<Shield className="h-5 w-5" />}
            variant="destructive"
            className="h-full"
          />
        </div>

        {/* Row 2: Large Performance Graph & Smaller Cards */}
        <PerformanceCard 
          timeseries={timeseries}
          metrics={metrics}
          onNodeSelect={onNodeSelect}
        />

        {/* Right Column Cards */}
        <div className="col-span-12 md:col-span-6 grid grid-cols-2 gap-6">
          {/* Jobs Status */}
          <Card className="col-span-1 border-green-500/10 bg-gradient-to-br from-card to-green-500/5 shadow-xl hover:shadow-green-500/10 transition-all group">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-600">
                <Briefcase className="h-4 w-4" /> Orchestration
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-4xl font-black text-green-500 tabular-nums">{summary?.jobs?.success || 0}</span>
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Success</span>
              </div>
              <div className="h-1.5 w-full bg-green-500/10 rounded-full overflow-hidden mb-4">
                <div 
                  className="h-full bg-green-500 transition-all duration-1000" 
                  style={{ width: `${(summary?.jobs?.success / (summary?.jobs?.total || 1)) * 100}%` }} 
                />
              </div>
              <div className="flex justify-between items-center text-[10px] font-black uppercase">
                <span className="text-red-500">{summary?.jobs?.failed || 0} Failed</span>
                <span className="text-yellow-600">{summary?.jobs?.pending || 0} Active</span>
              </div>
            </CardContent>
          </Card>

          {/* SQL Server Updates */}
          <Card className="col-span-1 border-blue-500/10 bg-gradient-to-br from-card to-blue-500/5 shadow-xl">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600">
                🗄️ SQL Lifecycle
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-4xl font-black mb-1 tabular-nums">{sqlCatalog?.total || 0}</div>
              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-3">Pending CU Sync</p>
              <Button variant="ghost" size="sm" className="w-full text-[9px] font-black uppercase border border-blue-500/10 hover:bg-blue-500/5" asChild>
                <Link href="/sql">Launch Catalog →</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <Card className="col-span-2 border-border/50 shadow-xl bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-4 bg-muted/5 border-b">
              <div className="flex items-center justify-between">
                <CardDescription className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <AlertCircle className="h-4 w-4" /> Global Incident Stream
                </CardDescription>
                <Link href="/alerts" className="text-[10px] font-black text-primary hover:underline uppercase tracking-widest">
                  View All →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/30">
                {recentAlerts.length > 0 ? recentAlerts.slice(0, 5).map((alert: any) => (
                  <div key={alert.id} className="flex items-center justify-between py-3 px-4 hover:bg-primary/5 transition-all group">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full shadow-[0_0_10px] ${
                        alert.event_type === 'node_offline' ? 'bg-red-500 shadow-red-500/50' :
                        alert.event_type === 'node_online' ? 'bg-green-500 shadow-green-500/50' :
                        'bg-blue-500 shadow-blue-500/50'
                      }`} />
                      <span className="text-xs font-bold text-foreground/80 group-hover:text-foreground transition-colors truncate max-w-[280px]">
                        {alert.message || alert.event_type}
                      </span>
                    </div>
                    <span className="text-[9px] font-black font-mono text-muted-foreground/50 tabular-nums">
                      {new Date(alert.sent_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )) : (
                  <div className="text-center py-10 text-[10px] text-muted-foreground/30 font-black uppercase tracking-widest">
                    No active incidents reported
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* System Health */}
        <div className="col-span-12">
          <Card className="border-border/50 shadow-lg bg-muted/5">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-8">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${systemHealth?.status === 'ok' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-ping'}`} />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Core Engine</span>
                      <span className="text-xs font-bold">{systemHealth?.status === 'ok' ? 'Stable' : 'Degraded'}</span>
                    </div>
                  </div>
                  <div className="w-px h-8 bg-border/50" />
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${systemHealth?.database === 'connected' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-ping'}`} />
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">Intelligence DB</span>
                      <span className="text-xs font-bold">{systemHealth?.database === 'connected' ? 'Connected' : 'Sync Error'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-background/50 rounded-full border border-border/50 shadow-inner">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-[10px] font-black uppercase tracking-tighter text-muted-foreground">All systems operational in 12 regions</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
