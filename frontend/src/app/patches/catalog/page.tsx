'use client';

import { useState, useEffect } from 'react';
import { API_BASE } from '@/lib/api-config';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Server, CheckCircle, XCircle, Clock } from 'lucide-react';

interface PatchDetail {
  id: string; kb_id: string; title: string; description: string;
  severity: string; category: string; is_approved: boolean; is_excluded: boolean;
  os_targets: string[]; release_date: string; supersedes: string[];
  approved_by: string; approved_at: string; created_at: string;
  affected_nodes: Array<{
    node_id: string; hostname: string; status: string; detected_at: string; installed_at: string; error_message: string;
  }>;
}

export default function PatchCatalogPage() {
  const searchParams = useSearchParams();
  const patchId = searchParams.get('id');
  const [patch, setPatch] = useState<PatchDetail|null>(null);
  const [loading, setLoading] = useState(true);
  const getToken = () => localStorage.getItem('token');

  useEffect(() => {
    if (!patchId) { setLoading(false); return; }
    const token = getToken();
    fetch(`${API_BASE}/patches/catalog/${patchId}`, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json()).then(d => { setPatch(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [patchId]);

  if (!patchId) return (
    <div className="p-6"><p className="text-muted-foreground">Select a patch from the <Link href="/patches" className="text-cyan-400">catalog</Link> to view details.</p></div>
  );
  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!patch) return <div className="p-6 text-muted-foreground">Patch not found.</div>;

  const statusIcon = (s: string) => {
    switch(s) {
      case 'installed': return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-400" />;
      case 'excluded': return <XCircle className="h-4 w-4 text-muted-foreground" />;
      default: return <Clock className="h-4 w-4 text-yellow-400" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Link href="/patches" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" /> Back to Patches</Link>
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">{patch.title}</h1>
            {patch.kb_id && <p className="text-sm font-mono text-muted-foreground mt-1">{patch.kb_id}</p>}
          </div>
          <div className="flex gap-2">
            <span className={`px-2 py-1 rounded text-xs font-medium ${patch.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}`}>{patch.severity}</span>
            <span className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground">{patch.category}</span>
          </div>
        </div>
        {patch.description && <p className="mt-4 text-sm text-muted-foreground">{patch.description}</p>}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-muted-foreground">Status:</span> <span className={patch.is_excluded ? 'text-red-400' : patch.is_approved ? 'text-green-400' : 'text-yellow-400'}>{patch.is_excluded ? 'Excluded' : patch.is_approved ? 'Approved' : 'Pending'}</span></div>
          {patch.approved_by && <div><span className="text-muted-foreground">Approved by:</span> <span className="text-foreground">{patch.approved_by}</span></div>}
          {patch.release_date && <div><span className="text-muted-foreground">Released:</span> <span className="text-foreground">{new Date(patch.release_date).toLocaleDateString()}</span></div>}
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2"><Server className="h-5 w-5" /> Affected Nodes ({patch.affected_nodes.length})</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left p-2">Hostname</th><th className="text-left p-2">Status</th>
            <th className="text-left p-2">Detected</th><th className="text-left p-2">Installed</th><th className="text-left p-2">Error</th>
          </tr></thead>
          <tbody>
            {patch.affected_nodes.map(n => (
              <tr key={n.node_id} className="border-b border-border">
                <td className="p-2 text-foreground">{n.hostname || n.node_id}</td>
                <td className="p-2 flex items-center gap-1">{statusIcon(n.status)} {n.status}</td>
                <td className="p-2 text-muted-foreground text-xs">{n.detected_at ? new Date(n.detected_at).toLocaleDateString() : '—'}</td>
                <td className="p-2 text-muted-foreground text-xs">{n.installed_at ? new Date(n.installed_at).toLocaleDateString() : '—'}</td>
                <td className="p-2 text-red-400 text-xs">{n.error_message || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
