"use client";

import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import Link from "next/link";

interface PostureSnapshot {
  id: string;
  nodeId: string;
  snapshotType: string;
  osInfo: Record<string, any>;
  installedPackages: any[];
  runningServices: any[];
  configSettings: Record<string, any>;
  openPorts: any[];
  createdAt: string;
}

interface PostureDiff {
  changes: { category: string; field?: string; name?: string; port?: string; change?: string; old?: any; new?: any; severity: string }[];
  totalChanges: number;
}

export default function PosturePage() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [selectedNode, setSelectedNode] = useState("");
  const [snapshots, setSnapshots] = useState<PostureSnapshot[]>([]);
  const [comparison, setComparison] = useState<{ baselineId?: string; baselineDate?: string; currentId?: string; currentDate?: string; diff?: PostureDiff } | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<PostureSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "packages" | "services" | "config" | "ports">("overview");

  useEffect(() => {
    apiClient.get(`/nodes`, { showErrorToast: false })
      
      .then(data => setNodes(Array.isArray(data) ? data : data.nodes || []))
      .catch(() => {});
  }, []);

  const loadNode = async (nodeId: string) => {
    setSelectedNode(nodeId);
    setLoading(true);
    setSelectedSnapshot(null);
    setComparison(null);
    try {
      const [snapData, compData] = await Promise.all([
        apiClient.get(`/posture/snapshots/${nodeId}`, { showErrorToast: false }),
        apiClient.get(`/posture/compare/${nodeId}`, { showErrorToast: false })
      ]);
      setSnapshots(snapData?.snapshots || []);
      setComparison(compData);
      if (snapData?.snapshots?.length > 0) setSelectedSnapshot(snapData.snapshots[0]);
    } catch { }
    setLoading(false);
  };

  const severityColor = (s: string) => {
    switch (s) {
      case "critical": return "bg-red-600 text-white";
      case "high": return "bg-red-500 text-white";
      case "medium": return "bg-yellow-500 text-black";
      case "low": return "bg-blue-500 text-white";
      default: return "bg-muted/500 text-white";
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/security" className="hover:text-white">Security Center</Link>
        <span>/</span>
        <span className="text-white">Config Posture</span>
      </div>

      <h1 className="text-2xl font-bold">Config Posture & Baseline</h1>
      <p className="text-muted-foreground">Track system configuration changes and detect drift from baseline</p>

      {/* Node selector */}
      <div className="flex gap-4 items-center">
        <select
          className="bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-white"
          value={selectedNode}
          onChange={e => loadNode(e.target.value)}
        >
          <option value="">Select a node...</option>
          {nodes.map(n => (
            <option key={n.id || n.node_id} value={n.node_id || n.name}>
              {n.node_id || n.name} {n.os_type ? `(${n.os_type})` : ""}
            </option>
          ))}
        </select>
        {loading && <span className="text-muted-foreground animate-pulse">Loading...</span>}
      </div>

      {selectedNode && !loading && (
        <>
          {/* Diff summary */}
          {comparison?.diff && comparison.diff.totalChanges > 0 && (
            <div className="bg-zinc-800 rounded-lg border border-border p-4">
              <h2 className="text-lg font-semibold mb-2">
                ⚠️ Baseline Drift Detected — {comparison.diff.totalChanges} changes
              </h2>
              <p className="text-sm text-muted-foreground mb-3">
                Comparing baseline from {comparison.baselineDate ? new Date(comparison.baselineDate).toLocaleString() : "?"} 
                with current from {comparison.currentDate ? new Date(comparison.currentDate).toLocaleString() : "?"}
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {comparison.diff.changes.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColor(c.severity)}`}>{c.severity}</span>
                    <span className="text-muted-foreground font-medium">[{c.category}]</span>
                    {c.field && <span>{c.field}: <span className="text-red-400">{String(c.old ?? "—")}</span> → <span className="text-green-400">{String(c.new ?? "—")}</span></span>}
                    {c.name && <span>{c.change}: <span className="text-white font-medium">{c.name}</span></span>}
                    {c.port && <span>{c.change}: <span className="text-white font-medium">{c.port}</span></span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {comparison?.diff && comparison.diff.totalChanges === 0 && comparison.baselineId !== comparison.currentId && (
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
              ✅ No drift detected — current config matches baseline
            </div>
          )}

          {/* Snapshot selector */}
          {snapshots.length > 0 && (
            <div className="flex gap-2 items-center">
              <span className="text-muted-foreground text-sm">Snapshot:</span>
              <select
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-sm text-white"
                value={selectedSnapshot?.id || ""}
                onChange={e => setSelectedSnapshot(snapshots.find(s => s.id === e.target.value) || null)}
              >
                {snapshots.map(s => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.createdAt).toLocaleString()} ({s.snapshotType})
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground text-xs">{snapshots.length} snapshots total</span>
            </div>
          )}

          {/* Tabs */}
          {selectedSnapshot && (
            <>
              <div className="flex gap-1 border-b border-border">
                {(["overview", "packages", "services", "config", "ports"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      tab === t ? "border-blue-500 text-white" : "border-transparent text-muted-foreground hover:text-zinc-200"
                    }`}
                  >
                    {t === "overview" ? "Overview" : t === "packages" ? `Packages (${selectedSnapshot.installedPackages?.length || 0})` : t === "services" ? `Services (${selectedSnapshot.runningServices?.length || 0})` : t === "config" ? "Config" : `Ports (${selectedSnapshot.openPorts?.length || 0})`}
                  </button>
                ))}
              </div>

              <div className="bg-zinc-800 rounded-lg border border-border p-4">
                {tab === "overview" && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-zinc-900 rounded p-3">
                      <div className="text-muted-foreground text-xs">OS</div>
                      <div className="text-white font-medium">{selectedSnapshot.osInfo?.productName || selectedSnapshot.osInfo?.osPlatform || "N/A"}</div>
                      <div className="text-muted-foreground text-xs mt-1">Build {selectedSnapshot.osInfo?.buildNumber || "?"}</div>
                    </div>
                    <div className="bg-zinc-900 rounded p-3">
                      <div className="text-muted-foreground text-xs">Packages</div>
                      <div className="text-2xl font-bold text-white">{selectedSnapshot.installedPackages?.length || 0}</div>
                    </div>
                    <div className="bg-zinc-900 rounded p-3">
                      <div className="text-muted-foreground text-xs">Services</div>
                      <div className="text-2xl font-bold text-white">{selectedSnapshot.runningServices?.length || 0}</div>
                      <div className="text-green-400 text-xs">{selectedSnapshot.runningServices?.filter((s: any) => s.status === "Running").length || 0} running</div>
                    </div>
                    <div className="bg-zinc-900 rounded p-3">
                      <div className="text-muted-foreground text-xs">Open Ports</div>
                      <div className="text-2xl font-bold text-white">{selectedSnapshot.openPorts?.length || 0}</div>
                    </div>
                    {/* Config highlights */}
                    {selectedSnapshot.configSettings && Object.keys(selectedSnapshot.configSettings).length > 0 && (
                      <div className="col-span-full bg-zinc-900 rounded p-3">
                        <div className="text-muted-foreground text-xs mb-2">Security Config</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedSnapshot.configSettings).filter(([k]) => !["firewallDetails", "localAdmins"].includes(k)).map(([k, v]) => (
                            <span key={k} className={`px-2 py-1 rounded text-xs ${
                              (k === "rdpEnabled" && v === true) || (k === "smbV1Enabled" && v === true) || (k === "guestAccount" && v === true) || (k === "autoLogin" && v === true)
                                ? "bg-red-900 text-red-300"
                                : k === "firewallEnabled" && v === true
                                ? "bg-green-900 text-green-300"
                                : "bg-zinc-700 text-muted-foreground"
                            }`}>
                              {k}: {String(v)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tab === "packages" && (
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-left">
                        <tr><th className="pb-2">Name</th><th className="pb-2">Version</th><th className="pb-2">Publisher</th></tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {(selectedSnapshot.installedPackages || []).map((p: any, i: number) => (
                          <tr key={i} className="border-t border-border">
                            <td className="py-1">{p.name || p}</td>
                            <td className="py-1">{p.version || ""}</td>
                            <td className="py-1">{p.publisher || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === "services" && (
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-left">
                        <tr><th className="pb-2">Name</th><th className="pb-2">Display Name</th><th className="pb-2">Status</th><th className="pb-2">Start Type</th></tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {(selectedSnapshot.runningServices || []).map((s: any, i: number) => (
                          <tr key={i} className="border-t border-border">
                            <td className="py-1 font-mono text-xs">{s.name || s}</td>
                            <td className="py-1">{s.displayName || ""}</td>
                            <td className="py-1">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${s.status === "Running" ? "bg-green-900 text-green-300" : "bg-zinc-700 text-muted-foreground"}`}>
                                {s.status || "?"}
                              </span>
                            </td>
                            <td className="py-1 text-xs">{s.startType || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === "config" && (
                  <div className="space-y-3">
                    {Object.entries(selectedSnapshot.configSettings || {}).map(([key, val]) => (
                      <div key={key} className="flex items-start gap-2">
                        <span className="text-muted-foreground text-sm font-mono w-40 shrink-0">{key}:</span>
                        <span className="text-white text-sm">
                          {Array.isArray(val) ? val.join(", ") : typeof val === "object" ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "ports" && (
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="text-muted-foreground text-left">
                        <tr><th className="pb-2">Port</th><th className="pb-2">Protocol</th><th className="pb-2">Address</th></tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {(selectedSnapshot.openPorts || []).map((p: any, i: number) => (
                          <tr key={i} className="border-t border-border">
                            <td className="py-1 font-mono">{p.port}</td>
                            <td className="py-1">{p.protocol}</td>
                            <td className="py-1 text-xs">{p.address}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {snapshots.length === 0 && !loading && (
            <div className="bg-zinc-800 rounded-lg border border-border p-8 text-center text-muted-foreground">
              No posture snapshots yet. Deploy agent v0.5.5+ to start collecting.
            </div>
          )}
        </>
      )}
    </div>
  );
}
