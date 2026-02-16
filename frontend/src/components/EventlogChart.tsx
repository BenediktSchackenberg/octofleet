"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "openclaw-inventory-dev-key";

interface TrendData {
  day: string;
  errors: number;
  warnings: number;
  total: number;
}

interface EventlogChartProps {
  days?: number;
  chartType?: "bar" | "line";
}

export function EventlogChart({ days = 7, chartType = "bar" }: EventlogChartProps) {
  const [data, setData] = useState<TrendData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTrends();
  }, [days]);

  async function fetchTrends() {
    try {
      const res = await fetch(`${API_URL}/api/v1/eventlog/trends?days=${days}`, {
        headers: { "X-API-Key": API_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.trends || []);
      }
    } catch (e) {
      console.error("Failed to fetch eventlog trends:", e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        Loading chart...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">
        No eventlog data available
      </div>
    );
  }

  // Format day labels
  const formattedData = data.map(d => ({
    ...d,
    dayLabel: new Date(d.day).toLocaleDateString("de-DE", { weekday: "short", day: "numeric" })
  }));

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={formattedData}>
          <XAxis dataKey="dayLabel" tick={{ fill: "#888", fontSize: 12 }} />
          <YAxis tick={{ fill: "#888", fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333" }}
            labelStyle={{ color: "#fff" }}
          />
          <Legend />
          <Line type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={2} name="Errors" />
          <Line type="monotone" dataKey="warnings" stroke="#eab308" strokeWidth={2} name="Warnings" />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={formattedData}>
        <XAxis dataKey="dayLabel" tick={{ fill: "#888", fontSize: 12 }} />
        <YAxis tick={{ fill: "#888", fontSize: 12 }} />
        <Tooltip 
          contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333" }}
          labelStyle={{ color: "#fff" }}
        />
        <Legend />
        <Bar dataKey="errors" fill="#ef4444" name="Errors" />
        <Bar dataKey="warnings" fill="#eab308" name="Warnings" />
      </BarChart>
    </ResponsiveContainer>
  );
}
