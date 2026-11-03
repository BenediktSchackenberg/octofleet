"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface NodeVulnerability {
  cve_id: string;
  software_name: string;
  software_version: string;
  description?: string | null;
  cvss_score?: number | null;
  severity?: string | null;
  published_date?: string | null;
  packages?: string[];
  fixed_version?: string | null;
  fix_status?: "fixed" | "none" | "unknown";
  nodes?: string[];
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
}

interface NodeVulnerabilityGroupsResponse {
  node: { id: string; hostname: string };
  groups: VulnerabilityGroup[];
  count: number;
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

/** Link target for a node's full vulnerability list. */
export function nodeVulnerabilitiesHref(node: string, update?: { unit: string; version: string }) {
  const base = `/nodes/${encodeURIComponent(node)}?tab=vulnerabilities`;
  return update ? `${base}&unit=${encodeURIComponent(update.unit)}&unit_version=${encodeURIComponent(update.version)}` : base;
}

/** Number of known vulnerabilities of a node, or null while loading or on error. */
export function useNodeVulnerabilityCount(nodeId: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    apiClient.get<NodeVulnerabilitiesResponse>(`/vulnerabilities/node/${encodeURIComponent(nodeId)}?limit=1`, { showErrorToast: false })
      .then((d) => { if (active) setCount(d?.count ?? null); })
      .catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [nodeId]);
  return count;
}

function useApi<T>(path: string | null) {
  // The result is kept with the path it belongs to, so another node shows "loading" until its own data arrives.
  const [result, setResult] = useState<{ path: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    apiClient.get<T>(path, { showErrorToast: false })
      .then((d) => { if (active) setResult({ path, data: d ?? null }); })
      .catch(() => { if (active) setResult({ path, data: null }); });
    return () => { active = false; };
  }, [path]);
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

function SeverityBadge({ severity }: { severity?: string | null }) {
  const { t } = useI18n();
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${severityClass(severity)}`}>
      {t(`nodes.vulnerabilities.severity.${(severity || "unknown").toLowerCase()}`)}
    </span>
  );
}

function CveLink({ v }: { v: NodeVulnerability }) {
  return (
    <a href={nvdUrl(v.cve_id)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1" title={v.description || undefined}>
      {v.cve_id} <ExternalLink className="h-3 w-3" />
    </a>
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
            <TableHead>{t("nodes.vulnerabilities.fixedIn")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.published")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, shown).map((v) => (
            <TableRow key={v.cve_id}>
              <TableCell className="font-mono whitespace-nowrap"><CveLink v={v} /></TableCell>
              <TableCell><SeverityBadge severity={v.severity} /></TableCell>
              <TableCell className="text-right font-mono">{v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : "-"}</TableCell>
              <TableCell className={`text-sm ${v.fixed_version ? "font-mono" : "text-muted-foreground"}`}>{fixedIn(v, t)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {v.published_date ? new Date(v.published_date).toLocaleDateString() : "-"}
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
            <TableHead>{t("nodes.vulnerabilities.fixedIn")}</TableHead>
            <TableHead>{t("nodes.vulnerabilities.nodesColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, shown).map((v) => (
            <TableRow key={v.cve_id}>
              <TableCell className="font-mono whitespace-nowrap"><CveLink v={v} /></TableCell>
              <TableCell><SeverityBadge severity={v.severity} /></TableCell>
              <TableCell className="text-right font-mono">{v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : "-"}</TableCell>
              <TableCell className={`text-sm ${v.fixed_version ? "font-mono" : "text-muted-foreground"}`}>{fixedIn(v, t)}</TableCell>
              <TableCell className="text-sm">
                {(v.nodes || []).map((node) => (
                  <Link key={node} href={nodeVulnerabilitiesHref(node, { unit, version })} className="mr-2 text-blue-400 hover:underline">{node}</Link>
                ))}
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

/** A node's vulnerabilities grouped by the update that fixes them. */
function VulnerabilityGroups({ nodeId, data }: { nodeId: string; data: NodeVulnerabilityGroupsResponse }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  // A link from the vulnerabilities page ("by software") opens the update it points to.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unit = params.get("unit");
    if (unit) setOpen(`${unit}|${params.get("unit_version") ?? ""}`);
  }, []);
  const counted = data.groups.filter((g) => g.kernel_state !== "old");
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
          {data.groups.map((g) => {
            const key = `${g.fix_unit}|${g.fix_unit_version}`;
            const expanded = open === key;
            return [
              <TableRow key={key} className={`cursor-pointer ${g.kernel_state === "old" ? "opacity-60" : ""}`}
                onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded}>
                <TableCell>
                  <span className="inline-flex items-center gap-2 flex-wrap">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-medium">{g.fix_unit}</span>
                    <span className="text-muted-foreground">{g.fix_unit_version}</span>
                    <KernelBadge state={g.kernel_state} />
                  </span>
                </TableCell>
                <TableCell><SeverityBadge severity={g.max_severity} /></TableCell>
                <TableCell className="text-right font-mono" title={`${g.critical} / ${g.high} / ${g.medium} / ${g.low}`}>{g.cve_count}</TableCell>
                <TableCell className="text-sm">
                  <GroupFix group={g} />
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
              <TableCell className="text-right font-mono">{v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : "-"}</TableCell>
              <TableCell title={(v.packages || []).join(", ") || undefined}>
                <span className="font-medium">{v.software_name}</span>
                <span className="text-muted-foreground"> {v.software_version}</span>
                {(v.packages?.length ?? 0) > 1 && (
                  <span className="text-xs text-muted-foreground"> {t("nodes.vulnerabilities.morePackages", { count: (v.packages?.length ?? 1) - 1 })}</span>
                )}
              </TableCell>
              <TableCell className={`text-sm ${v.fixed_version ? "font-mono" : "text-muted-foreground"}`}>{fixedIn(v, t)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {v.published_date ? new Date(v.published_date).toLocaleDateString() : "-"}
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
export function NodeVulnerabilities({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const [view, setView] = useState<"groups" | "cves">("groups");
  const base = `/vulnerabilities/node/${encodeURIComponent(nodeId)}`;
  const groups = useApi<NodeVulnerabilityGroupsResponse>(`${base}/groups`);
  const cves = useApi<NodeVulnerabilitiesResponse>(view === "cves" ? base : null);
  const data = groups.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nodes.vulnerabilities.title", { count: data?.count ?? 0 })}</CardTitle>
        <CardDescription>{t("nodes.vulnerabilities.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.failed ? (
          <p className="text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>
        ) : !data ? (
          <p className="text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>
        ) : data.groups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>{t("nodes.vulnerabilities.none")}</p>
          </div>
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
            <span className="font-medium">{g.fix_unit}</span>
            <span className="text-muted-foreground">{g.fix_unit_version}</span>
            <KernelBadge state={g.kernel_state} />
            <span className="text-muted-foreground">· {t("nodes.vulnerabilities.cveCount", { count: g.cve_count })} ·</span>
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
