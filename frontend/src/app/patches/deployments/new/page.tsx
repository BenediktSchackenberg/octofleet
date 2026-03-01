'use client';

import { useState, useEffect } from 'react';
import { API_BASE } from '@/lib/api-config';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Shield, CheckCircle } from 'lucide-react';

interface PatchItem { id: string; kb_id: string; title: string; severity: string; is_approved: boolean; }
interface Ring { id: string; name: string; description: string; }

export default function NewDeploymentPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [patches, setPatches] = useState<PatchItem[]>([]);
  const [rings, setRings] = useState<Ring[]>([]);
  const [selectedPatches, setSelectedPatches] = useState<string[]>([]);
  const [selectedRing, setSelectedRing] = useState('');
  const [name, setName] = useState('');
  const [rebootPolicy, setRebootPolicy] = useState('no_reboot');
  const [creating, setCreating] = useState(false);

  const getToken = () => localStorage.getItem('token');

  useEffect(() => {
    const token = getToken();
    const headers = { 'Authorization': `Bearer ${token}` };
    Promise.all([
      fetch(`${API_BASE}/patches/catalog?approved=true&limit=500`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/patches/rings`, { headers }).then(r => r.json()),
    ]).then(([catData, ringData]) => {
      setPatches(catData.items || []);
      setRings(ringData || []);
    });
  }, []);

  const togglePatch = (id: string) => {
    setSelectedPatches(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const create = async () => {
    setCreating(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/patches/deployments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, patches: selectedPatches, ring_id: selectedRing || null, reboot_policy: rebootPolicy })
    });
    if (res.ok) {
      const data = await res.json();
      router.push(`/patches/deployments/${data.id}`);
    }
    setCreating(false);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <Link href="/patches" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" /> Back to Patches</Link>
      <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Shield className="h-7 w-7 text-cyan-400" /> New Patch Deployment</h1>

      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1,2,3].map(s => (
          <div key={s} className={`flex-1 h-2 rounded-full ${step >= s ? 'bg-cyan-500' : 'bg-muted'}`} />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Select Patches</span><span>Choose Ring & Policy</span><span>Confirm</span>
      </div>

      {/* Step 1: Select Patches */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Select approved patches to deploy:</p>
          <div className="bg-card border border-border rounded-xl max-h-96 overflow-y-auto">
            {patches.map(p => (
              <label key={p.id} className="flex items-center gap-3 p-3 border-b border-border hover:bg-muted/50 cursor-pointer">
                <input type="checkbox" checked={selectedPatches.includes(p.id)} onChange={() => togglePatch(p.id)}
                  className="rounded border-border" />
                <div className="flex-1">
                  <span className="text-foreground text-sm">{p.title}</span>
                  {p.kb_id && <span className="ml-2 text-xs font-mono text-muted-foreground">{p.kb_id}</span>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${p.severity === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-yellow-500/10 text-yellow-400'}`}>{p.severity}</span>
              </label>
            ))}
            {patches.length === 0 && <div className="p-8 text-center text-muted-foreground">No approved patches available. Approve patches first.</div>}
          </div>
          <div className="flex justify-end">
            <button disabled={selectedPatches.length === 0} onClick={() => setStep(2)}
              className="px-4 py-2 bg-cyan-600 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Ring & Policy */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Deployment Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. March 2026 Security Updates"
              className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground" />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Deployment Ring (optional)</label>
            <select value={selectedRing} onChange={e => setSelectedRing(e.target.value)}
              className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground">
              <option value="">All Nodes</option>
              {rings.map(r => <option key={r.id} value={r.id}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Reboot Policy</label>
            <select value={rebootPolicy} onChange={e => setRebootPolicy(e.target.value)}
              className="w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground">
              <option value="no_reboot">No Reboot</option>
              <option value="schedule">Schedule Reboot</option>
              <option value="force">Force Reboot</option>
              <option value="user_choice">User Choice</option>
            </select>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 bg-muted text-foreground rounded-lg">Back</button>
            <button disabled={!name} onClick={() => setStep(3)}
              className="px-4 py-2 bg-cyan-600 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-3">
            <h3 className="font-semibold text-foreground">Deployment Summary</h3>
            <div className="text-sm"><span className="text-muted-foreground">Name:</span> <span className="text-foreground">{name}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Patches:</span> <span className="text-foreground">{selectedPatches.length} selected</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Ring:</span> <span className="text-foreground">{rings.find(r => r.id === selectedRing)?.name || 'All Nodes'}</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Reboot Policy:</span> <span className="text-foreground">{rebootPolicy}</span></div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 bg-muted text-foreground rounded-lg">Back</button>
            <button onClick={create} disabled={creating}
              className="px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" /> {creating ? 'Creating...' : 'Create Deployment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
