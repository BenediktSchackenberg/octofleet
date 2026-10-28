"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
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
}

interface NodeVulnerabilitiesResponse {
  node: { id: string; hostname: string };
  vulnerabilities: NodeVulnerability[];
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
export function nodeVulnerabilitiesHref(node: string) {
  return `/nodes/${encodeURIComponent(node)}?tab=vulnerabilities`;
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

/** Full list of a node's vulnerabilities with severity filter and search (node page tab). */
export function NodeVulnerabilities({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  // The result is kept with the node it belongs to, so another node shows "loading" until its own data arrives.
  const [result, setResult] = useState<{ nodeId: string; data: NodeVulnerabilitiesResponse | null } | null>(null);
  const [severity, setSeverityState] = useState<string>("ALL");
  const [query, setQueryState] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const setSeverity = (value: string) => { setSeverityState(value); setShown(PAGE_SIZE); };
  const setQuery = (value: string) => { setQueryState(value); setShown(PAGE_SIZE); };

  useEffect(() => {
    let active = true;
    apiClient.get<NodeVulnerabilitiesResponse>(`/vulnerabilities/node/${encodeURIComponent(nodeId)}`, { showErrorToast: false })
      .then((d) => { if (active) setResult({ nodeId, data: d ?? null }); })
      .catch(() => { if (active) setResult({ nodeId, data: null }); });
    return () => { active = false; };
  }, [nodeId]);
  const current = result?.nodeId === nodeId ? result : null;
  const data = current?.data ?? null;
  const failed = current !== null && current.data === null;

  const all = useMemo(() => data?.vulnerabilities ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of all) c[(v.severity || "").toUpperCase()] = (c[(v.severity || "").toUpperCase()] || 0) + 1;
    return c;
  }, [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((v) =>
      (severity === "ALL" || (v.severity || "").toUpperCase() === severity) &&
      (!q || v.cve_id.toLowerCase().includes(q) || v.software_name.toLowerCase().includes(q)));
  }, [all, severity, query]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nodes.vulnerabilities.title", { count: data?.count ?? 0 })}</CardTitle>
        <CardDescription>{t("nodes.vulnerabilities.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failed ? (
          <p className="text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>
        ) : !data ? (
          <p className="text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>
        ) : all.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>{t("nodes.vulnerabilities.none")}</p>
          </div>
        ) : (
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
                  <TableHead>{t("nodes.vulnerabilities.published")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, shown).map((v) => (
                  <TableRow key={`${v.cve_id}-${v.software_name}`}>
                    <TableCell className="font-mono whitespace-nowrap">
                      <a href={nvdUrl(v.cve_id)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1" title={v.description || undefined}>
                        {v.cve_id} <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${severityClass(v.severity)}`}>
                        {t(`nodes.vulnerabilities.severity.${(v.severity || "unknown").toLowerCase()}`)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : "-"}</TableCell>
                    <TableCell>
                      <span className="font-medium">{v.software_name}</span>
                      <span className="text-muted-foreground"> {v.software_version}</span>
                    </TableCell>
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
        )}
      </CardContent>
    </Card>
  );
}

/** The most severe vulnerabilities of a node, with a link to the full list (vulnerabilities page, "by node"). */
export function NodeVulnerabilityPreview({ nodeId, hostname, limit = 5 }: { nodeId: string; hostname: string; limit?: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<NodeVulnerabilitiesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient.get<NodeVulnerabilitiesResponse>(`/vulnerabilities/node/${encodeURIComponent(nodeId)}?limit=${limit}`, { showErrorToast: false })
      .then((d) => { if (active) { if (d) setData(d); else setFailed(true); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [nodeId, limit]);

  if (failed) return <p className="text-sm text-muted-foreground">{t("nodes.vulnerabilities.error")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground animate-pulse">{t("nodes.vulnerabilities.loading")}</p>;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t("nodes.vulnerabilities.mostSevere")}</div>
      <ul className="space-y-1">
        {data.vulnerabilities.map((v) => (
          <li key={`${v.cve_id}-${v.software_name}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${severityClass(v.severity)}`}>
              {v.cvss_score != null ? Number(v.cvss_score).toFixed(1) : "-"}
            </span>
            <a href={nvdUrl(v.cve_id)} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-400 hover:underline">{v.cve_id}</a>
            <span className="text-muted-foreground truncate">{v.software_name} {v.software_version}</span>
          </li>
        ))}
      </ul>
      <Link href={nodeVulnerabilitiesHref(hostname)} className="text-sm text-blue-400 hover:underline inline-flex items-center gap-1">
        {t("nodes.vulnerabilities.showAll", { count: data.count })} →
      </Link>
    </div>
  );
}
