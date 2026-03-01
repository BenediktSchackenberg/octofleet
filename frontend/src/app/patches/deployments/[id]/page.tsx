'use client';

import { useState, useEffect } from 'react';
import { API_BASE } from '@/lib/api-config';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pause, Play, XCircle, CheckCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react';

interface DeploymentDetail {
  id: string; name: string; status: string; ring_name: string;
  reboot_policy: string; reboot_schedule_time: string;
  started_at: string; completed_at: string; created_at: string; created_by: string;
  summary: { total: number; installed: number; failed: number; pending: number; in_progress: number; };
  results: Array<{
    id: string; node_id: string; hostname: string; patch_id: string;
    patch_title: string; kb_id: string; status: string;
    error_message: string; reboot_required: boolean; completed_at: string;
  }>;
}

export default function DeploymentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [dep, setDep] = useState<DeploymentDetail|null>(null);
  const [loading, setLoading] = useState(true);
  const getToken = () => localStorage.getItem('token');

  const fetchData = async () => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/patches/deployments/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) setDep(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 10000); return () => clearInterval(iv); }, [id]);

  const doAction = async (action: string) => {
    const token = getToken();
    await fetch(`${API_BASE}/patches/deployments/${id}/${action}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
    });
    fetchData();
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!dep) return <div className="p-6 text-muted-foreground">Deployment not found.</div>;

  const pct = dep.summary.total > 0 ? Math.round(dep.summary.installed / dep.summary.total * 100) : 0;

  const statusIcon = (s: string) => {
    switch(s) {
      case 'installed': return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-400" />;
      case 'downloading': case 'installing': return <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-yellow-400" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Link href="/patches" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" /> Back to Patches</Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{dep.name}</h1>
          <p className="text-sm text-muted-foreground">Ring: {dep.ring_name || 'All Nodes'} · Reboot: {dep.reboot_policy} · By: {dep.created_by}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            dep.status === 'completed' ? 'bg-green-500/10 text-green-400' :
            dep.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' :
            dep.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400' :
            dep.status === 'cancelled' ? 'bg-red-500/10 text-red-400' :
            'bg-muted text-muted-foreground'
          }`}>{dep.status}</span>
          {dep.status === 'in_progress' && (
            <button onClick={() => doAction('pause')} className="px-3 py-1.5 bg-yellow-600/20 text-yellow-400 rounded-lg text-sm flex items-center gap-1">
              <Pause className="h-4 w-4" /> Pause
            </button>
          )}
          {dep.status === 'paused' && (
            <button onClick={() => doAction('resume')} className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg text-sm flex items-center gap-1">
              <Play className="h-4 w-4" /> Resume
            </button>
          )}
          {['pending','in_progress','paused'].includes(dep.status) && (
            <button onClick={() => doAction('cancel')} className="px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-sm flex items-center gap-1">
              <XCircle className="h-4 w-4" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Progress</span>
          <span className="text-sm font-medium text-foreground">{pct}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-3">
          <div className="bg-green-500 h-3 rounded-full transition-all" style={{width:`${pct}%`}}></div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 text-center">
          <div><div className="text-lg font-bold text-foreground">{dep.summary.total}</div><div className="text-xs text-muted-foreground">Total</div></div>
          <div><div className="text-lg font-bold text-green-400">{dep.summary.installed}</div><div className="text-xs text-muted-foreground">Installed</div></div>
          <div><div className="text-lg font-bold text-blue-400">{dep.summary.in_progress}</div><div className="text-xs text-muted-foreground">In Progress</div></div>
          <div><div className="text-lg font-bold text-red-400">{dep.summary.failed}</div><div className="text-xs text-muted-foreground">Failed</div></div>
        </div>
      </div>

      {/* Results table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left p-3">Node</th><th className="text-left p-3">Patch</th>
            <th className="text-left p-3">Status</th><th className="text-left p-3">Completed</th><th className="text-left p-3">Error</th>
          </tr></thead>
          <tbody>
            {dep.results.map(r => (
              <tr key={r.id} className="border-b border-border hover:bg-muted/50">
                <td className="p-3 text-foreground">{r.hostname || r.node_id}</td>
                <td className="p-3"><span className="text-foreground">{r.patch_title}</span>{r.kb_id && <span className="ml-1 text-xs font-mono text-muted-foreground">{r.kb_id}</span>}</td>
                <td className="p-3 flex items-center gap-1">{statusIcon(r.status)} {r.status}{r.reboot_required && <AlertTriangle className="h-3 w-3 text-yellow-400 ml-1" aria-label="Reboot required" />}</td>
                <td className="p-3 text-muted-foreground text-xs">{r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}</td>
                <td className="p-3 text-red-400 text-xs max-w-xs truncate">{r.error_message || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
