'use client';

import { useState, useEffect } from 'react';
import { API_BASE } from '@/lib/api-config';
import { getAuthHeader } from '@/lib/auth-context';
import Link from 'next/link';
import {
  Shield, Package, CheckCircle, XCircle, AlertTriangle, Clock,
  Layers, Rocket, BarChart3, RefreshCw, Plus, ChevronRight
} from 'lucide-react';

interface ComplianceData {
  total_patches: number;
  approved: number;
  compliance_percent: number;
  installed: number;
  failed: number;
  pending: number;
  mttp_hours: number | null;
  active_deployments: number;
  rings: Array<{ id: string; name: string; total: number; installed: number }>;
}

interface PatchItem {
  id: string; kb_id: string; title: string; severity: string;
  category: string; is_approved: boolean; is_excluded: boolean; created_at: string;
}

interface Ring {
  id: string; name: string; description: string; priority: number; delay_hours: number;
}

interface Deployment {
  id: string; name: string; status: string; ring_name: string; created_at: string;
  reboot_policy: string;
}

export default function PatchesPage() {
  const [tab, setTab] = useState<'catalog'|'rings'|'deployments'|'compliance'>('catalog');
  const [compliance, setCompliance] = useState<ComplianceData|null>(null);
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [rings, setRings] = useState<Ring[]>([]);
  const [showRingForm, setShowRingForm] = useState(false);
  const [ringForm, setRingForm] = useState({ name: '', description: '', delay_hours: 0 });

  const createRing = async () => {
    try {
      const res = await fetch(`${API_BASE}/patches/rings`, {
        method: 'POST', headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ringForm.name, description: ringForm.description, delay_hours: ringForm.delay_hours, sort_order: rings.length + 1 }),
      });
      if (res.ok) { setShowRingForm(false); setRingForm({ name: '', description: '', delay_hours: 0 }); fetchAll(); }
    } catch (e) { console.error(e); }
  };
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  const getToken = () => localStorage.getItem('token');

  const fetchAll = async () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const [compRes, catRes, ringRes, depRes] = await Promise.all([
        fetch(`${API_BASE}/patches/compliance`, { headers }),
        fetch(`${API_BASE}/patches/catalog?limit=100${search ? `&search=${search}` : ''}${severityFilter ? `&severity=${severityFilter}` : ''}`, { headers }),
        fetch(`${API_BASE}/patches/rings`, { headers }),
        fetch(`${API_BASE}/patches/deployments?limit=50`, { headers }),
      ]);
      if (compRes.ok) setCompliance(await compRes.json());
      if (catRes.ok) { const d = await catRes.json(); setPatches(d.items || []); }
      if (ringRes.ok) setRings(await ringRes.json());
      if (depRes.ok) setDeployments(await depRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [search, severityFilter]);

  const approvePatch = async (id: string) => {
    const token = getToken();
    await fetch(`${API_BASE}/patches/catalog/${id}/approve`, {
      method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
    });
    fetchAll();
  };

  const excludePatch = async (id: string) => {
    const token = getToken();
    await fetch(`${API_BASE}/patches/catalog/${id}/exclude`, {
      method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
    });
    fetchAll();
  };

  const severityColor = (s: string) => {
    switch(s) {
      case 'critical': return 'text-red-400 bg-red-500/10';
      case 'important': return 'text-orange-400 bg-orange-500/10';
      case 'moderate': return 'text-yellow-400 bg-yellow-500/10';
      default: return 'text-blue-400 bg-blue-500/10';
    }
  };

  const statusColor = (s: string) => {
    switch(s) {
      case 'completed': return 'text-green-400 bg-green-500/10';
      case 'in_progress': return 'text-blue-400 bg-blue-500/10';
      case 'paused': return 'text-yellow-400 bg-yellow-500/10';
      case 'cancelled': return 'text-red-400 bg-red-500/10';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-7 w-7 text-cyan-400" /> Patch Management
          </h1>
          <p className="text-muted-foreground mt-1">Manage Windows Updates, deployment rings, and compliance</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchAll} className="px-3 py-2 bg-card border border-border rounded-lg hover:bg-muted transition-colors">
            <RefreshCw className="h-4 w-4" />
          </button>
          <Link href="/patches/deployments/new" className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors flex items-center gap-2">
            <Plus className="h-4 w-4" /> New Deployment
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      {compliance && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Package className="h-4 w-4" /> Total Patches</div>
            <div className="text-2xl font-bold mt-1 text-foreground">{compliance.total_patches}</div>
            <div className="text-xs text-muted-foreground">{compliance.approved} approved</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Clock className="h-4 w-4" /> Pending</div>
            <div className="text-2xl font-bold mt-1 text-yellow-400">{compliance.pending}</div>
            <div className="text-xs text-muted-foreground">{compliance.failed} failed</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><BarChart3 className="h-4 w-4" /> Compliance</div>
            <div className="text-2xl font-bold mt-1 text-green-400">{compliance.compliance_percent}%</div>
            <div className="text-xs text-muted-foreground">MTTP: {compliance.mttp_hours ? `${compliance.mttp_hours}h` : 'N/A'}</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Rocket className="h-4 w-4" /> Active Deployments</div>
            <div className="text-2xl font-bold mt-1 text-cyan-400">{compliance.active_deployments}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
        {(['catalog','rings','deployments','compliance'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-cyan-600 text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}>{t}</button>
        ))}
      </div>

      {/* Catalog Tab */}
      {tab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search patches..." className="flex-1 px-3 py-2 bg-card border border-border rounded-lg text-foreground" />
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
              className="px-3 py-2 bg-card border border-border rounded-lg text-foreground">
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="important">Important</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3">KB ID</th><th className="text-left p-3">Title</th>
                <th className="text-left p-3">Severity</th><th className="text-left p-3">Category</th>
                <th className="text-left p-3">Status</th><th className="text-left p-3">Actions</th>
              </tr></thead>
              <tbody>
                {patches.map(p => (
                  <tr key={p.id} className="border-b border-border hover:bg-muted/50">
                    <td className="p-3 font-mono text-xs">{p.kb_id || '—'}</td>
                    <td className="p-3">
                      <Link href={`/patches/catalog?id=${p.id}`} className="text-foreground hover:text-cyan-400">{p.title}</Link>
                    </td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColor(p.severity)}`}>{p.severity}</span></td>
                    <td className="p-3 text-muted-foreground">{p.category}</td>
                    <td className="p-3">
                      {p.is_excluded ? <span className="text-red-400 text-xs">Excluded</span> :
                       p.is_approved ? <span className="text-green-400 text-xs">Approved</span> :
                       <span className="text-yellow-400 text-xs">Pending</span>}
                    </td>
                    <td className="p-3 flex gap-2">
                      {!p.is_approved && !p.is_excluded && (
                        <button onClick={() => approvePatch(p.id)} className="text-xs px-2 py-1 bg-green-600/20 text-green-400 rounded hover:bg-green-600/30">Approve</button>
                      )}
                      {!p.is_excluded && (
                        <button onClick={() => excludePatch(p.id)} className="text-xs px-2 py-1 bg-red-600/20 text-red-400 rounded hover:bg-red-600/30">Exclude</button>
                      )}
                    </td>
                  </tr>
                ))}
                {patches.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No patches found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rings Tab */}
      {tab === 'rings' && (
        <div className="space-y-4">
          {!showRingForm ? (
            <button onClick={() => setShowRingForm(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <Plus className="h-4 w-4" /> New Ring
            </button>
          ) : (
            <div className="bg-card border border-cyan-500/30 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Create Patch Ring</h3>
              <div className="grid grid-cols-3 gap-3">
                <input type="text" placeholder="Ring name" value={ringForm.name} onChange={e => setRingForm({...ringForm, name: e.target.value})} className="bg-background border border-border rounded px-3 py-2 text-sm text-foreground" />
                <input type="text" placeholder="Description" value={ringForm.description} onChange={e => setRingForm({...ringForm, description: e.target.value})} className="bg-background border border-border rounded px-3 py-2 text-sm text-foreground" />
                <input type="number" placeholder="Delay (hours)" value={ringForm.delay_hours} onChange={e => setRingForm({...ringForm, delay_hours: parseInt(e.target.value)||0})} className="bg-background border border-border rounded px-3 py-2 text-sm text-foreground" />
              </div>
              <div className="flex gap-2">
                <button onClick={createRing} className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded text-sm">Create</button>
                <button onClick={() => setShowRingForm(false)} className="bg-muted hover:bg-muted/80 text-muted-foreground px-4 py-2 rounded text-sm">Cancel</button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {rings.map(r => (
              <div key={r.id} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-cyan-400" />
                  <h3 className="font-semibold text-foreground">{r.name}</h3>
                  <span className="text-xs text-muted-foreground ml-auto">Priority {r.priority}</span>
                </div>
                {r.description && <p className="text-sm text-muted-foreground mt-2">{r.description}</p>}
                <div className="text-xs text-muted-foreground mt-2">Delay: {r.delay_hours}h after previous ring</div>
              </div>
            ))}
            {rings.length === 0 && <div className="col-span-3 text-center text-muted-foreground py-8">No rings configured. Create rings to organize patch rollouts.</div>}
          </div>
        </div>
      )}

      {/* Deployments Tab */}
      {tab === 'deployments' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-muted-foreground">
                <th className="text-left p-3">Name</th><th className="text-left p-3">Ring</th>
                <th className="text-left p-3">Status</th><th className="text-left p-3">Reboot Policy</th>
                <th className="text-left p-3">Created</th><th className="text-left p-3"></th>
              </tr></thead>
              <tbody>
                {deployments.map(d => (
                  <tr key={d.id} className="border-b border-border hover:bg-muted/50">
                    <td className="p-3 font-medium text-foreground">{d.name}</td>
                    <td className="p-3 text-muted-foreground">{d.ring_name || '—'}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(d.status)}`}>{d.status}</span></td>
                    <td className="p-3 text-muted-foreground text-xs">{d.reboot_policy}</td>
                    <td className="p-3 text-muted-foreground text-xs">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="p-3">
                      <Link href={`/patches/deployments/${d.id}`} className="text-cyan-400 hover:text-cyan-300">
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
                {deployments.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No deployments yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Compliance Tab */}
      {tab === 'compliance' && compliance && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-semibold text-foreground mb-4">Fleet Compliance Overview</h3>
            <div className="w-full bg-muted rounded-full h-4 mb-4">
              <div className="bg-green-500 h-4 rounded-full transition-all" style={{width: `${compliance.compliance_percent}%`}}></div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><div className="text-2xl font-bold text-green-400">{compliance.installed}</div><div className="text-xs text-muted-foreground">Installed</div></div>
              <div><div className="text-2xl font-bold text-yellow-400">{compliance.pending}</div><div className="text-xs text-muted-foreground">Pending</div></div>
              <div><div className="text-2xl font-bold text-red-400">{compliance.failed}</div><div className="text-xs text-muted-foreground">Failed</div></div>
            </div>
          </div>
          {compliance.rings.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="font-semibold text-foreground mb-4">Per-Ring Compliance</h3>
              {compliance.rings.map(r => (
                <div key={r.id} className="flex items-center gap-4 mb-3">
                  <span className="w-24 text-sm text-foreground">{r.name}</span>
                  <div className="flex-1 bg-muted rounded-full h-3">
                    <div className="bg-cyan-500 h-3 rounded-full" style={{width: `${r.total > 0 ? (r.installed/r.total*100) : 0}%`}}></div>
                  </div>
                  <span className="text-xs text-muted-foreground w-16 text-right">{r.total > 0 ? Math.round(r.installed/r.total*100) : 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
