"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────────────────

export interface NodeDetails {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  os_build: string;
  last_seen: string;
  first_seen: string;
  is_online: boolean;
  agent_version: string | null;
  cpuName: string | null;
  totalMemoryGb: number | null;
  softwareCount: number;
  hardwareUpdatedAt: string | null;
  groups: { id: string; name: string; color: string; icon: string | null }[];
  tags: { id: string; name: string; color: string }[];
}

export interface InventoryChange {
  id: number;
  category: string;
  changeType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

export interface CriticalCookiesData {
  nodeId: string;
  criticalCookies: {
    username: string;
    browser: string;
    profile: string;
    domain: string;
    name: string;
    category: string;
    isSecure: boolean;
    isHttpOnly: boolean;
    isSession: boolean;
    isExpired: boolean;
    expiresUtc: string | null;
  }[];
  count: number;
  summary: Record<string, { count: number; domains: string[] }>;
  warnings: string[];
}

export interface HardwareData {
  data?: {
    cpu?: { name?: string; cores?: number; threads?: number; speed?: string };
    memory?: { totalGb?: number; usedGb?: number; slots?: { capacity?: string; type?: string }[] };
    disks?: { name?: string; size?: string; type?: string; partitions?: { name?: string; size?: string; freeSpace?: string }[] }[];
    gpus?: { name?: string; memory?: string; driver?: string }[];
    motherboard?: { manufacturer?: string; product?: string };
    bios?: { manufacturer?: string; version?: string; releaseDate?: string };
    network?: { name?: string; mac?: string; speed?: string }[];
  };
  ram?: unknown;
  gpu?: unknown[];
  nics?: unknown;
}

export interface SoftwareItem {
  name: string;
  version: string;
  publisher?: string;
  installDate?: string;
  installSource?: string;
  productCode?: string;
}

export interface HotfixData {
  hotfixes: { hotfixId: string; description?: string; installedOn?: string }[];
  updateHistory: { title?: string; date?: string; result?: string }[];
}

export interface SystemData {
  data?: {
    users?: { name?: string; enabled?: boolean; lastLogon?: string }[];
    services?: { name?: string; displayName?: string; status?: string; startType?: string }[];
    scheduledTasks?: { name?: string; status?: string; nextRunTime?: string; lastRunResult?: string }[];
    startupItems?: { name?: string; command?: string; location?: string }[];
  };
}

export interface SecurityData {
  data?: {
    antivirus?: { name?: string; enabled?: boolean; upToDate?: boolean };
    firewall?: { enabled?: boolean; profiles?: Record<string, boolean> };
    uac?: { enabled?: boolean; level?: string };
    bitlocker?: { drives?: { drive?: string; status?: string; protectionStatus?: string }[] };
    secureboot?: { enabled?: boolean };
    tpm?: { present?: boolean; version?: string };
  };
}

export interface NetworkData {
  data?: {
    adapters?: { name?: string; mac?: string; ipv4?: string[]; ipv6?: string[]; dhcpEnabled?: boolean }[];
    dns?: string[];
    routes?: { destination?: string; gateway?: string; metric?: number }[];
    shares?: { name?: string; path?: string; description?: string }[];
  };
}

export interface BrowserData {
  data?: {
    browsers?: { name?: string; version?: string; isDefault?: boolean; profileCount?: number }[];
    extensions?: { browser?: string; name?: string; version?: string; enabled?: boolean }[];
  };
}

export interface EventlogEntry {
  id: number;
  logName: string;
  eventId: number;
  level: number;
  levelName: string;
  source: string;
  message: string;
  eventTime: string;
}

export interface LinuxData {
  performance?: {
    loadAverage?: { load1: number; load5: number; load15: number };
    cpuCores?: { core: number; usagePercent: number }[];
    memory?: { totalBytes: number; freeBytes: number; availableBytes: number; buffersBytes: number; cachedBytes: number };
    swap?: { totalBytes: number; usedBytes: number; freeBytes: number };
    diskIo?: { device: string; readsCompleted: number; writesCompleted: number; readBytes: number; writeBytes: number }[];
    diskSpace?: { mount: string; device: string; totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number }[];
    networkIo?: { interface: string; rxBytes: number; txBytes: number; rxPackets: number; txPackets: number }[];
  };
  services?: {
    services?: { name: string; loadState: string; activeState: string; subState: string; description: string }[];
    summary?: { total: number; active: number; failed: number; inactive: number };
    enabledServices?: string[];
  };
  updates?: {
    packageManager?: string;
    totalUpdates?: number;
    securityUpdates?: number;
    lastCheckTime?: string;
    updates?: { name: string; newVersion: string; security: boolean }[];
  };
  diskHealth?: {
    smartctlAvailable?: boolean;
    disks?: { device: string; model: string; healthStatus: string; temperature: number; powerOnHours: number }[];
  };
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useNodeDetails(nodeId: string) {
  const [loading, setLoading] = useState(true);
  const [node, setNode] = useState<NodeDetails | null>(null);
  const [history, setHistory] = useState<InventoryChange[]>([]);
  const [hardware, setHardware] = useState<HardwareData | null>(null);
  const [software, setSoftware] = useState<SoftwareItem[]>([]);
  const [hotfixes, setHotfixes] = useState<HotfixData>({ hotfixes: [], updateHistory: [] });
  const [system, setSystem] = useState<SystemData | null>(null);
  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [browser, setBrowser] = useState<BrowserData | null>(null);
  const [criticalCookies, setCriticalCookies] = useState<CriticalCookiesData | null>(null);
  const [events, setEvents] = useState<EventlogEntry[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [linuxData, setLinuxData] = useState<LinuxData | null>(null);

  async function refreshInventory() {
    setRefreshing(true);
    try {
      const [hwRes, swRes, hfRes, sysRes, secRes, netRes, brRes, critRes] = await Promise.all([
        apiClient.richGet(`/inventory/hardware/${nodeId}`),
        apiClient.richGet(`/inventory/software/${nodeId}`),
        apiClient.richGet(`/inventory/hotfixes/${nodeId}`),
        apiClient.richGet(`/inventory/system/${nodeId}`),
        apiClient.richGet(`/inventory/security/${nodeId}`),
        apiClient.richGet(`/inventory/network/${nodeId}`),
        apiClient.richGet(`/inventory/browser/${nodeId}`),
        apiClient.richGet<CriticalCookiesData>(`/inventory/browser/${nodeId}/critical`),
      ]);

      if (hwRes.ok && hwRes.data) { setHardware((hwRes.data as Record<string, unknown>).hwRes as HardwareData || {}); }
      if (swRes.ok && swRes.data) { setSoftware(((swRes.data as Record<string, unknown>).swRes as Record<string, unknown>)?.installedPrograms as SoftwareItem[] || []); }
      if (hfRes.ok && hfRes.data) { const d = (hfRes.data as Record<string, unknown>).hfRes as Record<string, unknown>; setHotfixes({ hotfixes: (d?.hotfixes || []) as HotfixData["hotfixes"], updateHistory: (d?.updateHistory || []) as HotfixData["updateHistory"] }); }
      if (sysRes.ok && sysRes.data) { setSystem((sysRes.data as Record<string, unknown>).sysRes as SystemData || {}); }
      if (secRes.ok && secRes.data) { setSecurity((secRes.data as Record<string, unknown>).secRes as SecurityData || {}); }
      if (netRes.ok && netRes.data) { setNetwork((netRes.data as Record<string, unknown>).netRes as NetworkData || {}); }
      if (brRes.ok && brRes.data) { setBrowser((brRes.data as Record<string, unknown>).brRes as BrowserData || {}); }
      if (critRes.ok && critRes.data) { setCriticalCookies(critRes.data); }
    } catch (err) {
      console.error("Failed to refresh inventory:", err);
    } finally {
      setRefreshing(false);
    }
  }

  async function fetchNodeDetails() {
    setLoading(true);
    try {
      const [nodeRes, historyRes, hwRes, swRes, hfRes, sysRes, secRes, netRes, brRes, critRes] = await Promise.all([
        apiClient.richGet<NodeDetails>(`/nodes/${nodeId}`),
        apiClient.richGet<{ changes?: InventoryChange[] }>(`/nodes/${nodeId}/history?limit=50`),
        apiClient.richGet(`/inventory/hardware/${nodeId}`),
        apiClient.richGet(`/inventory/software/${nodeId}`),
        apiClient.richGet(`/inventory/hotfixes/${nodeId}`),
        apiClient.richGet(`/inventory/system/${nodeId}`),
        apiClient.richGet(`/inventory/security/${nodeId}`),
        apiClient.richGet(`/inventory/network/${nodeId}`),
        apiClient.richGet(`/inventory/browser/${nodeId}`),
        apiClient.richGet<CriticalCookiesData>(`/inventory/browser/${nodeId}/critical`),
      ]);

      if (nodeRes.ok && nodeRes.data) setNode(nodeRes.data);
      if (historyRes.ok && historyRes.data) { setHistory(historyRes.data.changes || []); }
      if (hwRes.ok && hwRes.data) { setHardware((hwRes.data as Record<string, unknown>).hwRes as HardwareData || {}); }
      if (swRes.ok && swRes.data) { setSoftware(((swRes.data as Record<string, unknown>).swRes as Record<string, unknown>)?.installedPrograms as SoftwareItem[] || []); }
      if (hfRes.ok && hfRes.data) { const d = (hfRes.data as Record<string, unknown>).hfRes as Record<string, unknown>; setHotfixes({ hotfixes: (d?.hotfixes || []) as HotfixData["hotfixes"], updateHistory: (d?.updateHistory || []) as HotfixData["updateHistory"] }); }
      if (sysRes.ok && sysRes.data) { setSystem((sysRes.data as Record<string, unknown>).sysRes as SystemData || {}); }
      if (secRes.ok && secRes.data) { setSecurity((secRes.data as Record<string, unknown>).secRes as SecurityData || {}); }
      if (netRes.ok && netRes.data) { setNetwork((netRes.data as Record<string, unknown>).netRes as NetworkData || {}); }
      if (brRes.ok && brRes.data) { setBrowser((brRes.data as Record<string, unknown>).brRes as BrowserData || {}); }
      if (critRes.ok && critRes.data) { setCriticalCookies(critRes.data); }

      // Fetch Linux-specific data
      const linuxRes = await apiClient.richGet<{ linuxRes?: LinuxData }>(`/inventory/linux/${nodeId}`);
      if (linuxRes.ok && linuxRes.data) { setLinuxData(linuxRes.data.linuxRes || null); }

      // Fetch eventlog separately
      const eventsRes = await apiClient.richGet<{ events?: EventlogEntry[] }>(`/nodes/${nodeId}/eventlog?limit=100`);
      if (eventsRes.ok && eventsRes.data) { setEvents(eventsRes.data.events || []); }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNodeDetails();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Derived data with proper types
  const hwData: HardwareData = (hardware || {}) as HardwareData;
  const sysData: SystemData = (system || {}) as SystemData;
  const secData: SecurityData = (security || {}) as SecurityData;
  const netData: NetworkData = (network || {}) as NetworkData;
  const browserData: BrowserData = (browser || {}) as BrowserData;
  const ramData = (hwData as Record<string, unknown>).ram || ((hwData as Record<string, unknown>).data as Record<string, unknown>)?.memory || {};
  const gpuList: Array<Record<string, unknown>> = ((hwData as Record<string, unknown>).gpu || ((hwData as Record<string, unknown>).data as Record<string, unknown>)?.gpus || []) as Array<Record<string, unknown>>;
  const nicsList = (hwData as Record<string, unknown>).nics || ((hwData as Record<string, unknown>).data as Record<string, unknown>)?.network || {};
  const totalUpdatesCount = hotfixes.hotfixes.length + hotfixes.updateHistory.length;

  return {
    loading, node, history, hardware, software, hotfixes, system, security,
    network, browser, criticalCookies, events, eventsLoading, refreshing,
    linuxData,
    // Derived
    hwData, sysData, secData, netData, browserData, ramData, gpuList, nicsList,
    totalUpdatesCount,
    // Actions
    refreshInventory, fetchNodeDetails,
  };
}
