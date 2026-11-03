"use client";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { NodeVulnerabilityPreview, ScanStatusBanner, UpdateCves, nodeVulnerabilitiesHref, type ScanStatus } from "@/components/node-vulnerabilities";

import { Fragment, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui-components";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Bug,
  Server,
  Clock,
  Monitor,
  Package,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface VulnerabilitySummary {
  severity_counts: Record<string, number>;
  affected_nodes: number;
  top_cves: Array<{
    cve_id: string;
    software_name: string;
    cvss_score: number | null;
    severity: string;
    description: string;
    affected_nodes: number;
  }>;
  top_vulnerable_software: Array<{
    software_name: string;
    software_version: string;
    vuln_count: number;
    max_cvss: number | null;
    max_severity: string | null;
    node_count: number;
  }>;
  last_scan: string | null;
  total_vulnerabilities: number;
  running_scan: ScanStatus["running_scan"];
  last_completed_scan: ScanStatus["last_completed_scan"];
}

interface NodeVulnInfo {
  id: string;
  hostname: string;
  os_type: string;
  last_seen: string | null;
  total_vulns: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  max_cvss: number | null;
  max_severity: string | null;
  affected_software_count: number;
}

interface SoftwareVulnInfo {
  software_name: string;
  software_version: string;
  vuln_count: number;
  max_cvss: number | null;
  max_severity: string | null;
  critical: number;
  high: number;
  affected_nodes: string[];
}

interface ScanHistory {
  id: number;
  started_at: string;
  completed_at: string | null;
  packages_scanned: number;
  vulnerabilities_found: number;
  critical_count: number;
  high_count: number;
  status: string;
  error_message: string | null;
}

/** "6 min 44 s" between two timestamps. */
function formatDuration(start: string, end: string): string {
  const seconds = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
}

const TABS = ['overview', 'nodes', 'software', 'cves', 'scans'] as const;
type Tab = typeof TABS[number];

export default function VulnerabilitiesPage() {
  const { t, locale } = useI18n();
  const p = (key: string, params?: Record<string, string | number>) => t(`vulnerabilitiesPage.${key}`, params);
  const sev = (severity: string) => t(`nodes.vulnerabilities.severity.${severity}`);
  const formatTime = (value: string) => new Date(value).toLocaleString(locale);
  const [summary, setSummary] = useState<VulnerabilitySummary | null>(null);
  const [nodeVulns, setNodeVulns] = useState<NodeVulnInfo[]>([]);
  const [softwareVulns, setSoftwareVulns] = useState<SoftwareVulnInfo[]>([]);
  const [scans, setScans] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [expandedSoftware, setExpandedSoftware] = useState<string | null>(null);
  const [urlRestored, setUrlRestored] = useState(false);

  // Tab and open row live in the URL (?tab=nodes&node=…), so "Back" from a node page returns to them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && (TABS as readonly string[]).includes(tab)) setActiveTab(tab as Tab);
    setExpandedNode(params.get("node"));
    setExpandedSoftware(params.get("software"));
    setUrlRestored(true);
  }, []);
  useEffect(() => {
    if (!urlRestored) return;
    const params = new URLSearchParams();
    if (activeTab !== 'overview') params.set("tab", activeTab);
    if (activeTab === 'nodes' && expandedNode) params.set("node", expandedNode);
    if (activeTab === 'software' && expandedSoftware) params.set("software", expandedSoftware);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [urlRestored, activeTab, expandedNode, expandedSoftware]);

  const fetchData = async () => {
    try {
      const [summaryRes, nodesRes, softwareRes, scansRes] = await Promise.all([
        apiClient.get<VulnerabilitySummary>(`/vulnerabilities/summary`, { showErrorToast: false }),
        apiClient.get<{ nodes: NodeVulnInfo[] }>(`/vulnerabilities/by-node`, { showErrorToast: false }),
        apiClient.get<{ software: SoftwareVulnInfo[] }>(`/vulnerabilities/by-software`, { showErrorToast: false }),
        apiClient.get<{ scans: any[] }>(`/vulnerabilities/scans?limit=5`, { showErrorToast: false }),
      ]);

      if (summaryRes) setSummary(summaryRes);
      if (nodesRes) { setNodeVulns(nodesRes.nodes || []); }
      if (softwareRes) { setSoftwareVulns(softwareRes.software || []); }
      if (scansRes) { setScans(scansRes.scans || []); }
    } catch (err) {
      setError(p("errorLoad"));
    } finally {
      setLoading(false);
    }
  };

  // Refresh faster while a scan runs, so its progress and the growing results stay visible.
  const scanRunning = !!summary?.running_scan;
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, scanRunning ? 10000 : 30000);
    return () => clearInterval(interval);
  }, [scanRunning]);

  const triggerScan = async () => {
    setScanning(true);
    try {
      const res = await apiClient.post(`/vulnerabilities/scan`, {}, { showErrorToast: false });
      if (res) setTimeout(fetchData, 2000);
    } catch (err) {
      setError(p("errorScan"));
    } finally {
      setScanning(false);
    }
  };

  const stopScan = async (scanId: number) => {
    try {
      await apiClient.post(`/vulnerabilities/scans/${scanId}/cancel`, {}, { showErrorToast: false });
    } catch (err) {
      setError(p("errorStop"));
    }
    fetchData();
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toUpperCase()) {
      case "CRITICAL": return "bg-red-600 text-white";
      case "HIGH": return "bg-orange-500 text-white";
      case "MEDIUM": return "bg-yellow-500 text-black";
      case "LOW": return "bg-blue-500 text-white";
      default: return "bg-zinc-600 text-white";
    }
  };

  // Severity first: distribution findings (OSV) carry the distribution's priority but no CVSS score.
  // UNKNOWN (an OSV finding without distribution priority) or no severity and no score is shown
  // as unknown, not as low.
  const getRiskLevel = (severity: string | null, cvss: number | null) => {
    const named = severity && severity !== "UNKNOWN" ? severity : null;
    const level = named || (cvss == null ? null : cvss >= 9 ? "CRITICAL" : cvss >= 7 ? "HIGH" : cvss >= 4 ? "MEDIUM" : "LOW");
    if (level === "CRITICAL") return { label: sev("critical"), color: "text-red-500", bg: "bg-red-500", badge: "bg-red-600 text-white" };
    if (level === "HIGH") return { label: sev("high"), color: "text-orange-500", bg: "bg-orange-500", badge: "bg-orange-500 text-white" };
    if (level === "MEDIUM") return { label: sev("medium"), color: "text-yellow-500", bg: "bg-yellow-500", badge: "bg-yellow-500 text-black" };
    if (level === "LOW") return { label: sev("low"), color: "text-blue-500", bg: "bg-blue-500", badge: "bg-blue-500 text-white" };
    return { label: sev("unknown"), color: "text-zinc-400", bg: "bg-zinc-500", badge: "bg-zinc-600 text-white" };
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>;
  }

  const criticalCount = summary?.severity_counts?.CRITICAL || 0;
  const highCount = summary?.severity_counts?.HIGH || 0;
  const mediumCount = summary?.severity_counts?.MEDIUM || 0;
  const lowCount = summary?.severity_counts?.LOW || 0;

  return (
    <div className="p-6 space-y-6">
<PageHeader
        title={`🛡️ ${p("title")}`}
        description={p("description")}
        actions={
          <Button onClick={triggerScan} disabled={scanning || scanRunning}>
            <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? p("scanning") : p("scan")}
          </Button>
        }
      />

      <ScanStatusBanner status={summary} onStop={stopScan} />

      {/* Severity Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="border-l-4 border-l-red-600">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldX className="h-4 w-4 text-red-400" /> {sev("critical")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-red-400">{criticalCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-500" /> {sev("high")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-orange-500">{highCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" /> {sev("medium")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-yellow-600">{mediumCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500" /> {sev("low")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-blue-500">{lowCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4 text-purple-500" /> {p("affectedNodes")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-purple-500">{summary?.affected_nodes || 0}</div></CardContent>
        </Card>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'overview', label: p("tabOverview"), icon: Bug },
          { key: 'nodes', label: p("tabNodes"), icon: Monitor },
          { key: 'software', label: p("tabSoftware"), icon: Package },
          { key: 'cves', label: p("tabCves"), icon: ShieldX },
          { key: 'scans', label: p("tabScans"), icon: Clock },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as Tab)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Critical CVEs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldX className="h-5 w-5 text-red-500" /> {p("top10Critical")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary?.top_cves && summary.top_cves.length > 0 ? (
                <div className="space-y-3">
                  {summary.top_cves.map((cve) => (
                    <div key={`${cve.cve_id}-${cve.software_name}`} className="flex items-start justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <a href={`https://nvd.nist.gov/vuln/detail/${cve.cve_id}`} target="_blank" rel="noopener noreferrer"
                            className="font-mono text-sm font-medium text-blue-400 hover:underline flex items-center gap-1">
                            {cve.cve_id} <ExternalLink className="h-3 w-3" />
                          </a>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getSeverityColor(cve.severity)}`}>
                            {cve.cvss_score != null ? cve.cvss_score.toFixed(1) : getRiskLevel(cve.severity, null).label}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{cve.software_name}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cve.description}</p>
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-sm font-medium">{cve.affected_nodes}</div>
                        <div className="text-xs text-muted-foreground">{p("nodes")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p>{p("noCriticalFound")}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Most Vulnerable Software */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-orange-500" /> {p("mostVulnerable")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary?.top_vulnerable_software && summary.top_vulnerable_software.length > 0 ? (
                <div className="space-y-3">
                  {summary.top_vulnerable_software.map((sw) => (
                    <div key={`${sw.software_name}-${sw.software_version}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{sw.software_name}</div>
                        <div className="text-sm text-muted-foreground">v{sw.software_version}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-lg font-bold text-red-500">{sw.vuln_count}</div>
                          <div className="text-xs text-muted-foreground">{p("cves")}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{sw.node_count}</div>
                          <div className="text-xs text-muted-foreground">{p("nodes")}</div>
                        </div>
                        <div className={`px-2 py-1 rounded text-xs font-bold ${
                          getRiskLevel(sw.max_severity, sw.max_cvss).badge
                        }`}>{sw.max_cvss != null ? sw.max_cvss.toFixed(1) : getRiskLevel(sw.max_severity, null).label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p>{p("noVulnerableSoftware")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Nodes Tab */}
      {activeTab === 'nodes' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" /> {p("byNodeTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nodeVulns.length > 0 ? (
              <div className="space-y-3">
                {nodeVulns.map((node) => {
                  const risk = getRiskLevel(node.max_severity, node.max_cvss);
                  const totalBar = Math.max(node.total_vulns, 1);
                  return (
                    <div key={node.id} className="rounded-lg border bg-card overflow-hidden">
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => setExpandedNode(expandedNode === node.id ? null : node.id)}
                      >
                        <div className="flex items-center gap-3">
                          {expandedNode === node.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <Monitor className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <div className="font-semibold">{node.hostname}</div>
                            <div className="text-xs text-muted-foreground">
                              {node.os_type || "Windows"} · {p("affectedUpdates", { count: node.affected_software_count })}
                              {node.last_seen && ` · ${p("lastSeen", { time: formatTime(node.last_seen) })}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          {/* Severity badges */}
                          <div className="flex items-center gap-2">
                            {([
                              ["CRITICAL", node.critical, "bg-red-600 text-white"],
                              ["HIGH", node.high, "bg-orange-500 text-white"],
                              ["MEDIUM", node.medium, "bg-yellow-500 text-black"],
                              ["LOW", node.low, "bg-blue-500 text-white"],
                            ] as const).filter(([, count]) => count > 0).map(([severity, count, color]) => (
                              <a key={severity} href={nodeVulnerabilitiesHref(node.hostname, { severity })}
                                 onClick={(e) => e.stopPropagation()}
                                 className={`px-2 py-1 rounded text-xs font-bold hover:opacity-80 ${color}`}>
                                {count} {sev(severity.toLowerCase())}
                              </a>
                            ))}
                          </div>
                          <div className="text-right min-w-[60px]">
                            <div className={`text-2xl font-bold ${risk.color}`}>{node.total_vulns}</div>
                            <div className="text-xs text-muted-foreground">{p("total")}</div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded: severity bar */}
                      {expandedNode === node.id && (
                        <div className="px-4 pb-4 space-y-3 border-t">
                          <div className="pt-3">
                            <div className="text-sm font-medium mb-2">{p("severityDistribution")}</div>
                            <div className="flex h-4 rounded-full overflow-hidden bg-muted">
                              {node.critical > 0 && <div className="bg-red-600" style={{ width: `${(node.critical / totalBar) * 100}%` }} />}
                              {node.high > 0 && <div className="bg-orange-500" style={{ width: `${(node.high / totalBar) * 100}%` }} />}
                              {node.medium > 0 && <div className="bg-yellow-500" style={{ width: `${(node.medium / totalBar) * 100}%` }} />}
                              {node.low > 0 && <div className="bg-blue-500" style={{ width: `${(node.low / totalBar) * 100}%` }} />}
                            </div>
                            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                              {([
                                ["CRITICAL", "🔴", node.critical],
                                ["HIGH", "🟠", node.high],
                                ["MEDIUM", "🟡", node.medium],
                                ["LOW", "🔵", node.low],
                              ] as const).map(([severity, dot, count]) => (
                                <a key={severity} href={nodeVulnerabilitiesHref(node.hostname, { severity })} className="hover:underline">
                                  {dot} {count} {sev(severity.toLowerCase())}
                                </a>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              <span>{p("affectedUpdates", { count: node.affected_software_count })}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                              <span>{p("maxCvss")}: <strong className={risk.color}>{node.max_cvss != null ? node.max_cvss.toFixed(1) : "–"}</strong></span>
                            </div>
                          </div>
                          <NodeVulnerabilityPreview nodeId={node.id} hostname={node.hostname} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p>{p("noNodes")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Software Tab */}
      {activeTab === 'software' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" /> {p("bySoftwareTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {softwareVulns.length > 0 ? (
              <div className="space-y-3">
                {softwareVulns.map((sw) => {
                  const risk = getRiskLevel(sw.max_severity, sw.max_cvss);
                  const swKey = `${sw.software_name}|${sw.software_version}`;
                  const swExpanded = expandedSoftware === swKey;
                  return (
                    <div key={`${sw.software_name}-${sw.software_version}`}
                      className="rounded-lg border bg-card overflow-hidden">
                      <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedSoftware(swExpanded ? null : swKey)} aria-expanded={swExpanded}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {swExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-semibold">{sw.software_name}</span>
                            <span className="text-sm text-muted-foreground">v{sw.software_version}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">{p("installedOn")}</span>
                            {sw.affected_nodes.map(n => (
                              <a key={n} href={nodeVulnerabilitiesHref(n, { unit: sw.software_name, version: sw.software_version })}
                                onClick={(e) => e.stopPropagation()}
                                className="px-2 py-0.5 rounded-full text-xs bg-muted hover:bg-primary/20 transition-colors font-medium">
                                {n}
                              </a>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 ml-4">
                          {sw.critical > 0 && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-red-400">{sw.critical}</div>
                              <div className="text-xs text-muted-foreground">{sev("critical")}</div>
                            </div>
                          )}
                          {sw.high > 0 && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-orange-500">{sw.high}</div>
                              <div className="text-xs text-muted-foreground">{sev("high")}</div>
                            </div>
                          )}
                          <div className="text-center">
                            <div className={`text-2xl font-bold ${risk.color}`}>{sw.vuln_count}</div>
                            <div className="text-xs text-muted-foreground">{p("cves")}</div>
                          </div>
                          <div className={`px-2.5 py-1.5 rounded text-xs font-bold ${
                            risk.badge
                          }`}>
                            {sw.max_cvss != null ? `CVSS ${sw.max_cvss.toFixed(1)}` : risk.label}
                          </div>
                        </div>
                      </div>
                      {swExpanded && (
                        <div className="border-t p-4 bg-muted/20">
                          <UpdateCves unit={sw.software_name} version={sw.software_version} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p>{p("noVulnerablePackages")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top CVEs Tab */}
      {activeTab === 'cves' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldX className="h-5 w-5 text-red-500" /> {p("topCritical")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.top_cves && summary.top_cves.length > 0 ? (
              <div className="space-y-3">
                {summary.top_cves.map((cve) => (
                  <div key={`${cve.cve_id}-${cve.software_name}`} className="p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <a href={`https://nvd.nist.gov/vuln/detail/${cve.cve_id}`} target="_blank" rel="noopener noreferrer"
                            className="font-mono text-base font-semibold text-blue-400 hover:underline flex items-center gap-1">
                            {cve.cve_id} <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${getSeverityColor(cve.severity)}`}>
                            {cve.severity} {cve.cvss_score?.toFixed(1)}
                          </span>
                        </div>
                        <div className="text-sm font-medium mt-1">{cve.software_name}</div>
                        <p className="text-sm text-muted-foreground mt-1">{cve.description}</p>
                      </div>
                      <div className="text-center ml-6 min-w-[70px]">
                        <div className="text-2xl font-bold">{cve.affected_nodes}</div>
                        <div className="text-xs text-muted-foreground">{p("nodesAffected")}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p>{p("noCritical")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Scan History Tab */}
      {activeTab === 'scans' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" /> {p("tabScans")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scans.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">{p("started")}</th>
                      <th className="text-right py-2 px-3">{p("duration")}</th>
                      <th className="text-left py-2 px-3">{p("status")}</th>
                      <th className="text-right py-2 px-3">{p("packages")}</th>
                      <th className="text-right py-2 px-3">{p("found")}</th>
                      <th className="text-right py-2 px-3">{sev("critical")}</th>
                      <th className="text-right py-2 px-3">{sev("high")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.map((scan) => (
                      <Fragment key={scan.id}>
                      <tr className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3">{formatTime(scan.started_at)}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap" title={scan.completed_at ? p("endedAt", { time: formatTime(scan.completed_at) }) : undefined}>
                          {scan.completed_at ? formatDuration(scan.started_at, scan.completed_at) : scan.status === "running" ? "…" : "–"}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            scan.status === "completed" ? "bg-green-500/20 text-green-400 dark:bg-green-900 dark:text-green-200" :
                            scan.status === "running" ? "bg-blue-500/20 text-blue-400 dark:bg-blue-900 dark:text-blue-200" :
                            scan.status === "partial" ? "bg-yellow-500/20 text-yellow-500 dark:bg-yellow-900 dark:text-yellow-200" :
                            scan.status === "cancelled" ? "bg-zinc-500/20 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-300" :
                            "bg-red-500/20 text-red-400 dark:bg-red-900 dark:text-red-200"
                          }`}>
                            {scan.status === "completed" ? `✓ ${p("statusCompleted")}` : scan.status === "running" ? `⟳ ${p("statusRunning")}` : scan.status === "partial" ? `⚠ ${p("statusPartial")}` : scan.status === "cancelled" ? `⏹ ${p("statusCancelled")}` : `✗ ${p("statusFailed")}`}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">{scan.packages_scanned}</td>
                        <td className="py-2 px-3 text-right font-medium">{scan.vulnerabilities_found}</td>
                        <td className="py-2 px-3 text-right text-red-400 font-bold">{scan.critical_count}</td>
                        <td className="py-2 px-3 text-right text-orange-500 font-bold">{scan.high_count}</td>
                      </tr>
                      {["failed", "partial", "cancelled"].includes(scan.status) && scan.error_message && (
                        <tr className="border-b">
                          <td colSpan={7} className={`px-3 pb-3 text-sm ${scan.status === "partial" ? "text-yellow-500" : scan.status === "cancelled" ? "text-muted-foreground" : "text-red-400"}`}>{scan.error_message}</td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>{p("noScans")}</p>
                <Button onClick={triggerScan} className="mt-4" variant="outline">{p("firstScan")}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last Scan Info */}
    </div>
  );
}
