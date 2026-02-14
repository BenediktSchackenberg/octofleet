'use client';

import { useState, useEffect } from 'react';
import { 
  Shield, Package, FileText, Clock, Play, CheckCircle, 
  XCircle, AlertTriangle, Settings, Plus, Trash2, RefreshCw,
  Wifi, WifiOff
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

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080';

  const getToken = () => localStorage.getItem('token');

  const fetchData = async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      
      const [summaryRes, packagesRes, rulesRes, jobsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/remediation/summary`, { headers }),
        fetch(`${API_BASE}/api/v1/remediation/packages`, { headers }),
        fetch(`${API_BASE}/api/v1/remediation/rules`, { headers }),
        fetch(`${API_BASE}/api/v1/remediation/jobs?limit=50`, { headers }),
      ]);

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data);
      }
      if (packagesRes.ok) {
        const data = await packagesRes.json();
        setPackages(data.packages || []);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules || []);
      }
      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data.jobs || []);
      }
    } catch (error) {
      console.error('Error fetching remediation data:', error);
    }
    setLoading(false);
  };

  // SSE for live job updates
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const eventSource = new EventSource(
      `${API_BASE}/api/v1/remediation/live?token=${token}`
    );

    eventSource.onopen = () => {
      setLiveConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job_update') {
          // Update single job in list
          setJobs(prev => {
            const idx = prev.findIndex(j => j.id === data.job.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = data.job;
              return updated;
            }
            return [data.job, ...prev].slice(0, 50);
          });
          // Refresh summary when job status changes
          fetchSummary();
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    eventSource.onerror = () => {
      setLiveConnected(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
      setLiveConnected(false);
    };
  }, []);

  const fetchSummary = async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/remediation/summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setSummary(await res.json());
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchData();
    // Fallback polling if SSE not connected
    const interval = setInterval(() => {
      if (!liveConnected) fetchData();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const runScan = async (dryRun: boolean = true) => {
    const token = getToken();
    if (!token) {
      console.error('[Remediation] No token available for scan!');
      alert('Not authenticated. Please log in again.');
      return;
    }
    setScanning(true);
    setScanResult(null);
    try {
      console.log('[Remediation] Making POST request to:', `${API_BASE}/api/v1/remediation/scan`);
      const res = await fetch(`${API_BASE}/api/v1/remediation/scan`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          severity_filter: ['CRITICAL', 'HIGH'],
          dry_run: dryRun,
        }),
      });
      console.log('[Remediation] Response status:', res.status);
      if (res.ok) {
        const result = await res.json();
        console.log('[Remediation] Scan result:', result);
        setScanResult(result);
        if (!dryRun) {
          fetchData(); // Refresh after real scan
        }
      } else {
        const errorText = await res.text();
        console.error('[Remediation] Scan failed:', res.status, errorText);
        alert(`Scan failed: ${res.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Scan error:', error);
      alert(`Scan error: ${error}`);
    }
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
      skipped: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.pending}`}>
        {status}
      </span>
    );
  };

  const getMethodBadge = (method: string) => {
    const colors: Record<string, string> = {
      winget: 'bg-blue-600',
      choco: 'bg-orange-600',
      package: 'bg-purple-600',
      script: 'bg-green-600',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs text-white ${colors[method] || 'bg-gray-600'}`}>
        {method}
      </span>
    );
  };

  if (loading && !summary) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-green-500" />
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                Auto-Remediation
                {liveConnected ? (
                  <span className="flex items-center gap-1 text-xs font-normal text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                    <Wifi className="h-3 w-3" /> Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-normal text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                    <WifiOff className="h-3 w-3" /> Offline
                  </span>
                )}
              </h1>
              <p className="text-gray-400 text-sm">Automatically fix vulnerabilities across your fleet</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => runScan(true)}
              disabled={scanning}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              Dry Run
            </button>
            <button
              type="button"
              onClick={() => runScan(false)}
              disabled={scanning}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg flex items-center gap-2 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              Run Remediation
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary?.job_counts?.success || 0}</p>
                <p className="text-gray-400 text-sm">Fixed</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Clock className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary?.job_counts?.approved || 0}</p>
                <p className="text-gray-400 text-sm">Pending</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary?.job_counts?.failed || 0}</p>
                <p className="text-gray-400 text-sm">Failed</p>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-500/20 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary?.fixable_vulnerabilities || 0}</p>
                <p className="text-gray-400 text-sm">Fixable CVEs</p>
              </div>
            </div>
          </div>
        </div>

        {/* Scan Result */}
        {scanResult && (
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 mb-8">
            <h3 className="font-semibold mb-2">Scan Result</h3>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Scanned:</span>{' '}
                <span className="font-mono">{scanResult.scanned}</span>
              </div>
              <div>
                <span className="text-gray-400">With Fix:</span>{' '}
                <span className="font-mono text-green-400">{scanResult.with_fix_available}</span>
              </div>
              <div>
                <span className="text-gray-400">Jobs Created:</span>{' '}
                <span className="font-mono text-blue-400">{scanResult.jobs_created}</span>
              </div>
              <div>
                <span className="text-gray-400">Skipped:</span>{' '}
                <span className="font-mono">{scanResult.jobs_skipped_existing}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-800 pb-2">
          {(['dashboard', 'packages', 'rules', 'jobs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-t-lg capitalize ${
                activeTab === tab
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="bg-gray-900 rounded-xl border border-gray-800">
            <div className="p-4 border-b border-gray-800">
              <h2 className="font-semibold">Recent Remediation Jobs</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">ID</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Software</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">CVE</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Fix Method</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Status</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {(summary?.recent_jobs || []).map((job) => (
                    <tr key={job.id} className="hover:bg-gray-800/30">
                      <td className="p-3 font-mono text-sm">{job.id}</td>
                      <td className="p-3">
                        <div className="font-medium">{job.software_name}</div>
                        <div className="text-gray-400 text-xs">{job.software_version}</div>
                      </td>
                      <td className="p-3">
                        <a 
                          href={`https://nvd.nist.gov/vuln/detail/${job.cve_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline font-mono text-sm"
                        >
                          {job.cve_id}
                        </a>
                      </td>
                      <td className="p-3">{getMethodBadge(job.fix_method || 'unknown')}</td>
                      <td className="p-3">{getStatusBadge(job.status)}</td>
                      <td className="p-3 text-gray-400 text-sm">
                        {new Date(job.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Packages Tab */}
        {activeTab === 'packages' && (
          <div className="bg-gray-900 rounded-xl border border-gray-800">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
              <h2 className="font-semibold">Fix Packages</h2>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" />
                Add Package
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Name</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Target Software</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Method</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Command</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {packages.map((pkg) => (
                    <tr key={pkg.id} className="hover:bg-gray-800/30">
                      <td className="p-3 font-medium">{pkg.name}</td>
                      <td className="p-3">{pkg.target_software}</td>
                      <td className="p-3">{getMethodBadge(pkg.fix_method)}</td>
                      <td className="p-3">
                        <code className="bg-gray-800 px-2 py-1 rounded text-xs">{pkg.fix_command}</code>
                      </td>
                      <td className="p-3">
                        {pkg.enabled ? (
                          <span className="text-green-400">●</span>
                        ) : (
                          <span className="text-gray-500">○</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <div className="bg-gray-900 rounded-xl border border-gray-800">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center">
              <h2 className="font-semibold">Remediation Rules</h2>
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" />
                Add Rule
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Name</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Min Severity</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Auto Fix</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Approval</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Enabled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {rules.map((rule) => (
                    <tr key={rule.id} className="hover:bg-gray-800/30">
                      <td className="p-3">
                        <div className="font-medium">{rule.name}</div>
                        {rule.description && (
                          <div className="text-gray-400 text-xs">{rule.description}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${
                          rule.min_severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400' :
                          rule.min_severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400' :
                          rule.min_severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {rule.min_severity}
                        </span>
                      </td>
                      <td className="p-3">
                        {rule.auto_remediate ? (
                          <span className="text-green-400">Yes</span>
                        ) : (
                          <span className="text-gray-500">No</span>
                        )}
                      </td>
                      <td className="p-3">
                        {rule.require_approval ? (
                          <span className="text-yellow-400">Required</span>
                        ) : (
                          <span className="text-gray-500">No</span>
                        )}
                      </td>
                      <td className="p-3">
                        {rule.enabled ? (
                          <span className="text-green-400">●</span>
                        ) : (
                          <span className="text-gray-500">○</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Jobs Tab */}
        {activeTab === 'jobs' && (
          <div className="bg-gray-900 rounded-xl border border-gray-800">
            <div className="p-4 border-b border-gray-800">
              <h2 className="font-semibold">All Remediation Jobs</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">ID</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Software</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">CVE</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Node</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Status</th>
                    <th className="text-left p-3 text-gray-400 font-medium text-sm">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-800/30">
                      <td className="p-3 font-mono text-sm">{job.id}</td>
                      <td className="p-3">
                        <div className="font-medium">{job.software_name}</div>
                        <div className="text-gray-400 text-xs">{job.software_version}</div>
                      </td>
                      <td className="p-3">
                        <a 
                          href={`https://nvd.nist.gov/vuln/detail/${job.cve_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline font-mono text-sm"
                        >
                          {job.cve_id}
                        </a>
                      </td>
                      <td className="p-3 font-mono text-xs text-gray-400">
                        {job.node_id.slice(0, 8)}...
                      </td>
                      <td className="p-3">{getStatusBadge(job.status)}</td>
                      <td className="p-3 text-gray-400 text-sm">
                        {new Date(job.created_at).toLocaleString()}
                      </td>
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
