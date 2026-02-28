"use client";

import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { TrendingUp, Activity, Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface PerformanceCardProps {
  timeseries: any;
  metrics: any;
  onNodeSelect: (id: string) => void;
}

export function PerformanceCard({ timeseries, metrics, onNodeSelect }: PerformanceCardProps) {
  
  const HeatBar = ({ value, colorClass }: { value: number; colorClass: string }) => (
    <div className="flex items-center justify-center gap-1.5">
      <span className="font-mono text-[11px] w-6 text-right tabular-nums font-bold">{Math.round(value)}</span>
      <div className="flex gap-0.5 h-3 items-center">
        {[1, 2, 3, 4, 5].map((step) => {
          const threshold = step * 20;
          const isActive = value >= threshold - 10;
          return (
            <div 
              key={step} 
              className={`w-1.5 h-full rounded-[1px] transition-all duration-500 ${isActive ? colorClass : 'bg-muted/30'}`} 
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <Card className="col-span-12 md:col-span-6 md:row-span-2 border-border/50 shadow-2xl bg-card/40 backdrop-blur-xl overflow-hidden group">
      <CardHeader className="pb-4 bg-muted/10 border-b">
        <div className="flex items-center justify-between">
          <CardDescription className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-primary">
            <TrendingUp className="h-4 w-4" /> Live Fleet Intelligence
          </CardDescription>
          <Link href="/performance" className="text-[10px] font-black text-muted-foreground hover:text-primary transition-colors uppercase tracking-widest border border-border/50 px-2 py-1 rounded bg-background/50">
            Advanced Insights →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {timeseries && timeseries.timeseries?.length > 0 ? (
          <div className="space-y-8">
            {/* Fleet Sparklines */}
            <div className="grid grid-cols-3 gap-6">
              {[
                { label: 'CPU', val: timeseries.current?.cpu, color: 'var(--primary)', key: 'cpu' },
                { label: 'RAM', val: timeseries.current?.ram, color: '#22c55e', key: 'ram' },
                { label: 'Disk', val: timeseries.current?.disk, color: '#a855f7', key: 'disk' }
              ].map((m) => (
                <div key={m.label} className="bg-background/40 p-3 rounded-2xl border border-border/30 shadow-sm group/spark transition-all hover:border-primary/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest">{m.label}</span>
                    <span className="text-xl font-black tabular-nums" style={{ color: m.color }}>{m.val?.toFixed(0) || 0}%</span>
                  </div>
                  <div className="h-14">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timeseries.timeseries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={m.color} stopOpacity={0.4}/>
                            <stop offset="95%" stopColor={m.color} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <Area 
                          type="monotone" 
                          dataKey={m.key} 
                          stroke={m.color} 
                          fill={`url(#grad-${m.key})`} 
                          strokeWidth={2.5} 
                          dot={false} 
                          animationDuration={2000}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>

            {/* Per-node hotspot matrix */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Top Endpoint Hotspots</h3>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-primary" /><span className="text-[9px] font-bold uppercase text-muted-foreground/60">CPU</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[9px] font-bold uppercase text-muted-foreground/60">RAM</span>
                  </div>
                </div>
              </div>
              <div className="max-h-[350px] overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
                {(Array.isArray(metrics?.nodes) ? metrics.nodes : [])
                  .filter((n: any) => n.cpuPercent !== null || n.ramPercent !== null)
                  .sort((a: any, b: any) => Math.max(b.cpuPercent || 0, b.ramPercent || 0, b.diskPercent || 0) - Math.max(a.cpuPercent || 0, a.ramPercent || 0, a.diskPercent || 0))
                  .slice(0, 15)
                  .map((node: any, i: number) => {
                    const cpu = node.cpuPercent || 0;
                    const ram = node.ramPercent || 0;
                    const disk = node.diskPercent || 0;
                    const worst = Math.max(cpu, ram, disk);
                    const status = worst > 85 ? 'crit' : worst > 70 ? 'warn' : 'ok';
                    
                    return (
                      <div 
                        key={i} 
                        className="grid grid-cols-[1fr_80px_80px_80px_85px] gap-4 items-center py-2.5 px-3 bg-background/20 hover:bg-primary/5 rounded-xl border border-transparent hover:border-primary/20 transition-all cursor-pointer group"
                        onClick={() => onNodeSelect(node.nodeId)}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <div className={`w-1.5 h-1.5 rounded-full ${status === 'crit' ? 'bg-red-500' : 'bg-primary/40'}`} />
                          <span className="font-black text-xs truncate group-hover:text-primary transition-colors">{node.hostname}</span>
                        </div>
                        <HeatBar value={cpu} colorClass="bg-primary shadow-[0_0_8px_rgba(var(--primary),0.4)]" />
                        <HeatBar value={ram} colorClass="bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                        <HeatBar value={disk} colorClass="bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                        <div className="text-right">
                          {status === 'crit' ? (
                            <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-[9px] font-black uppercase py-0 px-2">Critical</Badge>
                          ) : (
                            <span className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-tighter">Operational</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-muted/5 rounded-2xl border-2 border-dashed border-border/50">
            <Activity className="h-12 w-12 mb-4 opacity-10 animate-pulse" />
            <p className="text-sm font-black uppercase tracking-widest">No Active Telemetry</p>
            <p className="text-xs opacity-50 mt-1 font-medium italic">Check agent connection status</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
