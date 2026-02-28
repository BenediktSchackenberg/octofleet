"use client";

import { useEffect, useState } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { API_URL } from '@/lib/api-config';
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
    cvss_score: number;
    severity: string;
    description: string;
    affected_nodes: number;
  }>;
  top_vulnerable_software: Array<{
    software_name: string;
    software_version: string;
    vuln_count: number;
    max_cvss: number;
    node_count: number;
  }>;
  last_scan: string | null;
  total_vulnerabilities: number;
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
  max_cvss: number;
  affected_software_count: number;
}

interface SoftwareVulnInfo {
  software_name: string;
  software_version: string;
  vuln_count: number;
  max_cvss: number;
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
}

export default function VulnerabilitiesPage() {
  const [summary, setSummary] = useState<VulnerabilitySummary | null>(null);
  const [nodeVulns, setNodeVulns] = useState<NodeVulnInfo[]>([]);
  const [softwareVulns, setSoftwareVulns] = useState<SoftwareVulnInfo[]>([]);
  const [scans, setScans] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'nodes' | 'software' | 'cves' | 'scans'>('overview');
  const [expandedNode, setExpandedNode] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const headers = getAuthHeader();
      const [summaryRes, nodesRes, softwareRes, scansRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/vulnerabilities/summary`, { headers }),
        fetch(`${API_URL}/api/v1/vulnerabilities/by-node`, { headers }),
        fetch(`${API_URL}/api/v1/vulnerabilities/by-software`, { headers }),
        fetch(`${API_URL}/api/v1/vulnerabilities/scans?limit=5`, { headers }),
      ]);

      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (nodesRes.ok) { const d = await nodesRes.json(); setNodeVulns(d.nodes || []); }
      if (softwareRes.ok) { const d = await softwareRes.json(); setSoftwareVulns(d.software || []); }
      if (scansRes.ok) { const d = await scansRes.json(); setScans(d.scans || []); }
    } catch (err) {
      setError("Failed to load vulnerability data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const triggerScan = async () => {
    setScanning(true);
    try {
      const headers = { ...getAuthHeader(), "Content-Type": "application/json" };
      const res = await fetch(`${API_URL}/api/v1/vulnerabilities/scan`, { method: "POST", headers });
      if (res.ok) setTimeout(fetchData, 2000);
    } catch (err) {
      setError("Failed to start scan");
    } finally {
      setScanning(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toUpperCase()) {
      case "CRITICAL": return "bg-red-600 text-white";
      case "HIGH": return "bg-orange-500 text-white";
      case "MEDIUM": return "bg-yellow-500 text-black";
      case "LOW": return "bg-blue-500 text-white";
      default: return "bg-gray-500 text-white";
    }
  };

  const getRiskLevel = (cvss: number) => {
    if (cvss >= 9) return { label: "Kritisch", color: "text-red-500", bg: "bg-red-500" };
    if (cvss >= 7) return { label: "Hoch", color: "text-orange-500", bg: "bg-orange-500" };
    if (cvss >= 4) return { label: "Mittel", color: "text-yellow-500", bg: "bg-yellow-500" };
    return { label: "Niedrig", color: "text-blue-500", bg: "bg-blue-500" };
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
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Vulnerabilities" }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Bug className="h-8 w-8 text-red-500" />
            Vulnerability Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            CVE-Tracking für installierte Software — powered by NVD
          </p>
        </div>
        <Button onClick={triggerScan} disabled={scanning}>
          <RefreshCw className={`h-4 w-4 mr-2 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning..." : "Scan starten"}
        </Button>
      </div>

      {/* Severity Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card className="border-l-4 border-l-red-600">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldX className="h-4 w-4 text-red-600" /> Critical
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-red-600">{criticalCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-orange-500" /> High
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-orange-500">{highCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" /> Medium
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-yellow-600">{mediumCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500" /> Low
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-blue-500">{lowCount}</div></CardContent>
        </Card>
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4 text-purple-500" /> Betroffene Nodes
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-purple-500">{summary?.affected_nodes || 0}</div></CardContent>
        </Card>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'overview', label: 'Übersicht', icon: Bug },
          { key: 'nodes', label: 'Nach Node', icon: Monitor },
          { key: 'software', label: 'Nach Software', icon: Package },
          { key: 'cves', label: 'Top CVEs', icon: ShieldX },
          { key: 'scans', label: 'Scan Historie', icon: Clock },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
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
                <ShieldX className="h-5 w-5 text-red-500" /> Top 10 Kritische CVEs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary?.top_cves && summary.top_cves.length > 0 ? (
                <div className="space-y-3">
                  {summary.top_cves.map((cve) => (
                    <div key={cve.cve_id} className="flex items-start justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <a href={`https://nvd.nist.gov/vuln/detail/${cve.cve_id}`} target="_blank" rel="noopener noreferrer"
                            className="font-mono text-sm font-medium text-blue-600 hover:underline flex items-center gap-1">
                            {cve.cve_id} <ExternalLink className="h-3 w-3" />
                          </a>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getSeverityColor(cve.severity)}`}>
                            {cve.cvss_score?.toFixed(1) || "N/A"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{cve.software_name}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cve.description}</p>
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-sm font-medium">{cve.affected_nodes}</div>
                        <div className="text-xs text-muted-foreground">Nodes</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p>Keine kritischen CVEs gefunden</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Most Vulnerable Software */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-orange-500" /> Software mit meisten Vulnerabilities
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
                          <div className="text-xs text-muted-foreground">CVEs</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{sw.node_count}</div>
                          <div className="text-xs text-muted-foreground">Nodes</div>
                        </div>
                        <div className={`px-2 py-1 rounded text-xs font-bold ${
                          sw.max_cvss >= 9 ? "bg-red-600 text-white" :
                          sw.max_cvss >= 7 ? "bg-orange-500 text-white" :
                          sw.max_cvss >= 4 ? "bg-yellow-500 text-black" : "bg-blue-500 text-white"
                        }`}>{sw.max_cvss?.toFixed(1) || "N/A"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                  <p>Keine vulnerablen Software gefunden</p>
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
              <Monitor className="h-5 w-5" /> Vulnerabilities nach Node
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nodeVulns.length > 0 ? (
              <div className="space-y-3">
                {nodeVulns.map((node) => {
                  const risk = getRiskLevel(node.max_cvss);
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
                              {node.os_type || "Windows"} · {node.affected_software_count} betroffene Software-Pakete
                              {node.last_seen && ` · Zuletzt gesehen: ${new Date(node.last_seen).toLocaleString("de-DE")}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          {/* Severity badges */}
                          <div className="flex items-center gap-2">
                            {node.critical > 0 && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-red-600 text-white">
                                {node.critical} Critical
                              </span>
                            )}
                            {node.high > 0 && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-orange-500 text-white">
                                {node.high} High
                              </span>
                            )}
                            {node.medium > 0 && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-yellow-500 text-black">
                                {node.medium} Med
                              </span>
                            )}
                            {node.low > 0 && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-blue-500 text-white">
                                {node.low} Low
                              </span>
                            )}
                          </div>
                          <div className="text-right min-w-[60px]">
                            <div className={`text-2xl font-bold ${risk.color}`}>{node.total_vulns}</div>
                            <div className="text-xs text-muted-foreground">Total</div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded: severity bar */}
                      {expandedNode === node.id && (
                        <div className="px-4 pb-4 space-y-3 border-t">
                          <div className="pt-3">
                            <div className="text-sm font-medium mb-2">Severity Verteilung</div>
                            <div className="flex h-4 rounded-full overflow-hidden bg-muted">
                              {node.critical > 0 && <div className="bg-red-600" style={{ width: `${(node.critical / totalBar) * 100}%` }} />}
                              {node.high > 0 && <div className="bg-orange-500" style={{ width: `${(node.high / totalBar) * 100}%` }} />}
                              {node.medium > 0 && <div className="bg-yellow-500" style={{ width: `${(node.medium / totalBar) * 100}%` }} />}
                              {node.low > 0 && <div className="bg-blue-500" style={{ width: `${(node.low / totalBar) * 100}%` }} />}
                            </div>
                            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                              <span>🔴 {node.critical} Critical</span>
                              <span>🟠 {node.high} High</span>
                              <span>🟡 {node.medium} Medium</span>
                              <span>🔵 {node.low} Low</span>
                            </div>
                          </div>
                          <div className="flex gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              <span><strong>{node.affected_software_count}</strong> betroffene Pakete</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                              <span>Max CVSS: <strong className={risk.color}>{node.max_cvss.toFixed(1)}</strong></span>
                            </div>
                          </div>
                          <a href={`/nodes/${node.hostname}`}
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                            Node-Details öffnen <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p>Keine betroffenen Nodes</p>
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
              <Package className="h-5 w-5" /> Vulnerabilities nach Software
            </CardTitle>
          </CardHeader>
          <CardContent>
            {softwareVulns.length > 0 ? (
              <div className="space-y-3">
                {softwareVulns.map((sw) => {
                  const risk = getRiskLevel(sw.max_cvss);
                  return (
                    <div key={`${sw.software_name}-${sw.software_version}`}
                      className="p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{sw.software_name}</span>
                            <span className="text-sm text-muted-foreground">v{sw.software_version}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">Installiert auf:</span>
                            {sw.affected_nodes.map(n => (
                              <a key={n} href={`/nodes/${n}`}
                                className="px-2 py-0.5 rounded-full text-xs bg-muted hover:bg-primary/20 transition-colors font-medium">
                                {n}
                              </a>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 ml-4">
                          {sw.critical > 0 && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-red-600">{sw.critical}</div>
                              <div className="text-xs text-muted-foreground">Critical</div>
                            </div>
                          )}
                          {sw.high > 0 && (
                            <div className="text-center">
                              <div className="text-lg font-bold text-orange-500">{sw.high}</div>
                              <div className="text-xs text-muted-foreground">High</div>
                            </div>
                          )}
                          <div className="text-center">
                            <div className={`text-2xl font-bold ${risk.color}`}>{sw.vuln_count}</div>
                            <div className="text-xs text-muted-foreground">CVEs</div>
                          </div>
                          <div className={`px-2.5 py-1.5 rounded text-xs font-bold ${
                            sw.max_cvss >= 9 ? "bg-red-600 text-white" :
                            sw.max_cvss >= 7 ? "bg-orange-500 text-white" :
                            sw.max_cvss >= 4 ? "bg-yellow-500 text-black" : "bg-blue-500 text-white"
                          }`}>
                            CVSS {sw.max_cvss.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p>Keine vulnerablen Software-Pakete</p>
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
              <ShieldX className="h-5 w-5 text-red-500" /> Top Kritische CVEs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.top_cves && summary.top_cves.length > 0 ? (
              <div className="space-y-3">
                {summary.top_cves.map((cve) => (
                  <div key={cve.cve_id} className="p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <a href={`https://nvd.nist.gov/vuln/detail/${cve.cve_id}`} target="_blank" rel="noopener noreferrer"
                            className="font-mono text-base font-semibold text-blue-600 hover:underline flex items-center gap-1">
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
                        <div className="text-xs text-muted-foreground">Nodes betroffen</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p>Keine kritischen CVEs</p>
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
              <Clock className="h-5 w-5" /> Scan Historie
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scans.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3">Gestartet</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-right py-2 px-3">Pakete</th>
                      <th className="text-right py-2 px-3">Gefunden</th>
                      <th className="text-right py-2 px-3">Critical</th>
                      <th className="text-right py-2 px-3">High</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scans.map((scan) => (
                      <tr key={scan.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3">{new Date(scan.started_at).toLocaleString("de-DE")}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            scan.status === "completed" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                            scan.status === "running" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                            "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          }`}>
                            {scan.status === "completed" ? "✓ Fertig" : scan.status === "running" ? "⟳ Läuft..." : "✗ Fehler"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">{scan.packages_scanned}</td>
                        <td className="py-2 px-3 text-right font-medium">{scan.vulnerabilities_found}</td>
                        <td className="py-2 px-3 text-right text-red-600 font-bold">{scan.critical_count}</td>
                        <td className="py-2 px-3 text-right text-orange-500 font-bold">{scan.high_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Noch keine Scans durchgeführt</p>
                <Button onClick={triggerScan} className="mt-4" variant="outline">Ersten Scan starten</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Last Scan Info */}
      {summary?.last_scan && (
        <p className="text-sm text-muted-foreground text-center">
          Letzter Scan: {new Date(summary.last_scan).toLocaleString("de-DE")} —{" "}
          {summary.total_vulnerabilities} Vulnerabilities in Datenbank
        </p>
      )}
    </div>
  );
}
