"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    isUp: boolean;
  };
  className?: string;
  variant?: "default" | "primary" | "destructive" | "success" | "warning" | "blue";
}

export function StatCard({ 
  title, 
  value, 
  description, 
  icon, 
  trend, 
  className,
  variant = "default" 
}: StatCardProps) {
  
  const variants = {
    default: "border-border/50 bg-card",
    primary: "border-primary/20 bg-gradient-to-br from-card to-primary/5",
    destructive: "border-destructive/20 bg-gradient-to-br from-card to-destructive/5",
    success: "border-green-500/20 bg-gradient-to-br from-card to-green-500/5",
    warning: "border-yellow-500/20 bg-gradient-to-br from-card to-yellow-500/5",
    blue: "border-blue-500/20 bg-gradient-to-br from-card to-blue-500/5",
  };

  const titleColors = {
    default: "text-muted-foreground",
    primary: "text-primary",
    destructive: "text-destructive",
    success: "text-green-600",
    warning: "text-yellow-600",
    blue: "text-blue-400",
  };

  return (
    <Card className={cn("overflow-hidden transition-all hover:shadow-md", variants[variant], className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardDescription className={cn("text-[10px] font-black uppercase tracking-widest", titleColors[variant])}>
          {title}
        </CardDescription>
        <div className={cn("p-2 rounded-lg bg-background/50 border border-border/10", titleColors[variant])}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-black tracking-tighter mb-1">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground font-medium">
            {description}
          </p>
        )}
        {trend && (
          <div className={cn(
            "flex items-center gap-1 mt-2 text-[10px] font-bold uppercase",
            trend.isUp ? "text-green-500" : "text-destructive"
          )}>
            <span>{trend.isUp ? "↑" : "↓"} {trend.value}%</span>
            <span className="text-muted-foreground/50">since last check</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
