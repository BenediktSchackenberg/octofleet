"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui-components";
import { getAuthHeader } from "@/lib/auth-context";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080/api/v1';

interface FleetHardware {
  nodeCount: number;
  cpuTypes: { name: string; count: number }[];
  ramDistribution: Record<string, number>;
  storage: {
    totalTB: number;
    freeTB: number;
    usedTB: number;
    usedPercent: number;
  };
  diskHealth: { healthy: number; warning: number; critical: number };
  physicalDiskHealth: { healthy: number; warning: number; unhealthy: number; unknown: number };
  diskTypes: { ssd: number; hdd: number; unknown: number };
  busTypes: { name: string; count: number }[];
  physicalDisks: Array<{
    nodeId: string;
    hostname: string;
    model: string;
    sizeGB: number;
    busType: string;
    isSsd: boolean | null;
    healthStatus: string;
    temperature: number | null;
    wearLevel: number | null;
  }>;
  issues: { nodeId: string; hostname: string; issue: string; severity: string }[];
}

export default function FleetHardwarePage() {
  const [data, setData] = useState<FleetHardware | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`${API_BASE}/hardware/fleet`, { headers: getAuthHeader() });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        } else {
          setError(`API Error: ${res.status}`);
        }
      } catch (err) {
        setError(`Fetch failed: ${err}`);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-zinc-400">Lade Hardware-Übersicht...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-red-400">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-zinc-400">Keine Daten verfügbar</p>
        </div>
      </main>
    );
  }

  // Safe access
  const storage = data.storage || { totalTB: 0, usedTB: 0, usedPercent: 0 };
  const pdh = data.physicalDiskHealth || { healthy: 0, warning: 0, unhealthy: 0, unknown: 0 };
  const dt = data.diskTypes || { ssd: 0, hdd: 0, unknown: 0 };
  const cpuTypes = data.cpuTypes || [];
  const physicalDisks = data.physicalDisks || [];
  const issues = data.issues || [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-7xl mx-auto">
        <Breadcrumb items={[{ label: "Hardware Fleet" }]} />
        
        <h1 className="text-3xl font-bold mb-2">🖥️ Hardware Fleet Overview</h1>
        <p className="text-zinc-400 mb-6">{data.nodeCount} Nodes erfasst</p>

        {/* Issues Banner */}
        {issues.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500 rounded-lg">
            <h3 className="text-yellow-400 font-semibold mb-2">⚠️ {issues.length} Auffälligkeiten</h3>
            <div className="space-y-2">
              {issues.slice(0, 5).map((issue, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={issue.severity === "critical" ? "text-red-400" : "text-yellow-400"}>
                    {issue.severity === "critical" ? "🔴" : "🟡"}
                  </span>
                  <Link href={`/nodes/${issue.nodeId}`} className="text-blue-400 hover:underline">
                    {issue.hostname}
                  </Link>
                  <span className="text-zinc-400">{issue.issue}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Storage */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">Gesamtspeicher</h3>
            <p className="text-2xl font-bold">{storage.totalTB?.toFixed(1) || 0} TB</p>
            <div className="mt-2 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={`h-full ${storage.usedPercent > 80 ? 'bg-red-500' : storage.usedPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${storage.usedPercent || 0}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1">{storage.usedTB?.toFixed(1) || 0} TB belegt ({storage.usedPercent || 0}%)</p>
          </div>

          {/* Physical Disk Health */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">Physische Disks</h3>
            <p className="text-2xl font-bold">
              {pdh.unhealthy > 0 ? "🔴" : pdh.warning > 0 ? "🟡" : "🟢"} {pdh.healthy + pdh.warning + pdh.unhealthy + pdh.unknown}
            </p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1">
              <div>✅ {pdh.healthy} Healthy</div>
              <div>⚠️ {pdh.warning} Warning</div>
              <div>❌ {pdh.unhealthy} Unhealthy</div>
            </div>
          </div>

          {/* Disk Types */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">Disk-Typen</h3>
            <p className="text-2xl font-bold">{dt.ssd + dt.hdd + dt.unknown}</p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1">
              <div>💾 {dt.ssd} SSD</div>
              <div>🗄️ {dt.hdd} HDD</div>
              {dt.unknown > 0 && <div>❓ {dt.unknown} Unknown</div>}
            </div>
          </div>

          {/* CPU Types */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">CPU-Typen</h3>
            <p className="text-2xl font-bold">{cpuTypes.length}</p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1 max-h-20 overflow-y-auto">
              {cpuTypes.slice(0, 3).map((cpu, i) => (
                <div key={i} className="truncate">{cpu.count}x {cpu.name}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Physical Disks Table */}
        {physicalDisks.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-zinc-800">
              <h3 className="font-semibold">📀 Physische Disks ({physicalDisks.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50">
                  <tr className="text-left text-sm text-zinc-400">
                    <th className="p-3">Host</th>
                    <th className="p-3">Model</th>
                    <th className="p-3">Größe</th>
                    <th className="p-3">Typ</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {physicalDisks.map((disk, i) => (
                    <tr key={i} className="hover:bg-zinc-800/30">
                      <td className="p-3">
                        <Link href={`/nodes/${disk.nodeId}`} className="text-blue-400 hover:underline">
                          {disk.hostname}
                        </Link>
                      </td>
                      <td className="p-3 text-sm text-zinc-300">{disk.model}</td>
                      <td className="p-3 text-sm">{disk.sizeGB?.toFixed(0)} GB</td>
                      <td className="p-3 text-sm">
                        {disk.isSsd === true ? "💾 SSD" : disk.isSsd === false ? "🗄️ HDD" : "❓"} 
                        <span className="text-zinc-500 ml-1">({disk.busType})</span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${
                          disk.healthStatus?.toLowerCase() === 'healthy' ? 'bg-green-500/20 text-green-400' :
                          disk.healthStatus?.toLowerCase() === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {disk.healthStatus || 'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
