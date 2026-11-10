"use client";

import { useTabParam } from "@/hooks/useTabParam";
import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useNodeDetails } from "@/hooks/useNodeDetails";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { ManageTagsDialog } from "@/components/manage-tags-dialog";
import { PerformanceTab } from "@/components/performance-tab";
import { Copy, Check, Zap, FolderTree, FileText, ExternalLink, ShieldAlert, Bug, Briefcase, Bell } from "lucide-react";
import { MonitoringHealthPanel } from "@/components/monitoring-health-panel";
import { FavoriteButton } from "@/components/FavoriteButton";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { hwNumber, hwText } from "@/lib/hardware";
import { useRecentlyOpened } from "@/hooks/useRecentlyOpened";
import { NodeRemovalBanner, RemoveNodeButton } from "@/components/node-removal";
import { NodeVulnerabilities, nodeVulnerabilitiesHref, useNodeVulnerabilityCount } from "@/components/node-vulnerabilities";
import { formatDate, formatDateTime as formatDateTimeIntl, formatLocalDate } from "@/lib/format";

type Translate = ReturnType<typeof useI18n>["t"];

/** Windows Update result as reported by the agent ("Succeeded", …) or as the numeric WUA code. */
const UPDATE_RESULTS: Record<string, { key: string; ok: boolean }> = {
  "0": { key: "notStarted", ok: false }, NotStarted: { key: "notStarted", ok: false },
  "1": { key: "inProgress", ok: false }, InProgress: { key: "inProgress", ok: false },
  "2": { key: "succeeded", ok: true }, Succeeded: { key: "succeeded", ok: true },
  "3": { key: "succeededWithErrors", ok: false }, SucceededWithErrors: { key: "succeededWithErrors", ok: false },
  "4": { key: "failed", ok: false }, Failed: { key: "failed", ok: false },
  "5": { key: "aborted", ok: false }, Aborted: { key: "aborted", ok: false },
};

// Copy to clipboard component
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-muted transition-colors ${className}`}
      title={copied ? t("nodeDetail.copy.copied") : t("nodeDetail.copy.title")}
    >
      {copied ? (
        <><Check className="h-3 w-3 text-green-500" /> {t("nodeDetail.copy.copied")}</>
      ) : (
        <><Copy className="h-3 w-3" /> {t("nodeDetail.copy.copy")}</>
      )}
    </button>
  );
}

/** Dates from the agent: ISO strings, or "/Date(1731234567000)/" from Windows PowerShell's ConvertTo-Json. */
function agentDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const ms = /\/Date\((-?\d+)\)\//.exec(value);
  const date = ms ? new Date(Number(ms[1])) : new Date(value);
  return Number.isNaN(date.getTime()) || date.getFullYear() < 2000 ? null : date;
}

/** Firewall profiles: the agent sends a list of {name, enabled}; older data a map name -> {enabled}. */
function firewallProfiles(profiles: unknown): [string, { enabled?: boolean }][] {
  if (Array.isArray(profiles)) return profiles.map((p: any) => [String(p?.name ?? "?"), p]);
  return Object.entries((profiles as Record<string, { enabled?: boolean }>) || {});
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs max-w-[60%] truncate" title={value}>{value}</span>
    </div>
  );
}

function getStatusBadge(lastSeen: string, t: Translate) {
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const diffMinutes = (now.getTime() - lastSeenDate.getTime()) / 1000 / 60;
  
  if (diffMinutes < 5) {
    return <Badge className="bg-green-600 text-white">{t("common.online")}</Badge>;
  } else if (diffMinutes < 60) {
    return <Badge className="bg-yellow-600 text-white">{t("nodeDetail.away")}</Badge>;
  } else {
    return <Badge variant="secondary">{t("common.offline")}</Badge>;
  }
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  return formatDateTimeIntl(date, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Move to Group dropdown button
function MoveToGroupButton({ nodeId, onMoved }: { nodeId: string; onMoved?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && groups.length === 0) {
      setLoading(true);
      apiClient.get<any>("/groups")
        .then((data) => setGroups(Array.isArray(data) ? data : data?.groups || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const moveToGroup = async (groupId: string) => {
    try {
      await apiClient.post(`/groups/${groupId}/members`, { node_ids: [nodeId] });
      setOpen(false);
      onMoved?.();
    } catch {}
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        className="bg-indigo-500/10 border-indigo-500 text-indigo-500 hover:bg-indigo-500/20"
        onClick={() => setOpen(!open)}
      >
        <FolderTree className="h-4 w-4 mr-1" /> {t("nodeDetail.moveToGroup")}
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-md border bg-popover p-1 shadow-md">
          {loading ? (
            <p className="text-sm text-muted-foreground p-2">{t("common.loading")}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">{t("nodeDetail.noGroups")}</p>
          ) : (
            groups.map((g: any) => (
              <button
                key={g.id}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent flex items-center gap-2"
                onClick={() => moveToGroup(g.id)}
              >
                {g.icon && <span>{g.icon}</span>}
                {g.color && <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: g.color }} />}
                {g.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Quick Links card - cross-module deep links
function QuickLinksBar({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const [links, setLinks] = useState<{ label: string; count: number; href: string; icon: React.ReactNode }[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      const results: typeof links = [];

      const fetchers = [
        apiClient.get<any>(`/patches/compliance?node_id=${nodeId}`)
          .then((d) => {
            const count = d?.pending ?? d?.pendingCount ?? (Array.isArray(d) ? d.length : 0);
            if (count > 0) results.push({ label: t("nodeDetail.links.patches"), count, href: `/patches?node=${nodeId}`, icon: <ShieldAlert className="h-4 w-4" /> });
          }).catch(() => {}),
        apiClient.get<{ count?: number }>(`/vulnerabilities/node/${encodeURIComponent(nodeId)}?limit=1`, { showErrorToast: false })
          .then((d) => {
            const count = d?.count ?? 0;
            if (count > 0) results.push({ label: t("nodeDetail.links.vulnerabilities"), count, href: nodeVulnerabilitiesHref(nodeId), icon: <Bug className="h-4 w-4" /> });
          }).catch(() => {}),
        apiClient.get<any>(`/jobs?target_id=${nodeId}&limit=5`)
          .then((d) => {
            const count = Array.isArray(d) ? d.length : d?.jobs?.length ?? d?.total ?? 0;
            if (count > 0) results.push({ label: t("nodeDetail.links.jobs"), count, href: `/jobs?node=${nodeId}`, icon: <Briefcase className="h-4 w-4" /> });
          }).catch(() => {}),
        apiClient.get<any>("/alert-rules")
          .then((d) => {
            const arr = Array.isArray(d) ? d : d?.rules || [];
            const count = arr.filter((r: any) => r.node_id === nodeId || r.nodeId === nodeId || r.target === nodeId).length;
            if (count > 0) results.push({ label: t("nodeDetail.links.alerts"), count, href: `/alerts?node=${nodeId}`, icon: <Bell className="h-4 w-4" /> });
          }).catch(() => {}),
      ];

      await Promise.allSettled(fetchers);
      setLinks(results);
    };
    fetchAll();
  }, [nodeId]);

  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {links.map((link) => (
        <Link key={link.label} href={link.href}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-accent transition-colors cursor-pointer">
            {link.icon}
            <span className="text-sm font-medium">{link.label}</span>
            <Badge variant="secondary" className="ml-1">{link.count}</Badge>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </div>
        </Link>
      ))}
    </div>
  );
}

const NODE_TABS = ["overview", "performance", "hardware", "software", "updates", "network", "security",
  "vulnerabilities", "browser", "events", "history", "monitoring", "linux"] as const;

export default function NodeDetailPage() {
  const params = useParams();
  const nodeId = params.nodeId as string;
  const { hasPermission } = useAuth();
  const { t } = useI18n();
  
  const { loading, node, history, hardware, software, hotfixes, system, security, network, browser, criticalCookies, events, eventsLoading, refreshing, linuxData, linuxUpdates, hwData, sysData, secData, netData, browserData, ramData, gpuList, nicsList, totalUpdatesCount, refreshInventory, fetchNodeDetails } = useNodeDetails(nodeId);
  // "Recently opened" and the breadcrumb show the hostname instead of the id
  const { nameRecent } = useRecentlyOpened();
  useEffect(() => {
    if (node?.hostname) nameRecent(`/nodes/${nodeId}`, node.hostname);
  }, [node?.hostname, nodeId, nameRecent]);
  // The open tab is kept in ?tab=… (reload, links such as a node's vulnerabilities)
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useTabParam("overview", NODE_TABS);
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab) setActiveTab(tab);
  }, [searchParams]);
  const vulnerabilityCount = useNodeVulnerabilityCount(nodeId);
  // Linux packages have no publisher or install date: only show columns some entry fills
  const showPublisher = software.some((sw: any) => sw.publisher);
  const showInstallDate = software.some((sw: any) => sw.installDate);

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground">{t("nodeDetail.loadingData")}</p>
        </div>
      </main>
    );
  }

  if (!node && !hardware) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            {t("nodeDetail.backToDashboard")}
          </Link>
          <Card className="mt-8 p-12 text-center">
            <CardContent>
              <p className="text-xl text-muted-foreground">{t("nodeDetail.notFound")}</p>
              <p className="text-sm text-muted-foreground mt-2">ID: {nodeId}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }


  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
{/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
              <h1 className="text-3xl font-bold min-w-0 wrap-break-word">{node?.hostname || nodeId}</h1>
              {node && <FavoriteButton type="node" id={nodeId} label={node.hostname || nodeId} href={`/nodes/${nodeId}`} />}
              {node && (node.removalState === "uninstalled"
                // The last report is recent right after an uninstall, but the agent is gone
                ? <Badge variant="secondary">{t("nodes.removal.badgeUninstalled")}</Badge>
                : getStatusBadge(node.last_seen, t))}
            </div>
            {/* Groups and Tags */}
            {node && (node.groups?.length > 0 || node.tags?.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-2">
                {node.groups?.map(group => (
                  <Badge key={group.id} style={{ backgroundColor: group.color, color: 'white' }}>
                    {group.icon && `${group.icon} `}{group.name}
                  </Badge>
                ))}
                {node.tags?.map(tag => (
                  <Badge key={tag.id} variant="outline" style={{ borderColor: tag.color, color: tag.color }}>
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {node && (
              <ManageTagsDialog 
                nodeId={node.id} 
                nodeTags={node.tags} 
                onTagsChanged={fetchNodeDetails} 
              />
            )}
            <Link href={`/nodes/${nodeId}/terminal`}>
              <Button variant="outline" className="bg-green-500/10 border-green-500 text-green-500 hover:bg-green-500/20">
                &gt;_ Terminal{/* i18n-ignore */}
              </Button>
            </Link>
            <Link href={`/nodes/${nodeId}/screen`}>
              <Button variant="outline" className="bg-purple-500/10 border-purple-500 text-purple-500 hover:bg-purple-500/20">
                🖥️ {t("nodeDetail.screen")}
              </Button>
            </Link>
            <Link href={`/nodes/${nodeId}/shell`}>
              <Button variant="outline" className="bg-orange-500/10 border-orange-500 text-orange-500 hover:bg-orange-500/20">
                🐚 Shell{/* i18n-ignore */}
              </Button>
            </Link>
            <Button 
              variant="outline" 
              onClick={refreshInventory}
              disabled={refreshing}
            >
              {refreshing ? `⏳ ${t("common.loading")}` : `📊 ${t("nodeDetail.collectInventory")}`}
            </Button>
            <Link href={`/jobs?target=${nodeId}`}>
              <Button variant="outline" className="bg-blue-500/10 border-blue-500 text-blue-500 hover:bg-blue-500/20">
                <Zap className="h-4 w-4 mr-1" /> {t("nodeDetail.startJob")}
              </Button>
            </Link>
            <MoveToGroupButton nodeId={nodeId} onMoved={fetchNodeDetails} />
            <Link href={`/reports?node=${nodeId}`}>
              <Button variant="outline" className="bg-slate-500/10 border-slate-500 text-slate-400 hover:bg-slate-500/20">
                <FileText className="h-4 w-4 mr-1" /> {t("nodeDetail.generateReport")}
              </Button>
            </Link>
            {node && hasPermission("nodes:delete") && !node.removalState && (
              <RemoveNodeButton nodeId={nodeId} hostname={node.hostname || nodeId} removal={node} onChanged={fetchNodeDetails} />
            )}
          </div>
        </div>

        {node && (
          <NodeRemovalBanner nodeId={nodeId} hostname={node.hostname || nodeId} removal={node} onChanged={fetchNodeDetails} />
        )}

        {/* Quick Links - Cross-Module Deep Links */}
        <QuickLinksBar nodeId={nodeId} />

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="overview">{t("nodeDetail.tabs.overview")}</TabsTrigger>
            <TabsTrigger value="performance">📊 {t("nodeDetail.tabs.performance")}</TabsTrigger>
            <TabsTrigger value="hardware">{t("nodes.hardware")}</TabsTrigger>
            <TabsTrigger value="software">{t("nodes.software")} ({software.length})</TabsTrigger>
            <TabsTrigger value="updates">{t("nodeDetail.tabs.updates")} ({totalUpdatesCount})</TabsTrigger>
            <TabsTrigger value="network">{t("nodes.network")}</TabsTrigger>
            <TabsTrigger value="security">{t("nodes.security")}</TabsTrigger>
            <TabsTrigger value="vulnerabilities">{t("nodes.vulnerabilities.tab", { count: vulnerabilityCount ?? "…" })}</TabsTrigger>
            <TabsTrigger value="browser">{t("nodeDetail.tabs.browser")}</TabsTrigger>
            <TabsTrigger value="events">{t("nodes.events")} ({events.length})</TabsTrigger>
            <TabsTrigger value="history">{t("nodeDetail.tabs.timeline")}</TabsTrigger>
            <TabsTrigger value="monitoring">🛡️ {t("nodeDetail.tabs.monitoring")}</TabsTrigger>
            {linuxData && <TabsTrigger value="linux">🐧 Linux</TabsTrigger>}{/* i18n-ignore */}
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t("nodes.os")}</CardDescription>
                  <CardTitle className="text-lg">{sysData.osName || node?.os_name || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{sysData.osVersion || node?.os_version}</p>
                  {(sysData.osBuild || node?.os_build) && (
                    <p className="text-sm text-muted-foreground font-mono">
                      {/windows/i.test(sysData.osName || node?.os_name || "")
                        ? t("nodes.osBuild", { build: sysData.osBuild || node?.os_build || "" })
                        : t("nodes.kernel", { kernel: sysData.osBuild || node?.os_build || "" })}
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>CPU</CardDescription>{/* i18n-ignore */}
                  <CardTitle className="text-lg truncate">{hwData.cpu?.name || node?.cpuName || '-'}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{t("nodeDetail.coresThreads", { cores: hwData.cpu?.cores || '-', threads: hwData.cpu?.logicalProcessors || '-' })}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>RAM</CardDescription>{/* i18n-ignore */}
                  <CardTitle className="text-lg">{ramData.totalGB?.toFixed(1) || node?.totalMemoryGb?.toFixed(1) || '-'} GB</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {hwData.virtualization?.isVirtual
                      ? t("nodeDetail.virtualMachine")
                      : t("nodeDetail.modules", { count: ramData.modules?.length || 0 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t("nodeDetail.gpu")}</CardDescription>
                  <CardTitle className="text-lg truncate">{String(gpuList[0]?.name || '-')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {hwNumber(gpuList[0]?.videoMemoryGB) && (
                    <p className="text-sm text-muted-foreground">{String(gpuList[0]?.videoMemoryGB)} GB VRAM</p>/* i18n-ignore */
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>{t("nodeDetail.systemInfo")}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label={t("nodeDetail.mainboard")} value={hwData.mainboard?.product ? `${hwData.mainboard.manufacturer} ${hwData.mainboard.product}` : null} />
                  {/* Windows reports the BIOS version as smbiosVersion (WMI SMBIOSBIOSVersion); the Linux agent puts the SMBIOS spec version there and the BIOS version in version */}
                  <InfoRow label={t("nodeDetail.biosVersion")} value={(linuxData ? hwData.bios?.version : hwData.bios?.smbiosVersion) || hwData.bios?.name} />
                  <InfoRow label={t("nodeDetail.biosDate")} value={hwData.bios?.releaseDate} />
                  <InfoRow label="System UUID" value={hwData.bios?.uuid} />{/* i18n-ignore */}
                  {sysData.uptimeFormatted && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">⏱️ {t("nodes.uptime")}</span>
                      <span className="font-mono">{sysData.uptimeFormatted}</span>
                    </div>
                  )}
                  {hwData.bios?.isUefi !== undefined && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("nodeDetail.bootMode")}</span>
                      <Badge variant={hwData.bios?.isUefi ? "default" : "secondary"}>
                        {hwData.bios?.isUefi ? "UEFI" : "Legacy BIOS" /* i18n-ignore */}
                      </Badge>
                    </div>
                  )}
                  {hwData.bios?.secureBootState && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Secure Boot</span>{/* i18n-ignore */}
                      <Badge variant={hwData.bios?.secureBootState === "Enabled" ? "default" : "secondary"}>
                        {hwData.bios?.secureBootState}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader><CardTitle>{t("nodeDetail.virtualizationDomain")}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {hwData.virtualization ? (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("nodeDetail.type")}</span>
                        <Badge variant={hwData.virtualization.isVirtual ? "secondary" : "default"}>
                          {hwData.virtualization.hypervisor || (hwData.virtualization.isVirtual ? t("nodeDetail.virtual") : t("nodeDetail.physical"))}
                        </Badge>
                      </div>
                      <InfoRow label={t("nodeDetail.manufacturer")} value={hwData.virtualization.manufacturer} />
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t("nodeDetail.noData")}</div>
                  )}
                  <InfoRow label={t("nodeDetail.computerName")} value={sysData.computerName || node?.hostname} />
                  <InfoRow label={t("nodeDetail.domain")} value={sysData.domain} />
                  <InfoRow label={t("nodeDetail.workgroup")} value={sysData.workgroup} />
                  <InfoRow label={t("nodeDetail.domainRole")} value={sysData.domainRole} />
                </CardContent>
              </Card>
            </div>

            {/* Timestamps & IDs */}
            {node && (
              <Card>
                <CardHeader><CardTitle>📅 {t("nodeDetail.timestamps")}</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-5">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("nodeDetail.nodeId")}</p>
                    <div className="flex items-center gap-2">
                      <p className="font-medium font-mono text-xs truncate max-w-[120px]" title={node.node_id}>{node.node_id}</p>
                      <CopyButton text={node.node_id} />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("nodeDetail.firstSeen")}</p>
                    <p className="font-medium">{formatDateTime(node.first_seen)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("nodes.lastSeen")}</p>
                    <p className="font-medium">{formatDateTime(node.last_seen)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("nodeDetail.changesRecorded")}</p>
                    <p className="font-medium">{history.length}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("nodeDetail.agentVersion")}</p>
                    <p className="font-medium font-mono">{node.agent_version || '-'}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance">
            {node && <PerformanceTab nodeId={node.node_id} />}
          </TabsContent>

          {/* Hardware Tab */}
          <TabsContent value="hardware" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* CPU */}
              <Card>
                <CardHeader><CardTitle>🔲 {t("nodeDetail.processor")}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <InfoRow label={t("common.name")} value={hwData.cpu?.name} />
                  <InfoRow label={t("nodeDetail.cores")} value={hwData.cpu?.cores?.toString()} />
                  <InfoRow label={t("nodeDetail.threads")} value={hwData.cpu?.logicalProcessors?.toString()} />
                  <InfoRow label={t("nodeDetail.maxClock")} value={hwData.cpu?.maxClockSpeedMHz ? `${hwData.cpu.maxClockSpeedMHz} MHz` : null} />
                  <InfoRow label="L2 Cache" value={hwData.cpu?.l2CacheKB ? `${(hwData.cpu.l2CacheKB / 1024).toFixed(0)} MB` : null} />{/* i18n-ignore */}
                  <InfoRow label="L3 Cache" value={hwData.cpu?.l3CacheKB ? `${(hwData.cpu.l3CacheKB / 1024).toFixed(0)} MB` : null} />{/* i18n-ignore */}
                  <InfoRow label={t("nodeDetail.architecture")} value={hwData.cpu?.architecture} />
                  <InfoRow label="Socket" value={hwText(hwData.cpu?.socketDesignation)} />{/* i18n-ignore */}
                </CardContent>
              </Card>

              {/* RAM */}
              <Card>
                <CardHeader><CardTitle>💾 {t("nodes.memory")}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold mb-4">{t("nodeDetail.totalGb", { value: ramData.totalGB?.toFixed(0) || '-' })}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("nodeDetail.slot")}</TableHead>
                        <TableHead>{t("nodeDetail.size")}</TableHead>
                        <TableHead>{t("nodeDetail.type")}</TableHead>
                        <TableHead>{t("nodeDetail.speed")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ramData.modules?.map((mod: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>{mod.deviceLocator || mod.bankLabel}</TableCell>
                          <TableCell>{mod.capacityGB} GB</TableCell>
                          <TableCell>{hwText(mod.memoryType) ?? "-"}</TableCell>
                          <TableCell>{hwNumber(mod.speedMHz) ? `${mod.speedMHz} MHz` : "-"}</TableCell>{/* i18n-ignore */}
                        </TableRow>
                      )) || (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground">{t("nodeDetail.noData")}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* GPU */}
              <Card>
                <CardHeader><CardTitle>🎮 {t("nodeDetail.gpus")}</CardTitle></CardHeader>
                <CardContent>
                  {gpuList.length === 0 ? (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  ) : (
                    <div className="space-y-4">
                      {gpuList.map((gpu: any, i: number) => (
                        <div key={i} className="p-3 border rounded-lg">
                          <p className="font-medium">{gpu.name}</p>
                          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                            <InfoRow label="VRAM" value={gpu.videoMemoryGB ? `${gpu.videoMemoryGB} GB` : null} />{/* i18n-ignore */}
                            <InfoRow label={t("nodeDetail.driver")} value={gpu.driverVersion} />
                            <InfoRow label={t("nodeDetail.resolution")} value={gpu.currentResolution} />
                            <InfoRow label={t("nodeDetail.refreshRate")} value={hwNumber(gpu.refreshRate, 1) ? `${gpu.refreshRate} Hz` : null} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Disks */}
              <Card>
                <CardHeader><CardTitle>💿 {t("nodeDetail.disks")}</CardTitle></CardHeader>
                <CardContent>
                  {hwData.disks?.physical?.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("nodeDetail.model")}</TableHead>
                          <TableHead>{t("nodeDetail.size")}</TableHead>
                          <TableHead>{t("nodeDetail.type")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hwData.disks?.physical?.map((disk: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="truncate max-w-[200px]">{disk.model}</TableCell>
                            <TableCell>{disk.sizeGB?.toFixed(0)} GB</TableCell>
                            <TableCell>{disk.interfaceType}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                  
                  {hwData.disks?.volumes?.length > 0 && (
                    <>
                      <p className="font-medium mt-4 mb-2">{t("nodeDetail.volumes")}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("nodeDetail.drive")}</TableHead>
                            <TableHead>{t("nodeDetail.free")}</TableHead>
                            <TableHead>{t("nodeDetail.total")}</TableHead>
                            <TableHead>{t("nodeDetail.used")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hwData.disks?.volumes?.filter((v: any) => v.sizeGB > 0).map((vol: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell>{vol.driveLetter} {vol.volumeName && `(${vol.volumeName})`}</TableCell>
                              <TableCell>{vol.freeGB?.toFixed(0)} GB</TableCell>
                              <TableCell>{vol.sizeGB?.toFixed(0)} GB</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full ${vol.usedPercent > 90 ? 'bg-red-500' : vol.usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                      style={{ width: `${vol.usedPercent}%` }}
                                    />
                                  </div>
                                  <span className="text-xs">{vol.usedPercent?.toFixed(0)}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Software Tab */}
          <TabsContent value="software">
            <Card>
              <CardHeader>
                <CardTitle>{t("nodeDetail.installedSoftware", { count: software.length })}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("common.name")}</TableHead>
                      <TableHead>{t("nodeDetail.version")}</TableHead>
                      {showPublisher && <TableHead>{t("nodeDetail.publisher")}</TableHead>}
                      {showInstallDate && <TableHead>{t("nodeDetail.installedOn")}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {software.slice(0, 100).map((sw: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="truncate max-w-[300px]">
                          {sw.id ? (
                            <Link href={`/packages/${sw.id}`} className="text-blue-500 hover:underline">{sw.name}</Link>
                          ) : sw.name}
                        </TableCell>
                        <TableCell>{sw.version || '-'}</TableCell>
                        {showPublisher && <TableCell className="truncate max-w-[200px]">{sw.publisher || '-'}</TableCell>}
                        {showInstallDate && <TableCell>{formatLocalDate(sw.installDate)}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {software.length > 100 && (
                  <p className="text-sm text-muted-foreground mt-2">{t("nodeDetail.showingFirst", { count: software.length })}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Updates Tab */}
          <TabsContent value="updates" className="space-y-4">
            {linuxUpdates ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("nodes.updates.packageUpdates", { count: totalUpdatesCount })}</CardTitle>
                <CardDescription>
                  {t("nodes.updates.summary", { manager: linuxUpdates.packageManager ?? "", security: linuxUpdates.securityUpdates || 0 })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(linuxUpdates.updates?.length || 0) > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("nodes.updates.package")}</TableHead>
                        <TableHead>{t("nodes.updates.newVersion")}</TableHead>
                        <TableHead>{t("nodes.updates.source")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linuxUpdates.updates?.map((pkg, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">
                            {pkg.name} {pkg.security && <Badge variant="destructive" className="ml-2">{t("nodes.updates.securityBadge")}</Badge>}
                          </TableCell>
                          <TableCell className="font-mono">{pkg.newVersion}</TableCell>
                          <TableCell className="text-muted-foreground">{pkg.repository || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground">{t("nodes.updates.none")}</p>
                )}
              </CardContent>
            </Card>
            ) : (
            <Card>
              <CardHeader><CardTitle>{t("nodeDetail.windowsUpdates", { count: totalUpdatesCount })}</CardTitle></CardHeader>
              <CardContent>
                {hotfixes.hotfixes.length > 0 && (
                  <>
                    <p className="font-medium mb-2">{t("nodeDetail.hotfixes", { count: hotfixes.hotfixes.length })}</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>KB</TableHead>
                          <TableHead>{t("common.description")}</TableHead>
                          <TableHead>{t("nodeDetail.installedOn")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hotfixes.hotfixes?.slice(0, 20).map((hf: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell><Badge variant="outline">{hf.hotfixId}</Badge></TableCell>
                            <TableCell>{hf.description || '-'}</TableCell>
                            <TableCell>{formatLocalDate(hf.installedOn)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
                
                {hotfixes.updateHistory.length > 0 && (
                  <>
                    <p className="font-medium mb-2 mt-6">{t("nodeDetail.updateHistory", { count: hotfixes.updateHistory.length })}</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>KB</TableHead>
                          <TableHead>{t("nodeDetail.title")}</TableHead>
                          <TableHead>{t("nodeDetail.date")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {hotfixes.updateHistory?.slice(0, 50).map((upd: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell><Badge variant="outline">{upd.kbId || upd.kb || '-'}</Badge></TableCell>
                            <TableCell className="truncate max-w-[300px]">{upd.title || '-'}</TableCell>
                            <TableCell>{formatDate(upd.installedOn ?? upd.installedDate)}</TableCell>
                            <TableCell>
                              {(() => {
                                const result = UPDATE_RESULTS[String(upd.resultCode ?? "")];
                                return (
                                  <Badge variant={result?.ok ? "default" : "secondary"}>
                                    {result ? t(`nodeDetail.updateResult.${result.key}`) : (upd.resultCode ?? "-")}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
            )}
          </TabsContent>

          {/* Network Tab */}
          <TabsContent value="network" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>{t("nodeDetail.networkAdapters")}</CardTitle></CardHeader>
              <CardContent>
                {(nicsList.adapters?.length ?? 0) > 0 ? (
                  <div className="space-y-4">
                    {nicsList.adapters?.map((nic: any, i: number) => {
                      const config = nicsList.configurations?.[nic.deviceId] || {};
                      return (
                        <div key={i} className="p-4 border rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium">{nic.name}</p>
                            <Badge variant={nic.connectionStatus === "Connected" ? "default" : "secondary"}>
                              {nic.connectionStatus}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <InfoRow label="MAC" value={nic.macAddress} />{/* i18n-ignore */}
                            <InfoRow label={t("nodeDetail.speed")} value={nic.speedMbps ? `${nic.speedMbps} Mbps` : null} />
                            <InfoRow label="IP" value={config.ipAddresses?.join(", ")} />
                            <InfoRow label={t("nodeDetail.gateway")} value={config.gateways?.join(", ")} />
                            <InfoRow label="DNS" value={config.dnsServers?.join(", ")} />{/* i18n-ignore */}
                            <InfoRow label="DHCP" value={config.dhcpEnabled ? t("common.yes") : t("common.no")} />{/* i18n-ignore */}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                )}
              </CardContent>
            </Card>

            {(netData.connections?.length ?? 0) > 0 && (
              <Card>
                <CardHeader><CardTitle>{t("nodeDetail.activeConnections", { count: netData.connections?.length ?? 0 })}</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("nodeDetail.local")}</TableHead>
                        <TableHead>{t("nodeDetail.remote")}</TableHead>
                        <TableHead>{t("common.status")}</TableHead>
                        <TableHead>{t("nodeDetail.process")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {netData.connections?.slice(0, 30).map((conn: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{conn.localAddress}:{conn.localPort}</TableCell>
                          <TableCell className="font-mono text-xs">{conn.remoteAddress}:{conn.remotePort}</TableCell>
                          <TableCell><Badge variant="outline">{conn.state}</Badge></TableCell>
                          <TableCell>{conn.processName || conn.owningProcess}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>🛡️ Microsoft Defender</CardTitle></CardHeader>{/* i18n-ignore */}
                <CardContent className="space-y-2">
                  {secData.defender?.available ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("nodeDetail.defender.realTime")}</span>
                        <Badge variant={secData.defender.realTimeProtectionEnabled ? "default" : "destructive"}>
                          {secData.defender.realTimeProtectionEnabled ? t("common.active") : t("common.inactive")}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("nodeDetail.defender.antivirus")}</span>
                        <Badge variant={secData.defender.antivirusEnabled ? "default" : "destructive"}>
                          {secData.defender.antivirusEnabled ? t("common.active") : t("common.inactive")}
                        </Badge>
                      </div>
                      <InfoRow label={t("nodeDetail.defender.signatureVersion")} value={secData.defender.signatureVersion} />
                      <InfoRow label={t("nodeDetail.defender.signatureUpdated")} value={formatDateTimeIntl(agentDate(secData.defender.signatureLastUpdated), undefined, "")} />
                      <InfoRow label={t("nodeDetail.defender.engineVersion")} value={secData.defender.engineVersion} />
                      <InfoRow label={t("nodeDetail.defender.lastQuickScan")} value={formatDateTimeIntl(agentDate(secData.defender.lastQuickScan), undefined, "")} />
                      <InfoRow label={t("nodeDetail.defender.lastFullScan")} value={formatDateTimeIntl(agentDate(secData.defender.lastFullScan), undefined, "")} />
                    </>
                  ) : secData.defender ? (
                    <p className="text-muted-foreground">{secData.defender.error || t("nodeDetail.defender.notAvailable")}</p>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                  {(secData.antivirusProducts?.length ?? 0) > 0 && (
                    <div className="pt-2 space-y-1">
                      {secData.antivirusProducts?.map((av: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span>{av.name}</span>
                          <Badge variant={av.enabled ? "default" : "secondary"}>{av.enabled ? t("common.active") : t("common.inactive")}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>🛡️ Windows Firewall</CardTitle></CardHeader>{/* i18n-ignore */}
                <CardContent>
                  {secData.firewall?.profiles ? (
                    <div className="space-y-2">
                      {firewallProfiles(secData.firewall?.profiles).map(([profile, data]) => (
                        <div key={profile} className="flex justify-between items-center">
                          <span>{profile}</span>
                          <Badge variant={data?.enabled ? "default" : "destructive"}>
                            {data?.enabled ? t("common.active") : t("common.inactive")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>🔐 TPM</CardTitle></CardHeader>{/* i18n-ignore */}
                <CardContent className="space-y-2">
                  {secData.tpm ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("common.status")}</span>
                        <Badge variant={(secData.tpm.present ?? secData.tpm.isPresent) ? "default" : "secondary"}>
                          {(secData.tpm.present ?? secData.tpm.isPresent) ? t("nodeDetail.present") : t("nodeDetail.notPresent")}
                        </Badge>
                      </div>
                      <InfoRow label={t("nodeDetail.version")} value={secData.tpm.specVersion ?? secData.tpm.manufacturerVersion} />
                      <InfoRow label={t("nodeDetail.manufacturer")} value={secData.tpm.manufacturer ?? secData.tpm.manufacturerId} />
                    </>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>🔒 BitLocker</CardTitle></CardHeader>{/* i18n-ignore */}
                <CardContent>
                  {secData.bitlocker?.volumes?.length > 0 ? (
                    <div className="space-y-2">
                      {secData.bitlocker?.volumes?.map((vol: any, i: number) => (
                        <div key={i} className="flex justify-between items-center">
                          <span>{vol.driveLetter ?? vol.mountPoint}</span>
                          <Badge variant={vol.protectionStatus === "On" ? "default" : "secondary"}>
                            {vol.protectionStatus}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : secData.bitlocker?.available === false ? (
                    <p className="text-muted-foreground">{secData.bitlocker.reason || t("nodeDetail.noData")}</p>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>👤 UAC</CardTitle></CardHeader>{/* i18n-ignore */}
                <CardContent className="space-y-2">
                  {secData.uac ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("nodeDetail.enabled")}</span>
                        <Badge variant={secData.uac.enabled ? "default" : "destructive"}>
                          {secData.uac.enabled ? t("common.yes") : t("common.no")}
                        </Badge>
                      </div>
                      <InfoRow label={t("nodeDetail.consentPrompt")} value={(secData.uac.consentPromptBehaviorAdmin ?? secData.uac.consentPromptBehavior)?.toString()} />
                    </>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Local Admins - E1-07 */}
            {secData.localAdmins && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    👑 {t("nodeDetail.localAdmins")}
                    <Badge variant="outline">{secData.localAdmins.count || secData.localAdmins.members?.length || 0}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {secData.localAdmins.members?.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("common.name")}</TableHead>
                          <TableHead>{t("nodeDetail.domain")}</TableHead>
                          <TableHead>{t("nodeDetail.type")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {secData.localAdmins?.members?.map((admin: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{admin.name}</TableCell>
                            <TableCell className="text-muted-foreground">{admin.domain || '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{admin.accountType || t("nodeDetail.userAccount")}</Badge>
                            </TableCell>
                            <TableCell>
                              {admin.isBuiltIn && (
                                <Badge variant="secondary">{t("nodeDetail.builtIn")}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : secData.localAdmins.error ? (
                    <p className="text-sm text-destructive">{secData.localAdmins.error}</p>
                  ) : (
                    <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Deep Links to Security modules */}
            <div className="flex flex-wrap gap-3 mt-2">
              <Link href={`/security/findings?node=${nodeId}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <ShieldAlert className="h-4 w-4" /> {t("nodeDetail.showAllFindings")} <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setActiveTab("vulnerabilities")}>
                <Bug className="h-4 w-4" /> {t("nodes.vulnerabilities.showInTab")}
              </Button>
            </div>
          </TabsContent>

          {/* Browser Tab */}
          <TabsContent value="vulnerabilities">
            <NodeVulnerabilities nodeId={nodeId} />
          </TabsContent>

          <TabsContent value="browser" className="space-y-4">
            {/* Security Warnings */}
            {criticalCookies && criticalCookies.warnings?.length > 0 && (
              <Card className="border-yellow-500 bg-yellow-500/10">
                <CardHeader>
                  <CardTitle className="text-yellow-600 dark:text-yellow-400">⚠️ {t("nodeDetail.securityNotices")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {criticalCookies.warnings?.map((warning, i) => (
                      <li key={i} className="text-sm">{warning}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Critical Cookies Summary */}
            {criticalCookies && criticalCookies.count > 0 && (
              <Card className="border-red-500/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    🔐 {t("nodeDetail.criticalCookies")} <Badge variant="destructive">{criticalCookies.count}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {t("nodeDetail.criticalCookiesHint")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Category Summary */}
                  <div className="grid gap-4 md:grid-cols-3 mb-6">
                    {Object.entries(criticalCookies?.summary || {}).map(([category, data]) => (
                      <div key={category} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{category}</span>
                          <Badge variant="outline">{data.count}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {data.domains.slice(0, 5).map(domain => (
                            <Badge key={domain} variant="secondary" className="text-xs">
                              {domain}
                            </Badge>
                          ))}
                          {data.domains?.length > 5 && (
                            <Badge variant="secondary" className="text-xs">+{data.domains?.length - 5}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Critical Cookies Table */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("nodeDetail.domain")}</TableHead>
                        <TableHead>Cookie</TableHead>{/* i18n-ignore */}
                        <TableHead>{t("nodeDetail.category")}</TableHead>
                        <TableHead>{t("nodeDetail.tabs.browser")}</TableHead>
                        <TableHead>Flags</TableHead>{/* i18n-ignore */}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {criticalCookies.criticalCookies?.slice(0, 20).map((cookie, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{cookie.domain}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate" title={cookie.name}>
                            {cookie.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{cookie.category}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{cookie.browser}</TableCell>
                          <TableCell className="space-x-1">
                            {cookie.isSecure ? (
                              <Badge className="bg-green-600 text-xs">Secure{/* i18n-ignore */}</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">!Secure{/* i18n-ignore */}</Badge>
                            )}
                            {cookie.isHttpOnly ? (
                              <Badge className="bg-green-600 text-xs">HttpOnly{/* i18n-ignore */}</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">!HttpOnly{/* i18n-ignore */}</Badge>
                            )}
                            {cookie.isSession && (
                              <Badge variant="secondary" className="text-xs">Session{/* i18n-ignore */}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {criticalCookies.criticalCookies?.length > 20 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("nodeDetail.moreCriticalCookies", { count: (criticalCookies.criticalCookies?.length ?? 0) - 20 })}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Browser Stats per User */}
            {browserData.users && Object.keys(browserData?.users || {}).length > 0 ? (
              Object.entries(browserData?.users || {}).map(([username, browsers]: [string, any]) => (
                <Card key={username}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      👤 {username}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(browsers || {}).map(([browserName, data]: [string, any]) => {
                        const icon = browserName === 'Chrome' ? '🌐' : browserName === 'Edge' ? '📘' : '🦊';
                        const profile = data.profiles?.[0];
                        const cookiesCount = profile?.cookiesCount || 0;
                        return (
                          <div key={browserName} className="p-4 border rounded-lg">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-2xl">{icon}</span>
                              <span className="font-medium">{browserName}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div className="flex items-center gap-1">
                                <span>📜</span>
                                <span className="text-muted-foreground">{t("nodeDetail.history")}</span>
                              </div>
                              <span className="font-mono text-right">{(profile?.historyCount || 0).toLocaleString()}</span>
                              
                              <div className="flex items-center gap-1">
                                <span>🔖</span>
                                <span className="text-muted-foreground">{t("nodeDetail.bookmarks")}</span>
                              </div>
                              <span className="font-mono text-right">{(profile?.bookmarkCount || 0).toLocaleString()}</span>
                              
                              <div className="flex items-center gap-1">
                                <span>🍪</span>
                                <span className="text-muted-foreground">Cookies</span>{/* i18n-ignore */}
                              </div>
                              <span className="font-mono text-right">
                                {cookiesCount === -1 ? (
                                  <Badge variant="destructive" className="text-xs">{t("nodeDetail.locked")}</Badge>
                                ) : (
                                  cookiesCount.toLocaleString()
                                )}
                              </span>
                              
                              <div className="flex items-center gap-1">
                                <span>🧩</span>
                                <span className="text-muted-foreground">{t("nodeDetail.extensions")}</span>
                              </div>
                              <span className="font-mono text-right">{data.extensionCount || 0}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : Object.keys(browserData || {}).length > 0 && !browserData.users ? (
              // Legacy format fallback
              <Card>
                <CardHeader><CardTitle>{t("nodeDetail.browserData")}</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{t("nodeDetail.legacyFormat")}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <p>{t("nodeDetail.noBrowserData")}</p>
                  <p className="text-sm mt-2">{t("nodeDetail.browserDataHint")}</p>
                </CardContent>
              </Card>
            )}

            {/* Cookies Summary by Domain */}
            {browserData.cookies && Object.keys(browserData.cookies).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>🍪 {t("nodeDetail.cookiesByDomain")}</CardTitle>
                  <CardDescription>{t("nodeDetail.topDomains")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {Object.entries(browserData?.cookies || {}).map(([username, cookieList]: [string, any]) => (
                    <div key={username} className="mb-6">
                      <p className="font-medium mb-2">👤 {username}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("nodeDetail.tabs.browser")}</TableHead>
                            <TableHead>{t("nodeDetail.profile")}</TableHead>
                            <TableHead>{t("nodeDetail.domain")}</TableHead>
                            <TableHead className="text-right">{t("nodeDetail.count")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Array.isArray(cookieList) && cookieList.slice(0, 15).map((cookie: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell>{cookie.browser}</TableCell>
                              <TableCell>{cookie.profile}</TableCell>
                              <TableCell className="font-mono text-xs">{cookie.domain}</TableCell>
                              <TableCell className="text-right font-mono">{cookie.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {Array.isArray(cookieList) && cookieList.length > 15 && (
                        <p className="text-sm text-muted-foreground mt-2">
                          {t("nodeDetail.moreDomains", { count: cookieList.length - 15 })}
                        </p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Events Tab */}
          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>📋 {t("nodeDetail.eventlog")}</CardTitle>
                <CardDescription>{t("nodeDetail.eventlogDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                {events.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>{t("nodeDetail.noEvents")}</p>
                    <p className="text-sm mt-2">{t("nodeDetail.noEventsHint")}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-red-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-red-400">
                          {events.filter(e => e.level <= 2).length}
                        </div>
                        <div className="text-xs text-muted-foreground">{t("nodeDetail.criticalError")}</div>
                      </div>
                      <div className="bg-yellow-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-yellow-400">
                          {events.filter(e => e.level === 3).length}
                        </div>
                        <div className="text-xs text-muted-foreground">{t("nodeDetail.warnings")}</div>
                      </div>
                      <div className="bg-blue-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-blue-400">
                          {events.filter(e => e.logName === 'Security').length}
                        </div>
                        <div className="text-xs text-muted-foreground">{t("nodes.security")}</div>
                      </div>
                      <div className="bg-zinc-500/10 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-zinc-400">
                          {events.length}
                        </div>
                        <div className="text-xs text-muted-foreground">{t("nodeDetail.total")}</div>
                      </div>
                    </div>
                    
                    {/* Events Table */}
                    <div className="max-h-[500px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">{t("nodeDetail.time")}</TableHead>
                            <TableHead className="w-[80px]">{t("nodeDetail.level")}</TableHead>
                            <TableHead className="w-[80px]">Log</TableHead>{/* i18n-ignore */}
                            <TableHead className="w-[80px]">{t("nodeDetail.eventId")}</TableHead>
                            <TableHead>{t("nodeDetail.source")}</TableHead>
                            <TableHead>{t("nodeDetail.message")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {events.slice(0, 100).map((event) => (
                            <TableRow key={event.id}>
                              <TableCell className="text-xs font-mono">
                                {formatDateTimeIntl(event.eventTime, {
                                  month: '2-digit', day: '2-digit',
                                  hour: '2-digit', minute: '2-digit'
                                })}
                              </TableCell>
                              <TableCell>
                                <Badge className={
                                  event.level <= 1 ? 'bg-red-600' :
                                  event.level === 2 ? 'bg-red-500' :
                                  event.level === 3 ? 'bg-yellow-500' :
                                  'bg-zinc-600'
                                }>
                                  {event.levelName || `L${event.level}`}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{event.logName}</TableCell>
                              <TableCell>
                                <code className="text-xs bg-zinc-800 px-1 rounded">{event.eventId}</code>
                              </TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate" title={event.source}>
                                {event.source}
                              </TableCell>
                              <TableCell className="text-xs max-w-[300px] truncate" title={event.message}>
                                {event.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Linux Data Tab */}
          {linuxData && (
            <TabsContent value="linux" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* Load Average Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Load Average</CardDescription>{/* i18n-ignore */}
                    <CardTitle className="text-lg">
                      {linuxData.performance?.loadAverage?.load1?.toFixed(2) || '-'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      5m: {linuxData.performance?.loadAverage?.load5?.toFixed(2)} / 15m: {linuxData.performance?.loadAverage?.load15?.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>

                {/* Services Summary Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>{t("nodeDetail.services")}</CardDescription>
                    <CardTitle className="text-lg text-green-600">
                      {t("nodeDetail.activeCount", { count: linuxData.services?.summary?.active || 0 })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {t("nodeDetail.failedOfTotal", { failed: linuxData.services?.summary?.failed || 0, total: linuxData.services?.summary?.total || 0 })}
                    </p>
                  </CardContent>
                </Card>

                {/* Updates Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>{t("nodeDetail.updatesAvailable")}</CardDescription>
                    <CardTitle className="text-lg">
                      {linuxData.updates?.totalUpdates || 0}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {t("nodeDetail.securityVia", { count: linuxData.updates?.securityUpdates || 0, manager: linuxData.updates?.packageManager ?? "-" })}
                    </p>
                  </CardContent>
                </Card>

                {/* Swap Usage Card */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Swap</CardDescription>{/* i18n-ignore */}
                    <CardTitle className="text-lg">
                      {linuxData.performance?.swap?.usedBytes 
                        ? ((linuxData.performance.swap.usedBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB')
                        : '0 GB'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {t("nodeDetail.of")} {linuxData.performance?.swap?.totalBytes 
                        ? ((linuxData.performance.swap.totalBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB')
                        : '0 GB'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* CPU Cores */}
                <Card>
                  <CardHeader><CardTitle>🔲 {t("nodeDetail.cpuCores")}</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-2">
                      {linuxData.performance?.cpuCores?.slice(0, 32).map((core) => (
                        <div key={core.core} className="text-center p-2 border rounded">
                          <p className="text-xs text-muted-foreground">{t("nodeDetail.core", { number: core.core })}</p>
                          <p className={`font-bold ${core.usagePercent > 80 ? 'text-red-500' : core.usagePercent > 50 ? 'text-yellow-500' : 'text-green-500'}`}>
                            {core.usagePercent?.toFixed(0)}%
                          </p>
                        </div>
                      )) || <p className="col-span-4 text-muted-foreground">{t("nodeDetail.noData")}</p>}
                    </div>
                    {(linuxData.performance?.cpuCores?.length || 0) > 32 && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {t("nodeDetail.moreCores", { count: (linuxData.performance?.cpuCores?.length || 0) - 32 })}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Memory Details */}
                <Card>
                  <CardHeader><CardTitle>💾 {t("nodeDetail.memoryDetails")}</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <InfoRow label={t("nodeDetail.total")} value={linuxData.performance?.memory?.totalBytes 
                      ? ((linuxData.performance.memory.totalBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB') : null} />
                    <InfoRow label={t("nodeDetail.available")} value={linuxData.performance?.memory?.availableBytes 
                      ? ((linuxData.performance.memory.availableBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB') : null} />
                    <InfoRow label={t("nodeDetail.buffers")} value={linuxData.performance?.memory?.buffersBytes 
                      ? ((linuxData.performance.memory.buffersBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB') : null} />
                    <InfoRow label={t("nodeDetail.cached")} value={linuxData.performance?.memory?.cachedBytes 
                      ? ((linuxData.performance.memory.cachedBytes / 1024 / 1024 / 1024).toFixed(1) + ' GB') : null} />
                  </CardContent>
                </Card>

                {/* Disk Space */}
                <Card>
                  <CardHeader><CardTitle>💿 {t("nodeDetail.diskSpace")}</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mount</TableHead>{/* i18n-ignore */}
                          <TableHead>{t("nodeDetail.free")}</TableHead>
                          <TableHead>{t("nodeDetail.total")}</TableHead>
                          <TableHead>{t("nodeDetail.used")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.performance?.diskSpace?.slice(0, 10).map((disk, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{disk.mount}</TableCell>
                            <TableCell>{(disk.availableBytes / 1024 / 1024 / 1024).toFixed(0)} GB</TableCell>
                            <TableCell>{(disk.totalBytes / 1024 / 1024 / 1024).toFixed(0)} GB</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-secondary rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full ${disk.usedPercent > 90 ? 'bg-red-500' : disk.usedPercent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                    style={{ width: `${disk.usedPercent}%` }}
                                  />
                                </div>
                                <span className="text-xs">{disk.usedPercent?.toFixed(0)}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={4} className="text-muted-foreground">{t("nodeDetail.noData")}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Services */}
                <Card>
                  <CardHeader>
                    <CardTitle>⚙️ {t("nodeDetail.servicesCount", { count: linuxData.services?.summary?.total || 0 })}</CardTitle>
                    <CardDescription>
                      {t("nodeDetail.serviceStates", { active: linuxData.services?.summary?.active || 0, failed: linuxData.services?.summary?.failed || 0, inactive: linuxData.services?.summary?.inactive || 0 })} 
                       
                      
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("nodeDetail.service")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead>{t("common.description")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.services?.services
                          ?.filter(s => s.activeState === 'failed' || s.activeState === 'active')
                          .slice(0, 50)
                          .map((svc, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{svc.name}</TableCell>
                            <TableCell>
                              <Badge className={
                                svc.activeState === 'active' ? 'bg-green-600' : 
                                svc.activeState === 'failed' ? 'bg-red-600' : 'bg-muted/500'
                              }>
                                {svc.activeState}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[200px]">{svc.description}</TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground">{t("nodeDetail.noData")}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              {/* Package Updates */}
              {(linuxData.updates?.totalUpdates || 0) > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>📦 {t("nodeDetail.availableUpdates", { count: linuxData.updates?.totalUpdates ?? 0 })}</CardTitle>
                    <CardDescription>
                      {t("nodes.updates.summary", { manager: linuxData.updates?.packageManager ?? "-", security: linuxData.updates?.securityUpdates || 0 })} 
                      
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("nodes.updates.package")}</TableHead>
                          <TableHead>{t("nodes.updates.newVersion")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.updates?.updates?.slice(0, 30).map((pkg, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{pkg.name}</TableCell>
                            <TableCell>{pkg.newVersion}</TableCell>
                          </TableRow>
                        )) || (
                          <TableRow>
                            <TableCell colSpan={2} className="text-muted-foreground">{t("nodes.updates.none")}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    {(linuxData.updates?.updates?.length || 0) > 30 && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {t("nodeDetail.morePackages", { count: (linuxData.updates?.updates?.length || 0) - 30 })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Disk Health */}
              {linuxData.diskHealth?.smartctlAvailable && (linuxData.diskHealth?.disks?.length || 0) > 0 && (
                <Card>
                  <CardHeader><CardTitle>🩺 {t("nodeDetail.diskHealth")}</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("nodeDetail.device")}</TableHead>
                          <TableHead>{t("nodeDetail.model")}</TableHead>
                          <TableHead>{t("common.status")}</TableHead>
                          <TableHead>Temp</TableHead>{/* i18n-ignore */}
                          <TableHead>{t("nodeDetail.powerOnHours")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linuxData.diskHealth?.disks?.map((disk, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{disk.device}</TableCell>
                            <TableCell>{disk.model}</TableCell>
                            <TableCell>
                              <Badge className={disk.healthStatus === 'PASSED' ? 'bg-green-600' : 'bg-red-600'}>
                                {disk.healthStatus}
                              </Badge>
                            </TableCell>
                            <TableCell>{disk.temperature}°C</TableCell>
                            <TableCell>{disk.powerOnHours?.toLocaleString()}h</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          {/* History/Timeline Tab */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>📜 {t("nodeDetail.changeHistory")}</CardTitle>
                <CardDescription>{t("nodeDetail.changeHistoryDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>{t("nodeDetail.noChanges")}</p>
                  </div>
                ) : (
                  <Timeline changes={history} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Monitoring Health Tab */}
          <TabsContent value="monitoring" className="space-y-4">
            <MonitoringHealthPanel nodeId={nodeId} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
