"use client";

import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "octofleet-dev-key";

interface OsDistribution {
  name: string;
  count: number;
  versions: Array<{ version: string; count: number }>;
}

const COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#06b6d4", // cyan
  "#22c55e", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#6366f1", // indigo
];

export function OsDistributionChart({ showVersions = false }: { showVersions?: boolean }) {
  const [data, setData] = useState<OsDistribution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const res = await fetch(`${API_URL}/api/v1/nodes/os-distribution`, {
        headers: { "X-API-Key": API_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.distribution || []);
      }
    } catch (e) {
      console.error("Failed to fetch OS distribution:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No data
      </div>
    );
  }

  const chartData = data.map((d, i) => ({
    name: d.name,
    value: d.count,
    color: COLORS[i % COLORS.length]
  }));

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
              labelLine={false}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value) => [`${value} nodes`, "Count"]}
              contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legend with versions */}
      {showVersions && (
        <div className="mt-4 space-y-2">
          {data.map((os, i) => (
            <div key={i} className="text-sm">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="font-medium">{os.name}</span>
                <span className="text-muted-foreground">({os.count})</span>
              </div>
              {os.versions.length > 0 && (
                <div className="ml-5 text-muted-foreground text-xs space-y-0.5 mt-1">
                  {os.versions.slice(0, 3).map((v, j) => (
                    <div key={j}>{v.version}: {v.count}</div>
                  ))}
                  {os.versions.length > 3 && (
                    <div>+{os.versions.length - 3} more</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
