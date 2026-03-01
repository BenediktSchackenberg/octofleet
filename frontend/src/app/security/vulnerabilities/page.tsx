"use client";

import { useState, useEffect } from "react";
import { getAuthHeader } from "@/lib/auth-context";
import { API_BASE } from "@/lib/api-config";
import Link from "next/link";

interface FleetVulnData {
  total: number;
  affectedNodes: number;
  bySeverity: { severity: string; count: number }[];
  byNode: { nodeId: string; total: number; critical: number; high: number }[];
  topCves: { cveId: string; severity: string; packageName: string; affectedNodes: number; cvssScore: number | null; description: string; fixVersion: string | null }[];
  byPackage: { packageName: string; vulnCount: number; affectedNodes: number; maxSeverity: string }[];
}

export default function VulnerabilitiesPage() {
  const [data, setData] = useState<FleetVulnData | null>(null);
  const [nodeVulns, setNodeVulns] = useState<any[] | null>(null);
  const [selectedNode, setSelectedNode] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"fleet" | "cves" | "nodes" | "packages">("fleet");
  const [severityFilter, setSeverityFilter] = useState("all");

  useEffect(() => {
    fetch(`${API_BASE}/security/vulnerabilities/fleet`, { headers: getAuthHeader() })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const loadNodeVulns = async (nodeId: string) => {
    setSelectedNode(nodeId);
    const res = await fetch(`${API_BASE}/vulnerabilities/node/${nodeId}`, { headers: getAuthHeader() });
    const d = await res.json();
    setNodeVulns(d.vulnerabilities || []);
  };

  const sevColor = (s: string) => {
    switch (s?.toLowerCase()) {
      case "critical": return "bg-red-600 text-white";
      case "high": return "bg-red-500 text-white";
      case "medium": return "bg-yellow-600 text-black";
      case "low": return "bg-blue-600 text-white";
      default: return "bg-gray-600 text-white";
    }
  };

  const sevBarColor = (s: string) => {
    switch (s?.toLowerCase()) {
      case "critical": return "bg-red-600";
      case "high": return "bg-red-400";
      case "medium": return "bg-yellow-500";
      case "low": return "bg-blue-500";
      default: return "bg-muted/500";
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground animate-pulse">Loading vulnerability data...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/security" className="hover:text-white">Security Center</Link>
        <span>/</span>
        <span className="text-white">Vulnerabilities</span>
      </div>

      <h1 className="text-2xl font-bold">Vulnerability Management</h1>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-zinc-800 rounded-lg p-4 border border-border">
            <div className="text-muted-foreground text-xs">Total Vulnerabilities</div>
            <div className="text-3xl font-bold text-white">{data.total}</div>
          </div>
          <div className="bg-zinc-800 rounded-lg p-4 border border-border">
            <div className="text-muted-foreground text-xs">Affected Nodes</div>
            <div className="text-3xl font-bold text-white">{data.affectedNodes}</div>
          </div>
          {data.bySeverity.map(s => (
            <div key={s.severity} className="bg-zinc-800 rounded-lg p-4 border border-border">
              <div className="text-muted-foreground text-xs capitalize">{s.severity}</div>
              <div className={`text-3xl font-bold ${s.severity === "critical" ? "text-red-500" : s.severity === "high" ? "text-red-400" : s.severity === "medium" ? "text-yellow-400" : "text-blue-400"}`}>
                {s.count}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["fleet", "cves", "nodes", "packages"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-blue-500 text-white" : "border-transparent text-muted-foreground hover:text-gray-200"}`}
          >
            {t === "fleet" ? "Fleet Overview" : t === "cves" ? "Top CVEs" : t === "nodes" ? "By Node" : "By Package"}
          </button>
        ))}
      </div>

      <div className="bg-zinc-800 rounded-lg border border-border p-4">
        {tab === "fleet" && data && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Severity Distribution</h3>
            <div className="space-y-2">
              {data.bySeverity.map(s => (
                <div key={s.severity} className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium w-20 text-center ${sevColor(s.severity)}`}>{s.severity}</span>
                  <div className="flex-1 bg-zinc-900 rounded-full h-4">
                    <div className={`${sevBarColor(s.severity)} h-4 rounded-full`} style={{ width: `${Math.max(2, (s.count / data.total) * 100)}%` }} />
                  </div>
                  <span className="text-white font-mono w-12 text-right">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "cves" && data && (
          <div className="space-y-2">
            <div className="flex gap-2 mb-3">
              {["all", "critical", "high", "medium", "low"].map(s => (
                <button key={s} onClick={() => setSeverityFilter(s)}
                  className={`px-3 py-1 rounded text-xs ${severityFilter === s ? "bg-blue-600 text-white" : "bg-gray-700 text-muted-foreground"}`}
                >{s}</button>
              ))}
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left sticky top-0 bg-zinc-800">
                  <tr><th className="pb-2">CVE</th><th className="pb-2">Severity</th><th className="pb-2">CVSS</th><th className="pb-2">Package</th><th className="pb-2">Nodes</th><th className="pb-2">Fix</th></tr>
                </thead>
                <tbody className="text-muted-foreground">
                  {data.topCves.filter(c => severityFilter === "all" || c.severity === severityFilter).map(c => (
                    <tr key={c.cveId} className="border-t border-border">
                      <td className="py-1.5">
                        <a href={`https://nvd.nist.gov/vuln/detail/${c.cveId}`} target="_blank" rel="noopener" className="text-blue-400 hover:underline font-mono text-xs">{c.cveId}</a>
                      </td>
                      <td><span className={`px-1.5 py-0.5 rounded text-xs ${sevColor(c.severity)}`}>{c.severity}</span></td>
                      <td className="font-mono">{c.cvssScore?.toFixed(1) ?? "—"}</td>
                      <td>{c.packageName}</td>
                      <td className="font-mono">{c.affectedNodes}</td>
                      <td className="text-xs">{c.fixVersion || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "nodes" && data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Nodes by Vulnerability Count</h3>
              {data.byNode.map(n => (
                <button key={n.nodeId} onClick={() => loadNodeVulns(n.nodeId)}
                  className={`w-full text-left p-3 rounded border transition-colors ${selectedNode === n.nodeId ? "border-blue-500 bg-gray-700" : "border-border bg-zinc-900 hover:border-gray-500"}`}>
                  <div className="flex justify-between">
                    <span className="font-medium text-white">{n.nodeId}</span>
                    <span className="text-muted-foreground">{n.total} vulns</span>
                  </div>
                  <div className="flex gap-2 mt-1">
                    {n.critical > 0 && <span className="text-xs text-red-400">{n.critical} critical</span>}
                    {n.high > 0 && <span className="text-xs text-red-300">{n.high} high</span>}
                  </div>
                </button>
              ))}
            </div>
            {nodeVulns && (
              <div className="max-h-[400px] overflow-y-auto">
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">{selectedNode} — {nodeVulns.length} vulnerabilities</h3>
                {nodeVulns.map((v: any, i: number) => (
                  <div key={i} className="border-b border-border py-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${sevColor(v.severity)}`}>{v.severity}</span>
                      <a href={`https://nvd.nist.gov/vuln/detail/${v.cve_id}`} target="_blank" rel="noopener" className="text-blue-400 hover:underline text-xs font-mono">{v.cve_id}</a>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{v.package_name} {v.installed_version || ""}</div>
                    {v.description && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{v.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "packages" && data && (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr><th className="pb-2">Package</th><th className="pb-2">Vulnerabilities</th><th className="pb-2">Affected Nodes</th><th className="pb-2">Max Severity</th></tr>
            </thead>
            <tbody className="text-muted-foreground">
              {data.byPackage.map(p => (
                <tr key={p.packageName} className="border-t border-border">
                  <td className="py-1.5 font-medium">{p.packageName}</td>
                  <td className="font-mono">{p.vulnCount}</td>
                  <td className="font-mono">{p.affectedNodes}</td>
                  <td><span className={`px-1.5 py-0.5 rounded text-xs ${sevColor(p.maxSeverity)}`}>{p.maxSeverity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
