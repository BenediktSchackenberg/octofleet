import { apiClient } from "@/lib/api-client";
'use client';

import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '@/lib/api-config';
import { PageHeader } from "@/components/ui/PageHeader";
import { 
  Shield, Package, Plus, Play, CheckCircle, 
  XCircle, AlertTriangle, Clock, RefreshCw,
  Wifi, WifiOff, Search, ArrowUpDown, ArrowUp, ArrowDown,
  Loader2, Filter
} from 'lucide-react';

interface RemediationJob {
  id: number;
  vulnerability_id: number;
  remediation_package_id: number;
  node_id: string;
  software_name: string;
  software_version: string;
  cve_id: string;
  status: string;
  requires_approval: boolean;
  created_at: string;
  package_name?: string;
  fix_method?: string;
}

interface RemediationPackage {
  id: number;
  name: string;
  description: string;
  target_software: string;
  min_fixed_version: string | null;
  fix_method: string;
  fix_command: string;
  enabled: boolean;
}

interface RemediationRule {
  id: number;
  name: string;
  description: string;
  min_severity: string;
  software_pattern: string | null;
  auto_remediate: boolean;
  require_approval: boolean;
  enabled: boolean;
}

interface Summary {
  job_counts: Record<string, number>;
  recent_jobs: RemediationJob[];
  active_packages: number;
  active_rules: number;
  fixable_vulnerabilities: number;
  in_maintenance_window: boolean;
}

type SortField = 'id' | 'software_name' | 'cve_id' | 'status' | 'created_at';
type SortDir = 'asc' | 'desc';

const STATUS_OPTIONS = ['all', 'success', 'failed', 'pending', 'approved', 'running', 'skipped', 'rolled_back'] as const;

export default function RemediationPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [packages, setPackages] = useState<RemediationPackage[]>([]);
  const [rules, setRules] = useState<RemediationRule[]>([]);
  const [jobs, setJobs] = useState<RemediationJob[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'packages' | 'rules' | 'jobs'>('dashboard');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  // Filters & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const getToken = () => localStorage.getItem('token');

  const fetchData = async () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      const [summaryRes, packagesRes, rulesRes, jobsRes] = await Promise.all([
        apiClient.get(`/remediation/summary`, { showErrorToast: false }),
        apiClient.get(`/remediation/packages`, { showErrorToast: false }),
        apiClient.get(`/remediation/rules`, { showErrorToast: false }),
        apiClient.get(`/remediation/jobs?limit=500`, { showErrorToast: false }),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (packagesRes.ok) { const d = await packagesRes.json(); setPackages(d.packages || []); }
      if (rulesRes.ok) { const d = await rulesRes.json(); setRules(d.rules || []); }
      if (jobsRes.ok) { const d = await jobsRes.json(); setJobs(d.jobs || []); }
    } catch (error) { console.error('Error fetching remediation data:', error); }
    setLoading(false);
  };

  const fetchSummary = async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await apiClient.get(`/remediation/summary`, { showErrorToast: false });
      if (res.ok) setSummary(await res.json());
    } catch (e) {}
  };

  // SSE for live job updates
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const eventSource = new EventSource(`${API_BASE}/remediation/live?token=${token}`);
    eventSource.onopen = () => setLiveConnected(true);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job_update') {
          setJobs(prev => {
            const idx = prev.findIndex(j => j.id === data.job.id);
            if (idx >= 0) { const u = [...prev]; u[idx] = data.job; return u; }
            return [data.job, ...prev];
          });
          fetchSummary();
        }
      } catch (e) { console.error('SSE parse error:', e); }
    };
    eventSource.onerror = () => { setLiveConnected(false); eventSource.close(); };
    return () => { eventSource.close(); setLiveConnected(false); };
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => { if (!liveConnected) fetchData(); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Running jobs (always visible)
  const runningJobs = useMemo(() => jobs.filter(j => j.status === 'running'), [jobs]);

  // Filtered + sorted jobs for table
  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(j => j.status === statusFilter);
    }

    // Search (software, CVE, ID)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(j =>
        j.software_name?.toLowerCase().includes(q) ||
        j.cve_id?.toLowerCase().includes(q) ||
        String(j.id).includes(q) ||
        j.fix_method?.toLowerCase().includes(q) ||
        j.node_id?.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'id') cmp = a.id - b.id;
      else if (sortField === 'created_at') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else {
        const aVal = (a[sortField] || '').toString().toLowerCase();
        const bVal = (b[sortField] || '').toString().toLowerCase();
        cmp = aVal.localeCompare(bVal);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [jobs, statusFilter, searchQuery, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const runScan = async (dryRun: boolean = true) => {
    const token = getToken();
    if (!token) { alert('Not authenticated.'); return; }
    setScanning(true);
    setScanResult(null);
    try {
      const res = await apiClient.post(`/remediation/scan`, { severity_filter: ['CRITICAL', 'HIGH'], dry_run: dryRun }, { showErrorToast: false });
      if (res.ok) {
        const result = await res.json();
        setScanResult(result);
        if (!dryRun) fetchData();
      } else {
        const errorText = await res.text();
        alert(`Scan failed: ${res.status} - ${errorText}`);
      }
    } catch (error) { alert(`Scan error: ${error}`); }
    setScanning(false);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      approved: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      running: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      success: 'bg-green-500/20 text-green-400 border-green-500/30',
      failed: 'bg-red-500/20 text-red-400 border-red-500/30',
      rolled_back: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      skipped: 'bg-zinc-500/20 text-zinc-400 border-zinc-600/30',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.pending}`}>
        {status}
      </span>
    );
  };

  const getMethodBadge = (method: string) => {
    const colors: Record<string, string> = {
      winget: 'bg-blue-600', choco: 'bg-orange-600', package: 'bg-purple-600', script: 'bg-green-600',
    };
    return <span className={`px-2 py-0.5 rounded text-xs text-white ${colors[method] || 'bg-zinc-600'}`}>{method}</span>;
  };

  if (loading && !summary) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-[1920px] mx-auto px-4 py-8">
        {/* Header */}
        <PageHeader
          title="🛡️ Auto-Remediation"
          description="Automatically fix vulnerabilities across your fleet"
          actions={
            <div className="flex items-center gap-2">
              {liveConnected ? (
                <span className="flex items-center gap-1 text-xs font-normal text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                  <Wifi className="h-3 w-3" /> Live
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-normal text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                  <WifiOff className="h-3 w-3" /> Offline
                </span>
              )}
              <button onClick={() => runScan(true)} disabled={scanning}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg flex items-center gap-2 disabled:opacity-50 text-sm">
                <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} /> Dry Run
              </button>
              <button onClick={() => runScan(false)} disabled={scanning}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg flex items-center gap-2 disabled:opacity-50 text-sm">
                <Play className="h-4 w-4" /> Run Remediation
              </button>
            </div>
          }
        />

        {/* Stats + Running Jobs Row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
          {/* Stats */}
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Fixed', value: summary?.job_counts?.success || 0, icon: CheckCircle, color: 'green' },
              { label: 'Pending', value: summary?.job_counts?.approved || 0, icon: Clock, color: 'blue' },
              { label: 'Failed', value: summary?.job_counts?.failed || 0, icon: XCircle, color: 'red' },
              { label: 'Fixable CVEs', value: summary?.fixable_vulnerabilities || 0, icon: AlertTriangle, color: 'yellow' },
            ].map(s => (
              <button key={s.label} onClick={() => {
                if (s.label === 'Fixed') { setStatusFilter('success'); setActiveTab('dashboard'); }
                else if (s.label === 'Pending') { setStatusFilter('approved'); setActiveTab('dashboard'); }
                else if (s.label === 'Failed') { setStatusFilter('failed'); setActiveTab('dashboard'); }
              }}
                className="bg-zinc-900 rounded-xl p-4 border border-zinc-700 hover:border-zinc-500 transition-colors text-left">
                <div className="flex items-center gap-3">
                  <div className={`p-2 bg-${s.color}-500/20 rounded-lg`}>
                    <s.icon className={`h-5 w-5 text-${s.color}-500`} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-zinc-400 text-sm">{s.label}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Running Jobs Panel */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-700 flex items-center gap-2">
              <Loader2 className={`h-4 w-4 text-purple-400 ${runningJobs.length > 0 ? 'animate-spin' : ''}`} />
              <span className="text-sm font-semibold">Running Jobs</span>
              <span className="ml-auto text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                {runningJobs.length}
              </span>
            </div>
            <div className="max-h-[160px] overflow-y-auto">
              {runningJobs.length === 0 ? (
                <div className="p-4 text-center text-zinc-500 text-sm">No jobs running</div>
              ) : (
                runningJobs.map(j => (
                  <div key={j.id} className="px-4 py-2 border-b border-zinc-800 last:border-0 hover:bg-zinc-800/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{j.software_name}</span>
                      <span className="text-xs font-mono text-purple-400">#{j.id}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-zinc-500 font-mono">{j.cve_id}</span>
                      {j.fix_method && getMethodBadge(j.fix_method)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Scan Result */}
        {scanResult && (
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-700 mb-6">
            <h3 className="font-semibold mb-2">Scan Result</h3>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="text-zinc-400">Scanned:</span> <span className="font-mono">{scanResult.scanned}</span></div>
              <div><span className="text-zinc-400">With Fix:</span> <span className="font-mono text-green-400">{scanResult.with_fix_available}</span></div>
              <div><span className="text-zinc-400">Jobs Created:</span> <span className="font-mono text-blue-400">{scanResult.jobs_created}</span></div>
              <div><span className="text-zinc-400">Skipped:</span> <span className="font-mono">{scanResult.jobs_skipped_existing}</span></div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-4 border-b border-zinc-700 pb-2">
          {(['dashboard', 'packages', 'rules', 'jobs'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-t-lg capitalize text-sm ${
                activeTab === tab ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}>
              {tab === 'dashboard' ? 'Jobs' : tab}
            </button>
          ))}
        </div>

        {/* Dashboard / Jobs Tab */}
        {(activeTab === 'dashboard' || activeTab === 'jobs') && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-700">
            {/* Filter Bar */}
            <div className="p-4 border-b border-zinc-700 flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search software, CVE, ID, node..."
                  className="w-full pl-10 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-500 placeholder-zinc-500"
                />
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1">
                <Filter className="h-4 w-4 text-zinc-500" />
                <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
                  {STATUS_OPTIONS.map(s => (
                    <button key={s} onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                        statusFilter === s
                          ? 'bg-zinc-600 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Result count */}
              <span className="text-xs text-zinc-500">
                {filteredJobs.length} of {jobs.length} jobs
              </span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50">
                  <tr>
                    {([
                      ['id', 'ID'],
                      ['software_name', 'Software'],
                      ['cve_id', 'CVE'],
                      ['status', 'Status'],
                      ['created_at', 'Created'],
                    ] as [SortField, string][]).map(([field, label]) => (
                      <th key={field}
                        onClick={() => toggleSort(field)}
                        className="text-left p-3 text-zinc-400 font-medium text-sm cursor-pointer hover:text-white select-none">
                        <div className="flex items-center gap-1">
                          {label}
                          <SortIcon field={field} />
                        </div>
                      </th>
                    ))}
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Fix Method</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Node</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredJobs.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-zinc-500">No jobs match your filters</td></tr>
                  ) : (
                    filteredJobs.map(job => (
                      <tr key={job.id} className={`hover:bg-zinc-800/30 ${job.status === 'running' ? 'bg-purple-500/5' : ''}`}>
                        <td className="p-3 font-mono text-sm">{job.id}</td>
                        <td className="p-3">
                          <div className="font-medium">{job.software_name}</div>
                          <div className="text-zinc-500 text-xs">{job.software_version}</div>
                        </td>
                        <td className="p-3">
                          <a href={`https://nvd.nist.gov/vuln/detail/${job.cve_id}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-blue-400 hover:underline font-mono text-sm">
                            {job.cve_id}
                          </a>
                        </td>
                        <td className="p-3">{getStatusBadge(job.status)}</td>
                        <td className="p-3 text-zinc-400 text-sm whitespace-nowrap">
                          {new Date(job.created_at).toLocaleString()}
                        </td>
                        <td className="p-3">{getMethodBadge(job.fix_method || 'unknown')}</td>
                        <td className="p-3 font-mono text-xs text-zinc-500">{job.node_id?.slice(0, 8)}…</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Packages Tab */}
        {activeTab === 'packages' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-700">
            <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
              <h2 className="font-semibold">Fix Packages</h2>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" /> Add Package
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50">
                  <tr>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Name</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Target Software</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Method</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Command</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {packages.map(pkg => (
                    <tr key={pkg.id} className="hover:bg-zinc-800/30">
                      <td className="p-3 font-medium">{pkg.name}</td>
                      <td className="p-3">{pkg.target_software}</td>
                      <td className="p-3">{getMethodBadge(pkg.fix_method)}</td>
                      <td className="p-3"><code className="bg-zinc-800 px-2 py-1 rounded text-xs">{pkg.fix_command}</code></td>
                      <td className="p-3">{pkg.enabled ? <span className="text-green-400">●</span> : <span className="text-zinc-500">○</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-700">
            <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
              <h2 className="font-semibold">Remediation Rules</h2>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" /> Add Rule
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-800/50">
                  <tr>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Name</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Min Severity</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Auto Fix</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Approval</th>
                    <th className="text-left p-3 text-zinc-400 font-medium text-sm">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {rules.map(rule => (
                    <tr key={rule.id} className="hover:bg-zinc-800/30">
                      <td className="p-3">
                        <div className="font-medium">{rule.name}</div>
                        {rule.description && <div className="text-zinc-500 text-xs">{rule.description}</div>}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${
                          rule.min_severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                          rule.min_severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                          rule.min_severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-zinc-500/20 text-zinc-400'
                        }`}>{rule.min_severity}</span>
                      </td>
                      <td className="p-3">{rule.auto_remediate ? <span className="text-green-400">Yes</span> : <span className="text-zinc-500">No</span>}</td>
                      <td className="p-3">{rule.require_approval ? <span className="text-yellow-400">Required</span> : <span className="text-zinc-500">No</span>}</td>
                      <td className="p-3">{rule.enabled ? <span className="text-green-400">●</span> : <span className="text-zinc-500">○</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
