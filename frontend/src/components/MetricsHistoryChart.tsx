"use client";

import { useState, useEffect } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MetricsChartProps {
  nodeId: string;
  title?: string;
}

interface DataPoint {
  timestamp: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
}

export function MetricsHistoryChart({ nodeId, title = "Performance History" }: MetricsChartProps) {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState("24");
  const [interval, setInterval] = useState("15m");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/v1/nodes/${nodeId}/metrics/history?hours=${hours}&interval=${interval}`,
          { headers: getAuthHeader() }
        );
        if (res.ok) {
          const json = await res.json();
          // Transform data for recharts
          const chartData = (json.data || []).map((point: DataPoint) => ({
            time: new Date(point.timestamp).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            CPU: point.cpu ? Math.round(point.cpu * 10) / 10 : null,
            RAM: point.memory ? Math.round(point.memory * 10) / 10 : null,
            Disk: point.disk ? Math.round(point.disk * 10) / 10 : null,
          }));
          setData(chartData);
        }
      } catch (e) {
        console.error("Failed to fetch metrics history:", e);
      }
      setLoading(false);
    };
    fetchData();
  }, [nodeId, hours, interval]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          <div className="flex gap-2">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1h</SelectItem>
                <SelectItem value="6">6h</SelectItem>
                <SelectItem value="24">24h</SelectItem>
                <SelectItem value="72">3d</SelectItem>
                <SelectItem value="168">7d</SelectItem>
              </SelectContent>
            </Select>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5m">5min</SelectItem>
                <SelectItem value="15m">15min</SelectItem>
                <SelectItem value="1h">1h</SelectItem>
                <SelectItem value="6h">6h</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        ) : data.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              <YAxis 
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px"
                }}
                formatter={(value: number) => [`${value}%`, ""]}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="CPU"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="RAM"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="Disk"
                stroke="#eab308"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
