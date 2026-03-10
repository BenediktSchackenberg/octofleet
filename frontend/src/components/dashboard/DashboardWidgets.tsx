"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, LucideIcon } from "lucide-react";

// ─── StatCard ────────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "neutral";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: TrendDirection;
  trendLabel?: string;
  className?: string;
}

const trendConfig: Record<TrendDirection, { Icon: LucideIcon; color: string }> = {
  up: { Icon: TrendingUp, color: "text-green-400" },
  down: { Icon: TrendingDown, color: "text-red-400" },
  neutral: { Icon: Minus, color: "text-zinc-400" },
};

export function StatCard({ icon: Icon, label, value, trend, trendLabel, className = "" }: StatCardProps) {
  return (
    <Card className={`border-border/50 shadow-md ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-zinc-800/60">
              <Icon className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-bold text-foreground">{value}</p>
            </div>
          </div>
          {trend && (
            <div className={`flex items-center gap-1 ${trendConfig[trend].color}`}>
              {(() => { const TIcon = trendConfig[trend].Icon; return <TIcon className="h-3.5 w-3.5" />; })()}
              {trendLabel && <span className="text-xs font-medium">{trendLabel}</span>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── QuickActionCard ─────────────────────────────────────────────────

interface QuickActionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}

export function QuickActionCard({ icon: Icon, title, description, onClick }: QuickActionCardProps) {
  return (
    <Card
      className="border-border/50 shadow-md cursor-pointer hover:bg-zinc-800/40 transition-colors"
      onClick={onClick}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-zinc-800/60">
          <Icon className="h-4 w-4 text-zinc-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground truncate">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── ActivityFeed ────────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  icon: LucideIcon;
  description: string;
  timestamp: string;
  variant?: "default" | "warning" | "danger";
}

interface ActivityFeedProps {
  items: ActivityItem[];
  title?: string;
  emptyMessage?: string;
}

const variantColors: Record<string, string> = {
  default: "text-zinc-400",
  warning: "text-orange-400",
  danger: "text-red-400",
};

export function ActivityFeed({ items, title = "Recent Activity", emptyMessage = "No recent activity" }: ActivityFeedProps) {
  return (
    <Card className="border-border/50 shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">{emptyMessage}</p>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {items.map((item) => {
              const ItemIcon = item.icon;
              const color = variantColors[item.variant ?? "default"];
              return (
                <div key={item.id} className="flex items-start gap-3">
                  <ItemIcon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">{item.description}</p>
                    <p className="text-[10px] text-muted-foreground">{item.timestamp}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── ComplianceGauge ─────────────────────────────────────────────────

interface ComplianceGaugeProps {
  percentage: number;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function ComplianceGauge({ percentage, label = "Compliance", size = "md" }: ComplianceGaugeProps) {
  const clamped = Math.max(0, Math.min(100, percentage));
  const color = clamped >= 80 ? "bg-green-500" : clamped >= 50 ? "bg-yellow-500" : "bg-red-500";
  const textColor = clamped >= 80 ? "text-green-400" : clamped >= 50 ? "text-yellow-400" : "text-red-400";
  const heightClass = size === "sm" ? "h-2" : size === "md" ? "h-3" : "h-4";

  return (
    <Card className="border-border/50 shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
          <span className={`text-lg font-bold ${textColor}`}>{clamped}%</span>
        </div>
        <div className={`w-full ${heightClass} bg-zinc-800 rounded-full overflow-hidden`}>
          <div
            className={`${heightClass} ${color} rounded-full transition-all duration-500`}
            style={{ width: `${clamped}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
