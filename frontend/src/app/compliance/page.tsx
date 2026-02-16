"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { Shield, ShieldCheck, ShieldX, Lock, Unlock, Flame, FlameKindling } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "octofleet-dev-key";

interface ComplianceData {
  totalNodes: number;
  defender: { enabled: number; disabled: number; unknown: number };
  firewall: { enabled: number; disabled: number; unknown: number };
  bitlocker: { encrypted: number; unencrypted: number; unknown: number };
  realTimeProtection: { enabled: number; disabled: number; unknown: number };
  nodes: Array<{
    nodeId: string;
    hostname: string;
    defender: boolean | null;
    realTimeProtection: boolean | null;
    firewall: boolean | null;
    bitlocker: boolean | null;
  }>;
}

const COLORS = {
  good: "#22c55e",
  bad: "#ef4444",
  unknown: "#71717a"
};

export default function CompliancePage() {
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "issues">("all");

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const res = await fetch(`${API_URL}/api/v1/compliance/summary`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch compliance data:", e);
    } finally {
      setLoading(false);
    }
  }

  function StatusIcon({ value }: { value: boolean | null }) {
    if (value === true) return <span className="text-green-500">✅</span>;
    if (value === false) return <span className="text-red-500">❌</span>;
    return <span className="text-zinc-500">❓</span>;
  }

  function makePieData(obj: { enabled?: number; disabled?: number; encrypted?: number; unencrypted?: number; unknown: number }) {
    if ("enabled" in obj) {
      return [
        { name: "Enabled", value: obj.enabled || 0, color: COLORS.good },
        { name: "Disabled", value: obj.disabled || 0, color: COLORS.bad },
        { name: "Unknown", value: obj.unknown || 0, color: COLORS.unknown },
      ].filter(d => d.value > 0);
    }
    return [
      { name: "Encrypted", value: obj.encrypted || 0, color: COLORS.good },
      { name: "Unencrypted", value: obj.unencrypted || 0, color: COLORS.bad },
      { name: "Unknown", value: obj.unknown || 0, color: COLORS.unknown },
    ].filter(d => d.value > 0);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Breadcrumb items={[{ label: "Compliance" }]} />
        <h1 className="text-2xl font-bold mb-6">🛡️ Compliance Dashboard</h1>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Breadcrumb items={[{ label: "Compliance" }]} />
        <h1 className="text-2xl font-bold mb-6">🛡️ Compliance Dashboard</h1>
        <p className="text-muted-foreground">Failed to load compliance data</p>
      </div>
    );
  }

  const hasIssue = (node: ComplianceData["nodes"][0]) => 
    node.defender === false || 
    node.realTimeProtection === false || 
    node.firewall === false || 
    node.bitlocker === false;

  const filteredNodes = filter === "issues" 
    ? data.nodes.filter(hasIssue)
    : data.nodes;

  const issueCount = data.nodes.filter(hasIssue).length;

  return (
    <div className="min-h-screen bg-background p-6">
      <Breadcrumb items={[{ label: "Compliance" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">🛡️ Compliance Dashboard</h1>
          <p className="text-muted-foreground">Security status across all nodes</p>
        </div>
        <div className="flex gap-2">
          <a 
            href={`${API_URL}/api/v1/export/compliance?format=csv`}
            className="px-3 py-2 bg-secondary hover:bg-secondary/80 rounded text-sm"
          >
            📥 Export CSV
          </a>
          <button
            onClick={fetchData}
            className="px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded text-sm"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards with Pie Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Defender */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-500" />
              Windows Defender
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={makePieData(data.defender)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={45}
                  >
                    {makePieData(data.defender).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-sm mt-2">
              <span className="text-green-500">{data.defender.enabled}</span> enabled, 
              <span className="text-red-500 ml-1">{data.defender.disabled}</span> disabled
            </div>
          </CardContent>
        </Card>

        {/* Real-time Protection */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              Real-time Protection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={makePieData(data.realTimeProtection)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={45}
                  >
                    {makePieData(data.realTimeProtection).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-sm mt-2">
              <span className="text-green-500">{data.realTimeProtection.enabled}</span> enabled, 
              <span className="text-red-500 ml-1">{data.realTimeProtection.disabled}</span> disabled
            </div>
          </CardContent>
        </Card>

        {/* Firewall */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-500" />
              Firewall
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={makePieData(data.firewall)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={45}
                  >
                    {makePieData(data.firewall).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-sm mt-2">
              <span className="text-green-500">{data.firewall.enabled}</span> enabled, 
              <span className="text-red-500 ml-1">{data.firewall.disabled}</span> disabled
            </div>
          </CardContent>
        </Card>

        {/* BitLocker */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lock className="h-5 w-5 text-purple-500" />
              BitLocker
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={makePieData(data.bitlocker)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={45}
                  >
                    {makePieData(data.bitlocker).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-sm mt-2">
              <span className="text-green-500">{data.bitlocker.encrypted}</span> encrypted, 
              <span className="text-red-500 ml-1">{data.bitlocker.unencrypted}</span> unencrypted
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Node Security Status</CardTitle>
            <div className="flex gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1 rounded text-sm ${
                  filter === "all" ? "bg-primary text-primary-foreground" : "bg-secondary"
                }`}
              >
                All ({data.totalNodes})
              </button>
              <button
                onClick={() => setFilter("issues")}
                className={`px-3 py-1 rounded text-sm ${
                  filter === "issues" ? "bg-red-600 text-white" : "bg-secondary"
                }`}
              >
                ⚠️ Issues ({issueCount})
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead className="text-center">Defender</TableHead>
                <TableHead className="text-center">Real-time</TableHead>
                <TableHead className="text-center">Firewall</TableHead>
                <TableHead className="text-center">BitLocker</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredNodes.map((node) => (
                <TableRow key={node.nodeId} className={hasIssue(node) ? "bg-red-950/20" : ""}>
                  <TableCell>
                    <Link href={`/nodes/${node.nodeId}`} className="text-primary hover:underline font-medium">
                      {node.hostname}
                    </Link>
                  </TableCell>
                  <TableCell className="text-center"><StatusIcon value={node.defender} /></TableCell>
                  <TableCell className="text-center"><StatusIcon value={node.realTimeProtection} /></TableCell>
                  <TableCell className="text-center"><StatusIcon value={node.firewall} /></TableCell>
                  <TableCell className="text-center"><StatusIcon value={node.bitlocker} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
