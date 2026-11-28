"use client";

import { useTabParam } from "@/hooks/useTabParam";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatLocalDate, formatTime } from "@/lib/format";

export interface NodeVulnerability {
  cve_id: string;
  software_name: string;
  software_version: string;
  description?: string | null;
  cvss_score?: number | null;
  cvss_vector?: string | null;
  severity?: string | null;
  published_date?: string | null;
  packages?: string[];
  fixed_version?: string | null;
  fix_status?: "fixed" | "none" | "unknown";
  /** Fleet views: the number of nodes the CVE affects. */
  affected_nodes?: number;
  /** Microsoft reports the CVE as exploited (Windows itself, MSRC). */
  exploited?: boolean;
}

interface NodeVulnerabilitiesResponse {
  node: { id: string; hostname: string };
  vulnerabilities: NodeVulnerability[];
  count: number;
}

/** CVEs of one node that one update fixes (source package on Linux, product on Windows). */
export interface VulnerabilityGroup {
  fix_unit: string;
  fix_unit_version: string;
  kernel_state: "running" | "old" | "pending" | null;
  packages: string[];
  cve_count: number;
  fixable_count: number;
  unknown_fix_count: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  max_severity: string;
  max_cvss: number | null;
  exploited_count?: number;
}

/** Whether a Windows node's build could be checked against Microsoft's Security Update Guide. */
interface WindowsUpdates {
  status: "checked" | "unknown";
  reason: "no_build" | "unsupported_release" | "no_data" | null;
  os_build: string | null;
  product: string | null;
  latest_kb?: string;
  latest_build?: string;
  up_to_date?: boolean;
}

/** Whether the scan can check the node's OS release at all (Windows; Linux releases with an advisory source) */
interface ScanSupport { supported: boolean | null; os: string | null }

interface NodeVulnerabilityGroupsResponse {
  node: { id: string; hostname: string };
  scan_support?: ScanSupport;
  groups: VulnerabilityGroup[];
  /** Older kernels installed but not running: not counted, so the API sends them without CVE counts */
  old_kernels?: { fix_unit: string; fix_unit_version: string; packages: string[] }[];
  count: number;
  scan?: ScanStatus;
  windows_updates?: WindowsUpdates | null;
}

/** The running scan (with progress) and the last finished one, from the API. */
export interface ScanStatus {
  /** node_scan: a scan of this node only (node page), not of the fleet. */
  running_scan: { id: number; cancel_requested: boolean; started_at: string; checked: number; total: number; node_scan?: boolean } | null;
  last_completed_scan: { completed_at: string; status: string; packages_scanned: number; error_packages: number; node_scan?: boolean } | null;
}

/** Data older than this is marked as stale. */
const STALE_DAYS = 7;

function relativeAge(ms: number, t: (key: string, params?: Record<string, string | number>) => string) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t("time.secondsAgo", { seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("time.hoursAgo", { hours });
  return t("time.daysAgo", { days: Math.floor(hours / 24) });
}

/** How current the vulnerability data is: a running scan with its progress, or the age of the last finished scan. */
export function ScanStatusBanner({ status, onStop }: { status?: ScanStatus | null; onStop?: (scanId: number) => void }) {
  const { t, locale } = useI18n();
  if (!status) return null;
  const s = (key: string, params?: Record<string, string | number>) => t(`vulnerabilityScan.${key}`, params);
  const warnClass = "border-yellow-500/40 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300";
  const running = status.running_scan;
  if (running) {
    const started = new Date(running.started_at);
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-blue-800 dark:text-blue-300">
        <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
        <span className="flex-1">{s(running.node_scan ? "nodeRunning" : "running", {
          time: formatTime(started),
          minutes: Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000)),
          checked: Math.min(running.checked, running.total),
          total: running.total,
        })}</span>
        {onStop && (
          <Button size="sm" variant="outline" disabled={running.cancel_requested} onClick={() => onStop(running.id)}>
            {running.cancel_requested ? s("stopping") : s("stop")}
          </Button>
        )}
      </div>
    );
  }
  const last = status.last_completed_scan;
  if (!last) return <div role="status" className={`rounded-lg border p-3 text-sm ${warnClass}`}>{s("none")}</div>;
  const age = Date.now() - new Date(last.completed_at).getTime();
  const stale = age > STALE_DAYS * 24 * 60 * 60 * 1000;
  const partial = last.status === "partial";
  return (
    <div role="status" className={`rounded-lg border p-3 text-sm ${stale || partial ? warnClass : "text-muted-foreground"}`}>
      {s(last.node_scan ? "nodeDataFrom" : "dataFrom", { time: formatDateTime(last.completed_at), age: relativeAge(age, t) })}
      {partial && <> {s("partial", { count: last.error_packages })}</>}
      {stale && <> {s("stale", { days: STALE_DAYS })}</>}
    </div>
  );
}

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const PAGE_SIZE = 100;

export function severityClass(severity?: string | null): string {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL": return "bg-red-600 text-white";
    case "HIGH": return "bg-orange-500 text-white";
    case "MEDIUM": return "bg-yellow-500 text-black";
    case "LOW": return "bg-blue-500 text-white";
    default: return "bg-zinc-600 text-white";
  }
}

function nvdUrl(cveId: string) {
  return `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`;
}

/** CVSS version label: "v3.1", or for 4.0 the FIRST nomenclature, e.g. "v4.0-BT" (base + threat metrics). */
export function cvssVersionLabel(vector?: string | null): string | null {
  const match = (vector || "").match(/^CVSS:(\d\.\d)\//);
  if (!match) return null;
  if (match[1] !== "4.0") return `v${match[1]}`;
  const metrics = Object.fromEntries((vector as string).split("/").slice(1).map((part) => part.split(":")));
  const given = (keys: string[]) => keys.some((key) => metrics[key] && metrics[key] !== "X");
  const threat = given(["E"]);
  const environmental = given(["CR", "IR", "AR", "MAV", "MAC", "MAT", "MPR", "MUI", "MVC", "MVI", "MVA", "MSC", "MSI", "MSA"]);
  return `v4.0-B${threat ? "T" : ""}${environmental ? "E" : ""}`;
}

/** A CVSS score, with its version unless a table shows that in its own column; the full vector as tooltip. */
export function CvssScore({ score, vector, version = true }: { score?: number | null; vector?: string | null; version?: boolean }) {
  if (score == null) return <>-</>;
  const label = version ? cvssVersionLabel(vector) : null;
  return (
    <span title={vector || undefined}>
      {Number(score).toFixed(1)}
      {label && <span className="ml-1 text-[10px] font-normal opacity-70">{label}</span>}
    </span>
  );
}

/** Link target for a node's vulnerabilities: one update in the grouped view, or the CVE list filtered by severity. */
export function nodeVulnerabilitiesHref(node: string,
  target?: { unit: string; version: string } | { severity: string } | { cve: string }) {
  const base = `/nodes/${encodeURIComponent(node)}?tab=vulnerabilities`;
  if (!target) return base;
  if ("severity" in target) return `${base}&view=cves&severity=${encodeURIComponent(target.severity.toUpperCase())}`;
  if ("cve" in target) return `${base}&view=cves&q=${encodeURIComponent(target.cve)}`;
  return `${base}&unit=${encodeURIComponent(target.unit)}&unit_version=${encodeURIComponent(target.version)}`;
}

/** Severity filter from the URL (`?severity=`), "ALL" if missing or unknown. */
function severityFromUrl(): string {
  const value = (new URLSearchParams(window.location.search).get("severity") || "").toUpperCase();
  return (SEVERITIES as readonly string[]).includes(value) ? value : "ALL";
}

/** Number of known vulnerabilities of a node, or null while loading or on error. */
/** The node's CVE count for its tab label; "-" when the scan cannot check the node's release (0 would read as clean). */
export function useNodeVulnerabilityCount(nodeId: string) {
  const [count, setCount] = useState<number | "-" | null>(null);
  useEffect(() => {
    let active = true;
    apiClient.get<NodeVulnerabilitiesResponse & { scan_support?: ScanSupport }>(`/vulnerabilities/node/${encodeURIComponent(nodeId)}?limit=1`, { showErrorToast: false })
      .then((d) => { if (active) setCount(d?.scan_support?.supported === false ? "-" : d?.count ?? null); })
      .catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [nodeId]);
  return count;
}

/** GET path; a new `version` loads it again and keeps the old data until the new one arrives. */
function useApi<T>(path: string | null, version = 0) {
  // The result is kept with the path it belongs to, so another node shows "loading" until its own data arrives.
  const [result, setResult] = useState<{ path: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    apiClient.get<T>(path, { showErrorToast: false })
      .then((d) => { if (active) setResult({ path, data: d ?? null }); })
      .catch(() => { if (active) setResult({ path, data: null }); });
    return () => { active = false; };
  }, [path, version]);
  const current = path && result?.path === path ? result : null;
  return { data: current?.data ?? null, failed: current !== null && current.data === null };
}

/** Whether an update fixes the group's CVEs: how many are fixed, no fix yet, or not known (NVD). */
function GroupFix({ group }: { group: VulnerabilityGroup }) {
  const { t } = useI18n();
  if (group.fixable_count > 0) {
    return <span className="text-emerald-500">{t("nodes.vulnerabilities.fixAvailable", { count: group.fixable_count, total: group.cve_count })}</span>;
  }
  return <span className="text-muted-foreground">{t(group.unknown_fix_count > 0 ? "nodes.vulnerabilities.fixUnknown" : "nodes.vulnerabilities.noFix")}</span>;
}

function fixedIn(v: NodeVulnerability, t: (key: string) => string) {
  if (v.fixed_version) return v.fixed_version;
  return v.fix_status === "unknown" ? t("nodes.vulnerabilities.fixUnknown") : t("nodes.vulnerabilities.noFix");
}

const SEVERITY_TEXT = { critical: "text-red-500", high: "text-orange-500", medium: "text-yellow-500", low: "text-blue-500" } as const;

/** How many of an update's CVEs have each severity, e.g. "4 Critical · 58 High · 512 Medium". */
function SeverityCounts({ group }: { group: VulnerabilityGroup }) {
  const { t } = useI18n();
  const levels = (Object.keys(SEVERITY_TEXT) as (keyof typeof SEVERITY_TEXT)[]).filter((level) => group[level] > 0);
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {levels.map((level) => (
        <span key={level} className={SEVERITY_TEXT[level]}>
          {group[level]} {t(`nodes.vulnerabilities.severity.${level}`)}
        </span>
      ))}
    </span>
  );
}

function SeverityBadge({ severity }: { severity?: string | null }) {
  const { t } = useI18n();
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${severityClass(severity)}`}>
      {t(`nodes.vulnerabilities.severity.${(severity || "unknown").toLowerCase()}`)}
    </span>
  );
}

function ExploitedBadge({ count }: { count?: number }) {
  const { t } = useI18n();
  return (
    <span className="px-2 py-0.5 rounded text-xs font-sans font-bold bg-red-700 text-white" title={t("nodes.vulnerabilities.exploitedHint")}>
      {count ? t("nodes.vulnerabilities.exploitedCount", { count }) : t("nodes.vulnerabilities.exploited")}
    </span>
  );
}

function CveLink({ v }: { v: NodeVulnerability }) {
  return (
    <span className="inline-flex items-center gap-2">
      <a href={nvdUrl(v.cve_id)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1" title={v.description || undefined}>
        {v.cve_id} <ExternalLink className="h-3 w-3" />
      </a>
      {v.exploited && <ExploitedBadge />}
    </span>
  );
}

/** Whether the Windows build was checked against Microsoft's Security Update Guide; a warning when it could not be. */
function WindowsUpdatesNote({ state }: { state?: WindowsUpdates | null }) {
  const { t } = useI18n();
  if (!state) return null;
  const w = (key: string, params?: Record<string, string | number>) => t(`nodes.vulnerabilities.windows.${key}`, params);
  const params = { build: state.os_build ?? "-", product: state.product ?? "-", kb: state.latest_kb ?? "", latest: state.latest_build ?? "" };
  if (state.status !== "checked") {
    return (
      <div role="status" className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-300">
        {w(state.reason ?? "no_data", params)}
      </div>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {w("checked", params)} {w(state.up_to_date ? "upToDate" : "behind", params)}
    </p>
  );
}

function KernelBadge({ state }: { state: VulnerabilityGroup["kernel_state"] }) {
  const { t } = useI18n();
  if (!state) return null;
  const label = { running: "kernelRunning", old: "kernelOld", pending: "kernelPending" }[state];
  const hint = state === "old" ? t("nodes.vulnerabilities.kernelOldHint") : state === "pending" ? t("nodes.vulnerabilities.kernelPendingHint") : undefined;
  const color = state === "old" ? "bg-zinc-600 text-white" : state === "pending" ? "bg-amber-600 text-white" : "bg-emerald-700 text-white";
  return <span className={`px-2 py-0.5 rounded text-xs ${color}`} title={hint}>{t(`nodes.vulnerabilities.${label}`)}</span>;
}

/** The CVEs of one group, loaded when the group is expanded. */
function GroupCves({ nodeId, group }: { nodeId: string; group: VulnerabilityGroup }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(PAGE_SIZE);
  const { data, failed } = useApi<NodeVulnerabilitiesResponse>(
    `/vulnerabilities/node/${encodeURIComponent(nodeId)}?unit=${encodeURIComponent(group.fix_unit)}&unit_version=${encodeURIComponent(group.fix_unit_version)}`);
  if (failed) return <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>;
  const rows = data.vulnerabilities;
  return (
    <div className="space-y-2">
      {group.kernel_state === "old" && <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.kernelOldHint")}</p>}
      <p className="text-xs text-muted-foreground">{group.packages.join(", ")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("nodes.vulnerabilities.cve")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.severityColumn")}</TableHead>
            <TableHead className="text-right">CVSS</TableHead>
            <TableHead>{t("nodes.vulnerabilities.cvssVersion")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.fixedIn")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.published")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, shown).map((v) => (
            <TableRow key={v.cve_id}>
              <TableCell className="font-mono whitespace-nowrap"><CveLink v={v} /></TableCell>
              <TableCell><SeverityBadge severity={v.severity} /></TableCell>
              <TableCell className="text-right font-mono"><CvssScore score={v.cvss_score} vector={v.cvss_vector} version={false} /></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground" title={v.cvss_vector || undefined}>{cvssVersionLabel(v.cvss_vector)?.slice(1) ?? "-"}</TableCell>
              <TableCell className={`text-sm ${v.fixed_version ? "font-mono" : "text-muted-foreground"}`}>{fixedIn(v, t)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {v.published_date ? formatLocalDate(v.published_date) : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown && (
        <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE_SIZE)}>
          {t("nodes.vulnerabilities.showMore", { count: Math.min(PAGE_SIZE, rows.length - shown), remaining: rows.length - shown })}
        </Button>
      )}
    </div>
  );
}

/** The CVEs of one update across all nodes (vulnerabilities page, "by software"), loaded when expanded. */
export function UpdateCves({ unit, version }: { unit: string; version: string }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(PAGE_SIZE);
  const { data, failed } = useApi<NodeVulnerabilitiesResponse>(
    `/vulnerabilities/by-software/cves?unit=${encodeURIComponent(unit)}&unit_version=${encodeURIComponent(version)}`);
  if (failed) return <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>;
  const rows = data.vulnerabilities;
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("nodes.vulnerabilities.cve")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.severityColumn")}</TableHead>
            <TableHead className="text-right">CVSS</TableHead>
            <TableHead>{t("nodes.vulnerabilities.cvssVersion")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.fixedIn")}</TableHead>
            <TableHead className="text-right">{t("nodes.vulnerabilities.nodesColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, shown).map((v) => (
            <TableRow key={v.cve_id}>
              <TableCell className="font-mono whitespace-nowrap"><CveLink v={v} /></TableCell>
              <TableCell><SeverityBadge severity={v.severity} /></TableCell>
              <TableCell className="text-right font-mono"><CvssScore score={v.cvss_score} vector={v.cvss_vector} version={false} /></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground" title={v.cvss_vector || undefined}>{cvssVersionLabel(v.cvss_vector)?.slice(1) ?? "-"}</TableCell>
              <TableCell className={`text-sm ${v.fixed_version ? "font-mono" : "text-muted-foreground"}`}>{fixedIn(v, t)}</TableCell>
              <TableCell className="text-sm text-right tabular-nums">{v.affected_nodes ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > shown && (
        <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE_SIZE)}>
          {t("nodes.vulnerabilities.showMore", { count: Math.min(PAGE_SIZE, rows.length - shown), remaining: rows.length - shown })}
        </Button>
      )}
    </div>
  );
}

interface UpdateNode { node_id: string; hostname: string; os_name: string | null; os_version: string | null; cves: number }
const NODES_PAGE = 50;

/** The nodes one update's CVEs affect (vulnerabilities page, "by software"), a page at a time; each
 *  opens the node's Vulnerabilities tab on this update. */
export function UpdateNodes({ unit, version }: { unit: string; version: string }) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<UpdateNode[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async (offset: number) => {
    setLoading(true);
    const res = await apiClient.get<{ total: number; nodes: UpdateNode[] }>(
      `/vulnerabilities/by-software/nodes?unit=${encodeURIComponent(unit)}&unit_version=${encodeURIComponent(version)}&limit=${NODES_PAGE}&offset=${offset}`,
      { showErrorToast: false });
    setLoading(false);
    if (!res) { setFailed(true); return; }
    setTotal(res.total);
    setNodes((prev) => offset === 0 ? res.nodes : [...prev, ...res.nodes]);
  };
  useEffect(() => { load(0); }, [unit, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>;
  if (total === null) return <p className="text-sm text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>;
  const remaining = total - nodes.length;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("nodes.vulnerabilities.updateNodes", { count: total })}</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("nodes.vulnerabilities.nodesColumn")}</TableHead>
            <TableHead>OS</TableHead>
            <TableHead className="text-right">{t("nodes.vulnerabilities.updateNodeCves")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n) => (
            <TableRow key={n.node_id}>
              <TableCell><Link href={nodeVulnerabilitiesHref(n.hostname, { unit, version })} className="text-blue-400 hover:underline">{n.hostname}</Link></TableCell>
              <TableCell className="text-sm text-muted-foreground">{[n.os_name, n.os_version].filter(Boolean).join(" ") || "-"}</TableCell>
              <TableCell className="text-sm text-right tabular-nums">{n.cves}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {remaining > 0 && (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => load(nodes.length)}>
          {loading && <Loader2 className="animate-spin" />}
          {t("nodes.vulnerabilities.moreNodes", { count: Math.min(NODES_PAGE, remaining), remaining })}
        </Button>
      )}
    </div>
  );
}

/** A node's vulnerabilities grouped by the update that fixes them. */
function VulnerabilityGroups({ nodeId, data }: { nodeId: string; data: NodeVulnerabilityGroupsResponse }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  // A link from the vulnerabilities page ("by software") opens the update it points to.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unit = params.get("unit");
    if (!unit) return;
    const key = `${unit}|${params.get("unit_version") ?? ""}`;
    setOpen(key);
    setTimeout(() => document.getElementById(`update-${key}`)?.scrollIntoView({ block: "center" }), 300);
  }, []);
  const counted = data.groups.filter((g) => g.kernel_state !== "old");
  // Older kernels come after the counted updates, without counts (opening one lists its CVEs)
  const oldKernels: VulnerabilityGroup[] = (data.old_kernels ?? []).map((k) => ({
    ...k, kernel_state: "old", cve_count: 0, fixable_count: 0, unknown_fix_count: 0,
    critical: 0, high: 0, medium: 0, low: 0, max_severity: "UNKNOWN", max_cvss: null,
  }));
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.groupsSummary", { count: data.count, groups: counted.length })}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("nodes.vulnerabilities.update")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.severityColumn")}</TableHead>
            <TableHead className="text-right">{t("nodes.vulnerabilities.cves")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.fix")}</TableHead>
            <TableHead className="text-right">{t("nodes.vulnerabilities.packagesColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data.groups, ...oldKernels].map((g) => {
            const key = `${g.fix_unit}|${g.fix_unit_version}`;
            const old = g.kernel_state === "old";
            const expanded = open === key;
            return [
              <TableRow key={key} id={`update-${key}`} className={`cursor-pointer ${g.kernel_state === "old" ? "opacity-60" : ""}`}
                onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded}>
                <TableCell>
                  <span className="inline-flex items-center gap-2 flex-wrap">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-medium">{g.fix_unit}</span>
                    <span className="text-muted-foreground">{g.fix_unit_version}</span>
                    <KernelBadge state={g.kernel_state} />
                    {(g.exploited_count ?? 0) > 0 && <ExploitedBadge count={g.exploited_count} />}
                  </span>
                </TableCell>
                <TableCell>{old ? "-" : <SeverityBadge severity={g.max_severity} />}</TableCell>
                <TableCell className="text-right">
                  {old ? <span className="text-muted-foreground">-</span> : <>
                    <div className="font-mono">{g.cve_count}</div>
                    <div className="text-xs"><SeverityCounts group={g} /></div>
                  </>}
                </TableCell>
                <TableCell className="text-sm">
                  {old ? "-" : <GroupFix group={g} />}
                </TableCell>
                <TableCell className="text-right" title={g.packages.join(", ")}>{g.packages.length}</TableCell>
              </TableRow>,
              expanded && (
                <TableRow key={`${key}-cves`}>
                  <TableCell colSpan={5} className="bg-muted/30"><GroupCves nodeId={nodeId} group={g} /></TableCell>
                </TableRow>
              ),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Flat list of a node's CVEs (one row per CVE) with severity filter and search. */
function CveList({ data }: { data: NodeVulnerabilitiesResponse }) {
  const { t } = useI18n();
  const [severity, setSeverityState] = useState<string>("ALL");
  const [query, setQueryState] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const setSeverity = (value: string) => { setSeverityState(value); setShown(PAGE_SIZE); };
  const setQuery = (value: string) => { setQueryState(value); setShown(PAGE_SIZE); };
  // A severity badge on the vulnerabilities page links here with ?severity=.
  useEffect(() => {
    setSeverityState(severityFromUrl());
    setQueryState(new URLSearchParams(window.location.search).get("q") ?? "");
  }, []);

  const all = data.vulnerabilities;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of all) c[(v.severity || "").toUpperCase()] = (c[(v.severity || "").toUpperCase()] || 0) + 1;
    return c;
  }, [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((v) =>
      (severity === "ALL" || (v.severity || "").toUpperCase() === severity) &&
      (!q || v.cve_id.toLowerCase().includes(q) || v.software_name.toLowerCase().includes(q)
        || (v.packages || []).some((p) => p.toLowerCase().includes(q))));
  }, [all, severity, query]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {["ALL", ...SEVERITIES].map((s) => (
          <Button key={s} size="sm" variant={severity === s ? "default" : "outline"} onClick={() => setSeverity(s)}>
            {s === "ALL" ? t("nodes.vulnerabilities.all", { count: all.length }) : `${t(`nodes.vulnerabilities.severity.${s.toLowerCase()}`)} (${counts[s] || 0})`}
          </Button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("nodes.vulnerabilities.search")}
          aria-label={t("nodes.vulnerabilities.search")}
          className="ml-auto h-9 w-full sm:w-64 rounded-md border bg-background px-3 text-sm"
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("nodes.vulnerabilities.cve")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.severityColumn")}</TableHead>
            <TableHead className="text-right">CVSS</TableHead>
            <TableHead>{t("nodes.vulnerabilities.cvssVersion")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.software")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.fixedIn")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.published")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.slice(0, shown).map((v) => (
            <TableRow key={v.cve_id}>
              <TableCell className="font-mono whitespace-nowrap"><CveLink v={v} /></TableCell>
              <TableCell><SeverityBadge severity={v.severity} /></TableCell>
              <TableCell className="text-right font-mono"><CvssScore score={v.cvss_score} vector={v.cvss_vector} version={false} /></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground" title={v.cvss_vector || undefined}>{cvssVersionLabel(v.cvss_vector)?.slice(1) ?? "-"}</TableCell>
              <TableCell title={(v.packages || []).join(", ") || undefined}>
                <span className="font-medium">{v.software_name}</span>
                <span className="text-muted-foreground"> {v.software_version}</span>
                {(v.packages?.length ?? 0) > 1 && (
                  <span className="text-xs text-muted-foreground"> {t("nodes.vulnerabilities.morePackages", { count: (v.packages?.length ?? 1) - 1 })}</span>
                )}
              </TableCell>
              <TableCell className={`text-sm ${v.fixed_version ? "font-mono" : "text-muted-foreground"}`}>{fixedIn(v, t)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {v.published_date ? formatLocalDate(v.published_date) : "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {filtered.length === 0 && <p className="text-muted-foreground">{t("nodes.vulnerabilities.noMatch")}</p>}
      {filtered.length > shown && (
        <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE_SIZE)}>
          {t("nodes.vulnerabilities.showMore", { count: Math.min(PAGE_SIZE, filtered.length - shown), remaining: filtered.length - shown })}
        </Button>
      )}
    </>
  );
}

/** A node's vulnerabilities (node page tab): grouped by update, or as a flat CVE list. */
/** Seconds between reloads while a scan runs: this node's scan (seconds long) or a fleet scan. */
const NODE_SCAN_POLL_MS = 2000;
const FLEET_SCAN_POLL_MS = 15000;

interface ScanRecord { id: number; status: string; packages_scanned: number | null; error_message: string | null }

/** Scan now: checks this node's software versions (POST /vulnerabilities/scan?node=) and follows
 * the scan until it has finished; `onProgress` reloads the node's data while it runs and after. */
function useNodeScan(nodeId: string, onProgress: () => void) {
  const { t } = useI18n();
  const [scanId, setScanId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const start = async () => {
    setMessage(null);
    const res = await apiClient.richPost<{ scan_id: number }>(
      `/vulnerabilities/scan?node=${encodeURIComponent(nodeId)}`, {}, { showErrorToast: false });
    if (res.ok && res.data) { setScanId(res.data.scan_id); onProgress(); }
    else setMessage({ text: t(res.status === 409 ? "nodes.vulnerabilities.scanBusy" : "nodes.vulnerabilities.scanStartFailed"), error: true });
  };
  useEffect(() => {
    if (scanId === null) return;
    let active = true;
    const timer = setInterval(async () => {
      const scan = await apiClient.get<ScanRecord>(`/vulnerabilities/scans/${scanId}`, { showErrorToast: false });
      if (!active || !scan) return;
      onProgress();
      if (scan.status === "running") return;
      setScanId(null);
      setMessage(scan.status === "completed" || scan.status === "partial"
        ? { text: t("nodes.vulnerabilities.scanDone", { count: scan.packages_scanned ?? 0 }), error: false }
        : { text: t("nodes.vulnerabilities.scanFailed", { error: scan.error_message ?? scan.status }), error: true });
    }, NODE_SCAN_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [scanId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { start, scanning: scanId !== null, message };
}

export function NodeVulnerabilities({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  // ?view=cves opens the CVE list (links from the node card and the vulnerabilities page)
  const [view, setView] = useTabParam<"groups" | "cves">("groups", ["groups", "cves"], "view");
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);
  const base = `/vulnerabilities/node/${encodeURIComponent(nodeId)}`;
  const groups = useApi<NodeVulnerabilityGroupsResponse>(`${base}/groups`, version);
  const cves = useApi<NodeVulnerabilitiesResponse>(view === "cves" ? base : null, version);
  const data = groups.data;
  const scan = useNodeScan(nodeId, reload);
  const running = data?.scan?.running_scan;
  // A scan started elsewhere (another tab, the fleet page): follow it until it has finished.
  useEffect(() => {
    if (!running || scan.scanning) return;
    const timer = setTimeout(reload, running.node_scan ? NODE_SCAN_POLL_MS : FLEET_SCAN_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, scan.scanning]);
  const busy = scan.scanning || !!running;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t("nodes.vulnerabilities.title", { count: data?.scan_support?.supported === false ? "-" : data?.count ?? 0 })}</CardTitle>
          <CardDescription>{t("nodes.vulnerabilities.description")}</CardDescription>
        </div>
        {hasPermission("settings:write") && (
          <Button size="sm" variant="outline" className="shrink-0" onClick={scan.start} disabled={busy}
            title={t("nodes.vulnerabilities.scanNowHint")}>
            <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
            {busy ? t("nodes.vulnerabilities.scanning") : t("nodes.vulnerabilities.scanNow")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {scan.message && (
          <p role="status" className={`text-sm ${scan.message.error ? "text-red-500" : "text-muted-foreground"}`}>{scan.message.text}</p>
        )}
        <ScanStatusBanner status={data?.scan} />
        <WindowsUpdatesNote state={data?.windows_updates} />
        {/* a release the scan cannot check: no CVEs here would read as a clean node */}
        {data?.scan_support?.supported === false && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("nodes.vulnerabilities.notScanned", { os: data.scan_support.os ?? "-" })}
          </p>
        )}
        {groups.failed ? (
          <p className="text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>
        ) : !data ? (
          <p className="text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>
        ) : data.groups.length === 0 ? (
          data.scan_support?.supported === false ? null : (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t("nodes.vulnerabilities.none")}</p>
            </div>
          )
        ) : (
          <>
            <div className="flex gap-2">
              <Button size="sm" variant={view === "groups" ? "default" : "outline"} onClick={() => setView("groups")}>{t("nodes.vulnerabilities.viewGroups")}</Button>
              <Button size="sm" variant={view === "cves" ? "default" : "outline"} onClick={() => setView("cves")}>{t("nodes.vulnerabilities.viewCves")}</Button>
            </div>
            {view === "groups" ? (
              <VulnerabilityGroups nodeId={nodeId} data={data} />
            ) : cves.failed ? (
              <p className="text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>
            ) : !cves.data ? (
              <p className="text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>
            ) : (
              <CveList data={cves.data} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The updates of a node with the most severe CVEs, with a link to the full list (vulnerabilities page, "by node"). */
export function NodeVulnerabilityPreview({ nodeId, hostname, limit = 5 }: { nodeId: string; hostname: string; limit?: number }) {
  const { t } = useI18n();
  const { data, failed } = useApi<NodeVulnerabilityGroupsResponse>(`/vulnerabilities/node/${encodeURIComponent(nodeId)}/groups`);

  if (failed) return <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t("nodes.vulnerabilities.topUpdates")}</div>
      <ul className="space-y-1">
        {data.groups.filter((g) => g.kernel_state !== "old").slice(0, limit).map((g) => (
          <li key={`${g.fix_unit}|${g.fix_unit_version}`} className="flex flex-wrap items-center gap-2 text-sm">
            <SeverityBadge severity={g.max_severity} />
            <Link href={nodeVulnerabilitiesHref(hostname, { unit: g.fix_unit, version: g.fix_unit_version })}
              className="font-medium text-blue-400 hover:underline" title={t("nodes.vulnerabilities.openUpdate")}>
              {g.fix_unit}
            </Link>
            <span className="text-muted-foreground">{g.fix_unit_version}</span>
            <KernelBadge state={g.kernel_state} />
            {(g.exploited_count ?? 0) > 0 && <ExploitedBadge count={g.exploited_count} />}
            <span className="text-muted-foreground">· {t("nodes.vulnerabilities.cveCount", { count: g.cve_count })}:</span>
            <SeverityCounts group={g} />
            <span className="text-muted-foreground">·</span>
            <GroupFix group={g} />
          </li>
        ))}
      </ul>
      <Link href={nodeVulnerabilitiesHref(hostname)} className="text-sm text-blue-400 hover:underline inline-flex items-center gap-1">
        {t("nodes.vulnerabilities.showAll", { count: data.count })} →
      </Link>
    </div>
  );
}
