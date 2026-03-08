'use client';
import { apiClient } from "@/lib/api-client";

import { useState, useEffect } from 'react';



interface CumulativeUpdate {
  id: string;
  version: string;
  cuNumber: number;
  buildNumber: string;
  releaseDate: string;
  downloadUrl: string | null;
  kbArticle: string | null;
  fileHash: string | null;
  fileSizeMb: number | null;
  status: 'detected' | 'testing' | 'approved' | 'blocked' | 'deprecated';
  ring: 'pilot' | 'broad' | 'all';
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

interface ComplianceData {
  summary: {
    total: number;
    upToDate: number;
    outdated: number;
    unknown: number;
  };
  latestApproved: Record<string, { cuNumber: number; buildNumber: string }>;
  outdated: Array<{
    instanceId: string;
    hostname: string;
    instanceName: string;
    currentCu: number | null;
    latestCu: number;
    behindBy: number;
  }>;
}

interface CuManagementProps {
  getAuthHeaders: () => Record<string, string>;
}

export default function CuManagement({ getAuthHeaders }: CuManagementProps) {
  const [cus, setCus] = useState<CumulativeUpdate[]>([]);
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'catalog' | 'compliance'>('catalog');
  const [versionFilter, setVersionFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [selectedCu, setSelectedCu] = useState<CumulativeUpdate | null>(null);
  const [instances, setInstances] = useState<Array<{id: string; nodeId: string; hostname: string; instanceName: string; version: string}>>([]);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  
  const [newCu, setNewCu] = useState({
    version: '2022',
    cuNumber: 1,
    buildNumber: '',
    releaseDate: '',
    downloadUrl: '',
    kbArticle: '',
    fileHash: '',
    fileSizeMb: 0,
    releaseNotes: ''
  });

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ newCount: number; existingCount: number } | null>(null);

  const handleSyncFromMicrosoft = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiClient.post(`/mssql/sync-catalog`, {}, { showErrorToast: false });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      setSyncResult({
        newCount: data.newCUs?.length || 0,
        existingCount: data.existingCUs?.length || 0
      });
      await fetchCus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const fetchCus = async () => {
    try {
      let endpoint = `/mssql/cumulative-updates`;
      const params = new URLSearchParams();
      if (versionFilter) params.append('version', versionFilter);
      if (statusFilter) params.append('status', statusFilter);
      if (params.toString()) endpoint += `?${params.toString()}`;
      
      const data = await apiClient.get<{ cumulativeUpdates: any[] }>(endpoint, { showErrorToast: false });
      if (!data) throw new Error('Failed to fetch CUs');
      setCus(data.cumulativeUpdates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch CUs');
    }
  };

  const fetchCompliance = async () => {
    try {
      const res = await apiClient.get(`/mssql/cu-compliance`, { showErrorToast: false });
      if (!res.ok) throw new Error('Failed to fetch compliance');
      const data = await res.json();
      setCompliance(data);
    } catch (err) {
      console.error('Compliance fetch error:', err);
    }
  };

  const fetchInstances = async () => {
    try {
      const res = await apiClient.get(`/mssql/instances`, { showErrorToast: false });
      if (!res.ok) return;
      const data = await res.json();
      setInstances(data.instances || []);
    } catch (err) {
      console.error('Instances fetch error:', err);
    }
  };

  const handleDeploy = async () => {
    if (!selectedCu || selectedInstances.length === 0) return;
    
    try {
      const res = await apiClient.post(`/mssql/deploy-cu`, {
          cuId: selectedCu.id,
          instanceIds: selectedInstances
        }, { showErrorToast: false });
      if (!res.ok) throw new Error('Failed to create deploy jobs');
      const data = await res.json();
      alert(`✅ Created ${data.jobsCreated} deployment job(s)`);
      setShowDeployModal(false);
      setSelectedInstances([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Deploy failed');
    }
  };

  const openDeployModal = (cu: CumulativeUpdate) => {
    setSelectedCu(cu);
    setSelectedInstances([]);
    fetchInstances();
    setShowDeployModal(true);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchCus(), fetchCompliance()]);
      setLoading(false);
    };
    load();
  }, [versionFilter, statusFilter]);

  const handleApprove = async (cuId: string, ring: string) => {
    try {
      const res = await apiClient.post(`/mssql/cumulative-updates/${cuId}/approve`, { ring }, { showErrorToast: false });
      if (!res.ok) throw new Error('Failed to approve CU');
      await fetchCus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const handleBlock = async (cuId: string) => {
    const reason = prompt('Reason for blocking:');
    if (!reason) return;
    
    try {
      const res = await apiClient.post(`/mssql/cumulative-updates/${cuId}/block`, { reason }, { showErrorToast: false });
      if (!res.ok) throw new Error('Failed to block CU');
      await fetchCus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to block');
    }
  };

  const handleAddCu = async () => {
    try {
      const res = await apiClient.post(`/mssql/cumulative-updates`, newCu, { showErrorToast: false });
      if (!res.ok) throw new Error('Failed to add CU');
      setShowAddModal(false);
      await fetchCus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add CU');
    }
  };

  const handlePatchOutdated = async () => {
    if (!confirm('Create patch jobs for all outdated instances?')) return;
    
    try {
      const res = await apiClient.post(`/mssql/patch-outdated`, {}, { showErrorToast: false });
      if (!res.ok) throw new Error('Failed to create patch jobs');
      const data = await res.json();
      alert(`Created ${data.jobsCreated} patch jobs`);
      await fetchCompliance();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to patch');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      detected: 'bg-muted text-foreground',
      testing: 'bg-yellow-500/20 text-yellow-400',
      approved: 'bg-green-500/20 text-green-400',
      blocked: 'bg-red-500/20 text-red-400',
      deprecated: 'bg-muted text-muted-foreground'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.detected}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const getRingBadge = (ring: string) => {
    const styles: Record<string, string> = {
      pilot: 'bg-blue-500/20 text-blue-400',
      broad: 'bg-purple-500/20 text-purple-400',
      all: 'bg-green-500/20 text-green-400'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[ring] || 'bg-muted'}`}>
        {ring}
      </span>
    );
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView('catalog')}
            className={`px-4 py-2 rounded-lg font-medium ${activeView === 'catalog' ? 'bg-blue-600 text-white' : 'bg-muted hover:bg-muted'}`}
          >
            📦 CU Catalog
          </button>
          <button
            onClick={() => setActiveView('compliance')}
            className={`px-4 py-2 rounded-lg font-medium ${activeView === 'compliance' ? 'bg-blue-600 text-white' : 'bg-muted hover:bg-muted'}`}
          >
            📊 Compliance
          </button>
        </div>
        
        {activeView === 'catalog' && (
          <div className="flex gap-2">
            <button
              onClick={handleSyncFromMicrosoft}
              disabled={syncing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {syncing ? (
                <>
                  <span className="animate-spin">⟳</span> Syncing...
                </>
              ) : (
                <>🔄 Sync from Microsoft</>
              )}
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              + Add CU
            </button>
          </div>
        )}
        
        {activeView === 'compliance' && compliance && compliance.summary.outdated > 0 && (
          <button
            onClick={handlePatchOutdated}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            🔄 Patch All Outdated ({compliance.summary.outdated})
          </button>
        )}
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-xl">✅</span>
            <span>
              <strong>Sync complete!</strong> {syncResult.newCount} new CUs added, {syncResult.existingCount} already in catalog.
            </span>
          </div>
          <button
            onClick={() => setSyncResult(null)}
            className="text-blue-400 hover:text-blue-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Catalog View */}
      {activeView === 'catalog' && (
        <>
          {/* Filters */}
          <div className="flex gap-4">
            <select
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
              className="border rounded-lg px-3 py-2"
            >
              <option value="">All Versions</option>
              <option value="2019">SQL Server 2019</option>
              <option value="2022">SQL Server 2022</option>
              <option value="2025">SQL Server 2025</option>
            </select>
            
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded-lg px-3 py-2"
            >
              <option value="">All Statuses</option>
              <option value="detected">Detected</option>
              <option value="testing">Testing</option>
              <option value="approved">Approved</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>

          {/* CU Table */}
          <div className="bg-card rounded-xl shadow overflow-hidden">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Version</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">CU</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Build</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">KB</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Release Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Ring</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cus.map((cu) => (
                  <tr key={cu.id} className="hover:bg-muted/50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium">SQL {cu.version}</td>
                    <td className="px-6 py-4 whitespace-nowrap">CU{cu.cuNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{cu.buildNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {cu.kbArticle ? (
                        <a
                          href={`https://support.microsoft.com/kb/${cu.kbArticle.replace('KB', '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          {cu.kbArticle}
                        </a>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {cu.releaseDate ? new Date(cu.releaseDate).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(cu.status)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{getRingBadge(cu.ring)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-2">
                        {cu.status !== 'approved' && cu.status !== 'blocked' && (
                          <>
                            <button
                              onClick={() => handleApprove(cu.id, 'pilot')}
                              className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded hover:bg-green-500/20"
                            >
                              ✓ Pilot
                            </button>
                            <button
                              onClick={() => handleApprove(cu.id, 'all')}
                              className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/20"
                            >
                              ✓ All
                            </button>
                          </>
                        )}
                        {cu.status === 'approved' && cu.ring !== 'all' && (
                          <button
                            onClick={() => handleApprove(cu.id, 'all')}
                            className="text-xs px-2 py-1 bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/20"
                          >
                            → All
                          </button>
                        )}
                        {cu.status !== 'blocked' && (
                          <button
                            onClick={() => handleBlock(cu.id)}
                            className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-200"
                          >
                            ✕ Block
                          </button>
                        )}
                        {cu.status === 'approved' && (
                          <button
                            onClick={() => openDeployModal(cu)}
                            className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/20"
                          >
                            🚀 Deploy
                          </button>
                        )}
                        {cu.kbArticle && (
                          <a
                            href={`https://www.catalog.update.microsoft.com/Search.aspx?q=${cu.kbArticle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded hover:bg-indigo-500/20"
                          >
                            📥 Catalog
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {cus.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                      No cumulative updates in catalog. Add CUs to start tracking.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Compliance View */}
      {activeView === 'compliance' && compliance && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-card rounded-xl shadow p-6">
              <div className="text-3xl font-bold">{compliance.summary.total}</div>
              <div className="text-muted-foreground">Total Instances</div>
            </div>
            <div className="bg-card rounded-xl shadow p-6 border-l-4 border-green-500">
              <div className="text-3xl font-bold text-green-600">{compliance.summary.upToDate}</div>
              <div className="text-muted-foreground">Up to Date</div>
            </div>
            <div className="bg-card rounded-xl shadow p-6 border-l-4 border-orange-500">
              <div className="text-3xl font-bold text-orange-600">{compliance.summary.outdated}</div>
              <div className="text-muted-foreground">Outdated</div>
            </div>
            <div className="bg-card rounded-xl shadow p-6 border-l-4 border-zinc-600">
              <div className="text-3xl font-bold text-muted-foreground">{compliance.summary.unknown}</div>
              <div className="text-muted-foreground">Unknown</div>
            </div>
          </div>

          {/* Latest Approved */}
          <div className="bg-card rounded-xl shadow p-6">
            <h3 className="font-semibold mb-4">Latest Approved CUs</h3>
            <div className="flex gap-6">
              {Object.entries(compliance.latestApproved).map(([version, cu]) => (
                <div key={version} className="flex items-center gap-2">
                  <span className="font-medium">SQL {version}:</span>
                  <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded">CU{cu.cuNumber}</span>
                  <span className="text-muted-foreground text-sm">({cu.buildNumber})</span>
                </div>
              ))}
              {Object.keys(compliance.latestApproved).length === 0 && (
                <span className="text-muted-foreground">No CUs approved yet</span>
              )}
            </div>
          </div>

          {/* Outdated Instances */}
          {compliance.outdated.length > 0 && (
            <div className="bg-card rounded-xl shadow overflow-hidden">
              <div className="p-4 border-b bg-orange-50">
                <h3 className="font-semibold text-orange-400">⚠️ Outdated Instances</h3>
              </div>
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Host</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Instance</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Current CU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Latest CU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Behind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {compliance.outdated.map((inst) => (
                    <tr key={inst.instanceId} className="hover:bg-muted/50">
                      <td className="px-6 py-4 whitespace-nowrap font-medium">{inst.hostname}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{inst.instanceName}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded">
                          CU{inst.currentCu ?? '?'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded">
                          CU{inst.latestCu}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-red-400 font-medium">{inst.behindBy} CU(s)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Add CU Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Add Cumulative Update</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SQL Version</label>
                  <select
                    value={newCu.version}
                    onChange={(e) => setNewCu({ ...newCu, version: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="2019">SQL Server 2019</option>
                    <option value="2022">SQL Server 2022</option>
                    <option value="2025">SQL Server 2025</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">CU Number</label>
                  <input
                    type="number"
                    value={newCu.cuNumber}
                    onChange={(e) => setNewCu({ ...newCu, cuNumber: parseInt(e.target.value) })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Build Number *</label>
                <input
                  type="text"
                  placeholder="e.g., 16.0.4115.5"
                  value={newCu.buildNumber}
                  onChange={(e) => setNewCu({ ...newCu, buildNumber: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Release Date *</label>
                <input
                  type="date"
                  value={newCu.releaseDate}
                  onChange={(e) => setNewCu({ ...newCu, releaseDate: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Download URL</label>
                <input
                  type="text"
                  placeholder="https://..."
                  value={newCu.downloadUrl}
                  onChange={(e) => setNewCu({ ...newCu, downloadUrl: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">KB Article</label>
                  <input
                    type="text"
                    placeholder="KB5029503"
                    value={newCu.kbArticle}
                    onChange={(e) => setNewCu({ ...newCu, kbArticle: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">File Size (MB)</label>
                  <input
                    type="number"
                    value={newCu.fileSizeMb}
                    onChange={(e) => setNewCu({ ...newCu, fileSizeMb: parseInt(e.target.value) })}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">SHA256 Hash</label>
                <input
                  type="text"
                  placeholder="(optional) for verification"
                  value={newCu.fileHash}
                  onChange={(e) => setNewCu({ ...newCu, fileHash: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCu}
                disabled={!newCu.buildNumber || !newCu.releaseDate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Add CU
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy Modal */}
      {showDeployModal && selectedCu && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold mb-2">🚀 Deploy CU{selectedCu.cuNumber}</h2>
            <p className="text-muted-foreground mb-4">
              SQL Server {selectedCu.version} - Build {selectedCu.buildNumber}
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Select Target Instances:</label>
              <div className="border rounded-lg max-h-60 overflow-y-auto">
                {instances.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground">
                    No SQL instances found. Add instances in the Instances tab first.
                  </div>
                ) : (
                  instances.map((inst) => (
                    <label
                      key={inst.id}
                      className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer border-b last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedInstances.includes(inst.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedInstances([...selectedInstances, inst.id]);
                          } else {
                            setSelectedInstances(selectedInstances.filter(id => id !== inst.id));
                          }
                        }}
                        className="w-4 h-4"
                      />
                      <div>
                        <div className="font-medium">{inst.hostname}</div>
                        <div className="text-sm text-muted-foreground">
                          {inst.instanceName} • {inst.version || 'Version unknown'}
                        </div>
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
            
            {instances.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setSelectedInstances(instances.map(i => i.id))}
                  className="text-sm text-blue-400 hover:underline"
                >
                  Select All
                </button>
                <span className="text-muted-foreground">|</span>
                <button
                  onClick={() => setSelectedInstances([])}
                  className="text-sm text-blue-400 hover:underline"
                >
                  Clear
                </button>
                <span className="ml-auto text-sm text-muted-foreground">
                  {selectedInstances.length} selected
                </span>
              </div>
            )}
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeployModal(false)}
                className="px-4 py-2 text-muted-foreground hover:bg-muted rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleDeploy}
                disabled={selectedInstances.length === 0}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                🚀 Deploy to {selectedInstances.length} Instance(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
