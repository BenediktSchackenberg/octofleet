"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { hwText } from "@/lib/hardware";
import { useI18n } from "@/lib/i18n-context";
import { AlertTriangle, CircleAlert, CircleCheck, CircleHelp, CircleX, HardDrive, Monitor, Server } from "lucide-react";

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
  physicalDiskHealth: { healthy: number; warning: number; unhealthy: number; virtual?: number; unknown: number };
  diskTypes: { ssd: number; hdd: number; virtual?: number; unknown: number };
  busTypes: { name: string; count: number }[];
  physicalDisks: Array<{
    nodeId: string;
    hostname: string;
    deviceId?: string | null;
    model: string;
    sizeGB: number;
    busType: string | null;
    interfaceType?: string | null;
    isSsd: boolean | null;
    isVirtual?: boolean;
    healthStatus: string | null;
    health?: Health;
    temperature: number | null;
    wearLevel: number | null;
  }>;
  issues: {
    nodeId: string; hostname: string; issue: string; severity: string;
    kind?: "volumeUsage" | "diskHealth"; drive?: string; usedPercent?: number; model?: string; status?: string;
  }[];
}

// "virtual": a disk of a virtual machine without a health status – no SMART, its health belongs to
// the host's storage; neutral, not a problem (unlike "unknown" on a physical disk).
type Health = "healthy" | "warning" | "unhealthy" | "virtual" | "unknown";

function healthOf(status: string | null, isVirtual?: boolean): Health {
  const s = (status || "").toLowerCase();
  if (s === "healthy") return "healthy";
  if (s === "warning" || s === "degraded") return "warning";
  if (s === "unhealthy" || s === "failed") return "unhealthy";
  return isVirtual ? "virtual" : "unknown";
}

// Short device name: "\\.\PHYSICALDRIVE1" → "Disk 1" (as in Disk Management), "/dev/sda" → "sda".
function deviceLabel(deviceId: string | null | undefined, t: (key: string, vars?: Record<string, string | number>) => string): string | null {
  if (!deviceId) return null;
  const win = /PHYSICALDRIVE(\d+)$/i.exec(deviceId);
  if (win) return t("hardwareFleet.diskNumber", { n: win[1] });
  return deviceId.replace(/^\/dev\//, "");
}

const HEALTH_STYLE: Record<Health, string> = {
  healthy: "bg-green-500/20 text-green-400",
  warning: "bg-yellow-500/20 text-yellow-400",
  unhealthy: "bg-red-500/20 text-red-400",
  virtual: "bg-sky-500/15 text-sky-300",
  unknown: "bg-zinc-500/20 text-zinc-400",
};

const ICON = "inline h-4 w-4 align-[-2px]";

// A host's status is its worst disk's: a problem first, then what cannot be judged, then fine
// A disk with a problem: its line in the host row takes the colour of its status
const PROBLEM_TEXT: Partial<Record<Health, string>> = { warning: "text-yellow-300", unhealthy: "text-red-400" };

const HEALTH_RANK: Record<Health, number> = { unhealthy: 4, warning: 3, unknown: 2, virtual: 1, healthy: 0 };

type FleetDisk = FleetHardware["physicalDisks"][number];

function diskType(disk: FleetDisk, t: (key: string) => string): string {
  const kind = disk.isVirtual ? t("hardwareFleet.virtual")
    : disk.isSsd === true ? "SSD" : disk.isSsd === false ? "HDD" : t("hardwareFleet.unknownType");
  const bus = hwText(disk.busType) ?? hwText(disk.interfaceType);
  return bus ? `${kind} (${bus})` : kind;
}

// Hosts with a problem disk come first (unhealthy, then warning); all others alphabetically
const PROBLEM_RANK: Partial<Record<Health, number>> = { unhealthy: 2, warning: 1 };

/** The disks grouped per host (one table row each): problem hosts first, then by hostname */
function disksByHost(disks: FleetDisk[]) {
  const hosts = new Map<string, { nodeId: string; hostname: string; disks: (FleetDisk & { state: Health })[] }>();
  for (const disk of disks) {
    const host = hosts.get(disk.nodeId) ?? { nodeId: disk.nodeId, hostname: disk.hostname, disks: [] };
    host.disks.push({ ...disk, state: disk.health ?? healthOf(disk.healthStatus, disk.isVirtual) });
    hosts.set(disk.nodeId, host);
  }
  return [...hosts.values()].map((host) => {
    const worst = host.disks.reduce<Health>((w, d) => (HEALTH_RANK[d.state] > HEALTH_RANK[w] ? d.state : w), "healthy");
    return { ...host, worst, totalGB: host.disks.reduce((sum, d) => sum + (d.sizeGB || 0), 0) };
  }).sort((a, b) => (PROBLEM_RANK[b.worst] ?? 0) - (PROBLEM_RANK[a.worst] ?? 0)
    || a.hostname.localeCompare(b.hostname, undefined, { sensitivity: "base" }));
}

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
  const pdh = { virtual: 0, ...(data.physicalDiskHealth || { healthy: 0, warning: 0, unhealthy: 0, unknown: 0 }) };
  const dt = { virtual: 0, ...(data.diskTypes || { ssd: 0, hdd: 0, unknown: 0 }) };
  const cpuTypes = data.cpuTypes || [];
  const physicalDisks = data.physicalDisks || [];
  const hosts = disksByHost(physicalDisks);
  const issues = data.issues || [];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-7xl mx-auto">
<h1 className="text-3xl font-bold mb-2 flex items-center gap-3"><Server className="h-7 w-7 text-zinc-400" aria-hidden="true" />{t("hardwareFleet.title")}</h1>
        <p className="text-zinc-400 mb-6">{t("hardwareFleet.nodesRecorded", { count: data.nodeCount })}</p>

        {/* Issues Banner */}
        {issues.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500 rounded-lg">
            <h3 className="text-yellow-400 font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t("hardwareFleet.issues", { count: issues.length })}</h3>
            <div className="space-y-2">
              {issues.slice(0, 5).map((issue, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {issue.severity === "critical"
                    ? <CircleX className="h-4 w-4 text-red-400 shrink-0" aria-hidden="true" />
                    : <CircleAlert className="h-4 w-4 text-yellow-400 shrink-0" aria-hidden="true" />}
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
            <p className="text-2xl font-bold flex items-center gap-2">
              {pdh.unhealthy > 0 ? <CircleX className="h-6 w-6 text-red-400" aria-hidden="true" />
                : pdh.warning > 0 ? <CircleAlert className="h-6 w-6 text-yellow-400" aria-hidden="true" />
                : <CircleCheck className="h-6 w-6 text-green-400" aria-hidden="true" />}
              {pdh.healthy + pdh.warning + pdh.unhealthy + pdh.virtual + pdh.unknown}
            </p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1">
              <div><CircleCheck className={`${ICON} text-green-400`} aria-hidden="true" /> {pdh.healthy} {t("hardwareFleet.health.healthy")}</div>
              <div><CircleAlert className={`${ICON} text-yellow-400`} aria-hidden="true" /> {pdh.warning} {t("hardwareFleet.health.warning")}</div>
              <div><CircleX className={`${ICON} text-red-400`} aria-hidden="true" /> {pdh.unhealthy} {t("hardwareFleet.health.unhealthy")}</div>
              {pdh.virtual > 0 && <div title={t("hardwareFleet.health.virtualHint")}><Monitor className={`${ICON} text-sky-300`} aria-hidden="true" /> {pdh.virtual} {t("hardwareFleet.health.virtual")}</div>}
              {pdh.unknown > 0 && <div><CircleHelp className={ICON} aria-hidden="true" /> {pdh.unknown} {t("hardwareFleet.health.unknown")}</div>}
            </div>
          </div>

          {/* Disk Types */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-zinc-400 text-sm">{t("hardwareFleet.diskTypes")}</h3>
            {/* how many kinds of disk (like CPU types), not how many disks - that is the Disks card */}
            <p className="text-2xl font-bold">{[dt.ssd, dt.hdd, dt.virtual, dt.unknown].filter((n) => n > 0).length}</p>
            <div className="text-xs text-zinc-500 mt-2 space-y-1">
              <div><HardDrive className={ICON} aria-hidden="true" /> {dt.ssd} SSD</div>{/* i18n-ignore */}
              <div><HardDrive className={ICON} aria-hidden="true" /> {dt.hdd} HDD</div>{/* i18n-ignore */}
              {dt.virtual > 0 && <div><Monitor className={ICON} aria-hidden="true" /> {dt.virtual} {t("hardwareFleet.virtual")}</div>}
              {dt.unknown > 0 && <div><CircleHelp className={ICON} aria-hidden="true" /> {dt.unknown} {t("hardwareFleet.unknownType")}</div>}
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
              <h3 className="font-semibold flex items-center gap-2"><HardDrive className="h-4 w-4 text-zinc-400" aria-hidden="true" />{t("hardwareFleet.physicalDisksByHost", { count: physicalDisks.length, hosts: hosts.length })}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50">
                  <tr className="text-left text-sm text-zinc-400">
                    <th className="p-3">{t("hardwareFleet.host")}</th>
                    <th className="p-3">{t("hardwareFleet.physicalDisks")}</th>
                    <th className="p-3 text-right">{t("hardwareFleet.size")}</th>
                    <th className="p-3">{t("hardwareFleet.type")}</th>
                    <th className="p-3">{t("hardwareFleet.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {hosts.map((host) => {
                    const types = [...new Set(host.disks.map((d) => diskType(d, t)))];
                    const mixed = host.disks.some((d) => d.state !== host.worst);
                    return (
                    <tr key={host.nodeId} className="hover:bg-zinc-800/30 align-top">
                      <td className="p-3">
                        <Link href={`/nodes/${host.nodeId}?tab=hardware`} className="text-blue-400 hover:underline">
                          {host.hostname}
                        </Link>
                      </td>
                      <td className="p-3 text-sm text-zinc-300">
                        <ul className="space-y-0.5">
                          {host.disks.map((disk, i) => (
                            <li key={i} className={PROBLEM_TEXT[disk.state] ?? ""}>
                              <span className="font-medium" title={disk.deviceId ?? undefined}>{deviceLabel(disk.deviceId, t) ?? "–"}</span>
                              <span className="text-zinc-500"> · </span>{disk.model}
                              <span className="text-zinc-500 tabular-nums"> · {disk.sizeGB?.toFixed(0)} GB</span>
                              {mixed && disk.state !== "healthy" && disk.state !== "virtual" && (
                                <span className={`ml-2 px-1.5 rounded text-xs ${HEALTH_STYLE[disk.state]}`}>{t(`hardwareFleet.health.${disk.state}`)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="p-3 text-sm whitespace-nowrap text-right tabular-nums">{host.totalGB.toFixed(0)} GB</td>
                      <td className="p-3 text-sm">{types.join(", ")}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs whitespace-nowrap ${HEALTH_STYLE[host.worst]}`}
                          title={host.worst === "virtual" ? t("hardwareFleet.health.virtualHint") : undefined}>
                          {t(`hardwareFleet.health.${host.worst}`)}
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
