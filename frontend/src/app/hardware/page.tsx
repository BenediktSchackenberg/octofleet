"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { hwText } from "@/lib/hardware";
import { useI18n } from "@/lib/i18n-context";



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
  diskTypes: { ssd: number; hdd: number; virtual?: number; unknown: number };
  busTypes: { name: string; count: number }[];
  physicalDisks: Array<{
    nodeId: string;
    hostname: string;
    model: string;
    sizeGB: number;
    busType: string | null;
    interfaceType?: string | null;
    isSsd: boolean | null;
    isVirtual?: boolean;
    healthStatus: string | null;
    temperature: number | null;
    wearLevel: number | null;
  }>;
  issues: {
    nodeId: string; hostname: string; issue: string; severity: string;
    kind?: "volumeUsage" | "diskHealth"; drive?: string; usedPercent?: number; model?: string; status?: string;
  }[];
}

type Health = "healthy" | "warning" | "unhealthy" | "unknown";

function healthOf(status: string | null): Health {
  const s = (status || "").toLowerCase();
  if (s === "healthy") return "healthy";
  if (s === "warning" || s === "degraded") return "warning";
  if (s === "unhealthy" || s === "failed") return "unhealthy";
  return "unknown";
}

const HEALTH_STYLE: Record<Health, string> = {
  healthy: "bg-green-500/20 text-green-400",
  warning: "bg-yellow-500/20 text-yellow-400",
  unhealthy: "bg-red-500/20 text-red-400",
  unknown: "bg-zinc-500/20 text-zinc-400",
};

export default function FleetHardwarePage() {
  const { t } = useI18n();
  const [data, setData] = useState<FleetHardware | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const json = await apiClient.get<FleetHardware>(`/hardware/fleet`, { showErrorToast: false });
        if (json) {
          setData(json);
        } else {
          setError(t("hardwareFleet.loadError"));
        }
      } catch (err) {
        setError(t("hardwareFleet.loadError"));
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
          <p className="text-zinc-400">{t("hardwareFleet.loading")}</p>
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
          <p className="text-zinc-400">{t("hardwareFleet.noData")}</p>
        </div>
      </main>
    );
  }

  // Safe access
  const storage = data.storage || { totalTB: 0, usedTB: 0, usedPercent: 0 };
  const pdh = data.physicalDiskHealth || { healthy: 0, warning: 0, unhealthy: 0, unknown: 0 };
  const dt = { virtual: 0, ...(data.diskTypes || { ssd: 0, hdd: 0, unknown: 0 }) };
  const cpuTypes = data.cpuTypes || [];
  const physicalDisks = data.physicalDisks || [];
  const issues = data.issues || [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-7xl mx-auto">
<h1 className="text-3xl font-bold mb-2">🖥️ {t("hardwareFleet.title")}</h1>
        <p className="text-zinc-400 mb-6">{t("hardwareFleet.nodesRecorded", { count: data.nodeCount })}</p>

        {/* Issues Banner */}
        {issues.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500 rounded-lg">
            <h3 className="text-yellow-400 font-semibold mb-2">⚠️ {t("hardwareFleet.issues", { count: issues.length })}</h3>
            <div className="space-y-2">
              {issues.slice(0, 5).map((issue, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={issue.severity === "critical" ? "text-red-400" : "text-yellow-400"}>
                    {issue.severity === "critical" ? "🔴" : "🟡"}
                  </span>
                  <Link href={`/nodes/${issue.nodeId}`} className="text-blue-400 hover:underline">
                    {issue.hostname}
                  </Link>
                  <span className="text-zinc-400">
                    {issue.kind === "volumeUsage"
                      ? t("hardwareFleet.issueVolumeUsage", { drive: issue.drive ?? "?", percent: issue.usedPercent ?? 0 })
                      : issue.kind === "diskHealth"
                        ? t("hardwareFleet.issueDiskHealth", { model: issue.model ?? "?", status: issue.status ?? "?" })
                        : issue.issue}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Storage */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">{t("hardwareFleet.totalStorage")}</h3>
            <p className="text-2xl font-bold">{storage.totalTB?.toFixed(1) || 0} TB</p>
            <div className="mt-2 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={`h-full ${storage.usedPercent > 80 ? 'bg-red-500' : storage.usedPercent > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${storage.usedPercent || 0}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500 mt-1">{t("hardwareFleet.used", { used: storage.usedTB?.toFixed(1) || 0, percent: storage.usedPercent || 0 })}</p>
          </div>

          {/* Physical Disk Health */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">{t("hardwareFleet.physicalDisks")}</h3>
            <p className="text-2xl font-bold">
              {pdh.unhealthy > 0 ? "🔴" : pdh.warning > 0 ? "🟡" : pdh.healthy > 0 ? "🟢" : "❓"} {pdh.healthy + pdh.warning + pdh.unhealthy + pdh.unknown}
            </p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1">
              <div>✅ {pdh.healthy} {t("hardwareFleet.health.healthy")}</div>
              <div>⚠️ {pdh.warning} {t("hardwareFleet.health.warning")}</div>
              <div>❌ {pdh.unhealthy} {t("hardwareFleet.health.unhealthy")}</div>
              {pdh.unknown > 0 && <div>❓ {pdh.unknown} {t("hardwareFleet.health.unknown")}</div>}
            </div>
          </div>

          {/* Disk Types */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">{t("hardwareFleet.diskTypes")}</h3>
            <p className="text-2xl font-bold">{dt.ssd + dt.hdd + dt.virtual + dt.unknown}</p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1">
              <div>💾 {dt.ssd} SSD</div>{/* i18n-ignore */}
              <div>🗄️ {dt.hdd} HDD</div>{/* i18n-ignore */}
              {dt.virtual > 0 && <div>🖥️ {dt.virtual} {t("hardwareFleet.virtual")}</div>}
              {dt.unknown > 0 && <div>❓ {dt.unknown} {t("hardwareFleet.unknownType")}</div>}
            </div>
          </div>

          {/* CPU Types */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">{t("hardwareFleet.cpuTypes")}</h3>
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
              <h3 className="font-semibold">📀 {t("hardwareFleet.physicalDisksCount", { count: physicalDisks.length })}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50">
                  <tr className="text-left text-sm text-zinc-400">
                    <th className="p-3">{t("hardwareFleet.host")}</th>
                    <th className="p-3">{t("hardwareFleet.model")}</th>
                    <th className="p-3">{t("hardwareFleet.size")}</th>
                    <th className="p-3">{t("hardwareFleet.type")}</th>
                    <th className="p-3">{t("hardwareFleet.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {physicalDisks.map((disk, i) => {
                    const bus = hwText(disk.busType) ?? hwText(disk.interfaceType);
                    const health = healthOf(disk.healthStatus);
                    return (
                    <tr key={i} className="hover:bg-zinc-800/30">
                      <td className="p-3">
                        <Link href={`/nodes/${disk.nodeId}`} className="text-blue-400 hover:underline">
                          {disk.hostname}
                        </Link>
                      </td>
                      <td className="p-3 text-sm text-zinc-300">{disk.model}</td>
                      <td className="p-3 text-sm">{disk.sizeGB?.toFixed(0)} GB</td>
                      <td className="p-3 text-sm">
                        {disk.isVirtual ? `🖥️ ${t("hardwareFleet.virtual")}`
                          : disk.isSsd === true ? "💾 SSD" : disk.isSsd === false ? "🗄️ HDD" : `❓ ${t("hardwareFleet.unknownType")}`}
                        {bus && <span className="text-zinc-500 ml-1">({bus})</span>}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${HEALTH_STYLE[health]}`}>
                          {t(`hardwareFleet.health.${health}`)}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
