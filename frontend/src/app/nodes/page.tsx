"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { Check, X, Clock, Monitor } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Node {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  is_online: boolean;
  last_seen: string;
  agent_version: string;
  cpu_name: string | null;
  total_memory_gb: number | null;
  health_status?: 'healthy' | 'warning' | 'critical';
  alert_count?: number;
}

interface PendingNode {
  id: string;
  hostname: string;
  osName: string;
  osVersion: string;
  ipAddress: string;
  agentVersion: string;
  machineId: string | null;
  createdAt: string;
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        online ? "bg-green-500" : "bg-zinc-500"
      }`}
    />
  );
}

function HealthBadge({ status, count }: { status?: string; count?: number }) {
  if (!status || status === 'healthy') return null;
  
  const colors = {
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    critical: 'bg-red-500/20 text-red-400 border-red-500/50'
  };
  
  const icons = { warning: '⚠️', critical: '🔴' };
  
  return (
    <span className={`ml-2 px-2 py-0.5 text-xs rounded border ${colors[status as keyof typeof colors] || ''}`}>
      {icons[status as keyof typeof icons]} {count || 1}
    </span>
  );
}

function formatLastSeen(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  if (diffHours < 24) return `vor ${diffHours} Std`;
  return `vor ${diffDays} Tagen`;
}

function PendingNodesSection({ 
  pendingNodes, 
  onApprove, 
  onReject,
  approving 
}: { 
  pendingNodes: PendingNode[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  approving: string | null;
}) {
  if (pendingNodes.length === 0) return null;

  return (
    <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-5 w-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-amber-400">
          Wartende Genehmigungen ({pendingNodes.length})
        </h2>
      </div>
      
      <div className="space-y-3">
        {pendingNodes.map((node) => (
          <div 
            key={node.id}
            className="bg-zinc-900/80 rounded-lg p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <Monitor className="h-8 w-8 text-amber-400" />
              <div>
                <div className="font-medium text-zinc-100">{node.hostname}</div>
                <div className="text-sm text-zinc-400">
                  {node.osName} • {node.ipAddress} • Agent {node.agentVersion || "?"}
                </div>
                <div className="text-xs text-zinc-500">
                  Registriert {formatLastSeen(node.createdAt)}
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(node.id)}
                disabled={approving === node.id}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-800 text-white rounded-lg transition-colors"
              >
                {approving === node.id ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Genehmigen
              </button>
              <button
                onClick={() => onReject(node.id)}
                disabled={approving === node.id}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-red-600 text-zinc-300 hover:text-white rounded-lg transition-colors"
              >
                <X className="h-4 w-4" />
                Ablehnen
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [pendingNodes, setPendingNodes] = useState<PendingNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  useEffect(() => {
    fetchNodes();
    fetchPendingNodes();
  }, []);

  async function fetchNodes() {
    try {
      const res = await fetch(`${API_URL}/api/v1/nodes`, {
        headers: { ...getAuthHeader() },
      });
      const data = await res.json();
      setNodes(data.nodes || []);
    } catch (err) {
      console.error("Failed to fetch nodes:", err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPendingNodes() {
    try {
      const res = await fetch(`${API_URL}/api/v1/pending-nodes`, {
        headers: { ...getAuthHeader() },
      });
      const data = await res.json();
      setPendingNodes(data.pending || []);
    } catch (err) {
      console.error("Failed to fetch pending nodes:", err);
    }
  }

  async function handleApprove(pendingId: string) {
    setApproving(pendingId);
    try {
      const res = await fetch(`${API_URL}/api/v1/pending-nodes/${pendingId}/approve`, {
        method: "POST",
        headers: { ...getAuthHeader() },
      });
      
      if (res.ok) {
        // Refresh both lists
        await fetchPendingNodes();
        await fetchNodes();
      } else {
        console.error("Failed to approve node");
      }
    } catch (err) {
      console.error("Failed to approve node:", err);
    } finally {
      setApproving(null);
    }
  }

  async function handleReject(pendingId: string) {
    if (!confirm("Node wirklich ablehnen?")) return;
    
    setApproving(pendingId);
    try {
      const res = await fetch(`${API_URL}/api/v1/pending-nodes/${pendingId}/reject`, {
        method: "DELETE",
        headers: { ...getAuthHeader() },
      });
      
      if (res.ok) {
        await fetchPendingNodes();
      }
    } catch (err) {
      console.error("Failed to reject node:", err);
    } finally {
      setApproving(null);
    }
  }

  const filteredNodes = nodes.filter(
    (node) => {
      const matchesSearch = node.hostname.toLowerCase().includes(search.toLowerCase()) ||
        node.node_id.toLowerCase().includes(search.toLowerCase()) ||
        (node.os_name && node.os_name.toLowerCase().includes(search.toLowerCase()));
      
      const matchesIssueFilter = !showOnlyIssues || 
        (node.health_status && node.health_status !== 'healthy');
      
      return matchesSearch && matchesIssueFilter;
    }
  );

  const onlineCount = nodes.filter((n) => n.is_online).length;
  const issueCount = nodes.filter((n) => n.health_status && n.health_status !== 'healthy').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto p-6">
        {/* Breadcrumb */}
        <Breadcrumb items={[{ label: "Nodes" }]} />
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">🖥️ Nodes</h1>
            <p className="text-zinc-400 text-sm">
              {onlineCount} von {nodes.length} online
              {pendingNodes.length > 0 && (
                <span className="ml-2 text-amber-400">
                  • {pendingNodes.length} wartend
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Pending Nodes Section */}
        <PendingNodesSection 
          pendingNodes={pendingNodes}
          onApprove={handleApprove}
          onReject={handleReject}
          approving={approving}
        />

        {/* Search & Filters */}
        <div className="mb-4 flex flex-wrap gap-4 items-center">
          <input
            type="text"
            placeholder="Suchen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full md:w-80 px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          
          {issueCount > 0 && (
            <button
              onClick={() => setShowOnlyIssues(!showOnlyIssues)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                showOnlyIssues 
                  ? 'bg-red-500/20 border-red-500 text-red-400' 
                  : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-red-500'
              }`}
            >
              🔴 Nur Probleme ({issueCount})
            </button>
          )}
        </div>

        {/* Nodes Table */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                <th className="p-4">Status</th>
                <th className="p-4">Hostname</th>
                <th className="p-4 hidden md:table-cell">Betriebssystem</th>
                <th className="p-4 hidden lg:table-cell">Agent</th>
                <th className="p-4">Zuletzt gesehen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredNodes.map((node) => (
                <tr
                  key={node.id}
                  className="hover:bg-zinc-800/50 transition-colors"
                >
                  <td className="p-4">
                    <StatusDot online={node.is_online} />
                  </td>
                  <td className="p-4">
                    <Link
                      href={`/nodes/${node.node_id}`}
                      className="text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {node.hostname}
                    </Link>
                    <HealthBadge status={node.health_status} count={node.alert_count} />
                  </td>
                  <td className="p-4 hidden md:table-cell text-sm text-zinc-400">
                    {node.os_name}
                  </td>
                  <td className="p-4 hidden lg:table-cell text-sm text-zinc-500">
                    {node.agent_version || "-"}
                  </td>
                  <td className="p-4 text-sm text-zinc-500">
                    {formatLastSeen(node.last_seen)}
                  </td>
                </tr>
              ))}

              {filteredNodes.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">
                    {search ? "Keine Nodes gefunden" : "Keine Nodes vorhanden"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
