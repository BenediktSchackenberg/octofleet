'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080';

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

  const fetchCus = async () => {
    try {
      let url = `${API_BASE}/api/v1/mssql/cumulative-updates`;
      const params = new URLSearchParams();
      if (versionFilter) params.append('version', versionFilter);
      if (statusFilter) params.append('status', statusFilter);
      if (params.toString()) url += `?${params.toString()}`;
      
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch CUs');
      const data = await res.json();
      setCus(data.cumulativeUpdates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch CUs');
    }
  };

  const fetchCompliance = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/cu-compliance`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch compliance');
      const data = await res.json();
      setCompliance(data);
    } catch (err) {
      console.error('Compliance fetch error:', err);
    }
  };

  const fetchInstances = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/instances`, {
        headers: getAuthHeaders()
      });
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
      const res = await fetch(`${API_BASE}/api/v1/mssql/deploy-cu`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuId: selectedCu.id,
          instanceIds: selectedInstances
        })
      });
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
      const res = await fetch(`${API_BASE}/api/v1/mssql/cumulative-updates/${cuId}/approve`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ring })
      });
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
      const res = await fetch(`${API_BASE}/api/v1/mssql/cumulative-updates/${cuId}/block`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      if (!res.ok) throw new Error('Failed to block CU');
      await fetchCus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to block');
    }
  };

  const handleAddCu = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/cumulative-updates`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(newCu)
      });
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
      const res = await fetch(`${API_BASE}/api/v1/mssql/patch-outdated`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
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
      detected: 'bg-gray-100 text-gray-800',
      testing: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      blocked: 'bg-red-100 text-red-800',
      deprecated: 'bg-gray-200 text-gray-500'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.detected}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const getRingBadge = (ring: string) => {
    const styles: Record<string, string> = {
      pilot: 'bg-blue-100 text-blue-800',
      broad: 'bg-purple-100 text-purple-800',
      all: 'bg-green-100 text-green-800'
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[ring] || 'bg-gray-100'}`}>
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
            className={`px-4 py-2 rounded-lg font-medium ${activeView === 'catalog' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
          >
            📦 CU Catalog
          </button>
          <button
            onClick={() => setActiveView('compliance')}
            className={`px-4 py-2 rounded-lg font-medium ${activeView === 'compliance' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
          >
            📊 Compliance
          </button>
        </div>
        
        {activeView === 'catalog' && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + Add CU
          </button>
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
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">CU</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Build</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Release Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ring</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {cus.map((cu) => (
                  <tr key={cu.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium">SQL {cu.version}</td>
                    <td className="px-6 py-4 whitespace-nowrap">CU{cu.cuNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{cu.buildNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
                              className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200"
                            >
                              ✓ Pilot
                            </button>
                            <button
                              onClick={() => handleApprove(cu.id, 'all')}
                              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              ✓ All
                            </button>
                          </>
                        )}
                        {cu.status === 'approved' && cu.ring !== 'all' && (
                          <button
                            onClick={() => handleApprove(cu.id, 'all')}
                            className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                          >
                            → All
                          </button>
                        )}
                        {cu.status !== 'blocked' && (
                          <button
                            onClick={() => handleBlock(cu.id)}
                            className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            ✕ Block
                          </button>
                        )}
                        {cu.status === 'approved' && (
                          <button
                            onClick={() => openDeployModal(cu)}
                            className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                          >
                            🚀 Deploy
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {cus.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
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
            <div className="bg-white rounded-xl shadow p-6">
              <div className="text-3xl font-bold">{compliance.summary.total}</div>
              <div className="text-gray-500">Total Instances</div>
            </div>
            <div className="bg-white rounded-xl shadow p-6 border-l-4 border-green-500">
              <div className="text-3xl font-bold text-green-600">{compliance.summary.upToDate}</div>
              <div className="text-gray-500">Up to Date</div>
            </div>
            <div className="bg-white rounded-xl shadow p-6 border-l-4 border-orange-500">
              <div className="text-3xl font-bold text-orange-600">{compliance.summary.outdated}</div>
              <div className="text-gray-500">Outdated</div>
            </div>
            <div className="bg-white rounded-xl shadow p-6 border-l-4 border-gray-400">
              <div className="text-3xl font-bold text-gray-600">{compliance.summary.unknown}</div>
              <div className="text-gray-500">Unknown</div>
            </div>
          </div>

          {/* Latest Approved */}
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-semibold mb-4">Latest Approved CUs</h3>
            <div className="flex gap-6">
              {Object.entries(compliance.latestApproved).map(([version, cu]) => (
                <div key={version} className="flex items-center gap-2">
                  <span className="font-medium">SQL {version}:</span>
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded">CU{cu.cuNumber}</span>
                  <span className="text-gray-500 text-sm">({cu.buildNumber})</span>
                </div>
              ))}
              {Object.keys(compliance.latestApproved).length === 0 && (
                <span className="text-gray-500">No CUs approved yet</span>
              )}
            </div>
          </div>

          {/* Outdated Instances */}
          {compliance.outdated.length > 0 && (
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="p-4 border-b bg-orange-50">
                <h3 className="font-semibold text-orange-800">⚠️ Outdated Instances</h3>
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Host</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instance</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current CU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Latest CU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Behind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {compliance.outdated.map((inst) => (
                    <tr key={inst.instanceId} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap font-medium">{inst.hostname}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{inst.instanceName}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded">
                          CU{inst.currentCu ?? '?'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                          CU{inst.latestCu}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-red-600 font-medium">{inst.behindBy} CU(s)</span>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
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
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold mb-2">🚀 Deploy CU{selectedCu.cuNumber}</h2>
            <p className="text-gray-500 mb-4">
              SQL Server {selectedCu.version} - Build {selectedCu.buildNumber}
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Select Target Instances:</label>
              <div className="border rounded-lg max-h-60 overflow-y-auto">
                {instances.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    No SQL instances found. Add instances in the Instances tab first.
                  </div>
                ) : (
                  instances.map((inst) => (
                    <label
                      key={inst.id}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
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
                        <div className="text-sm text-gray-500">
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
                  className="text-sm text-blue-600 hover:underline"
                >
                  Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => setSelectedInstances([])}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Clear
                </button>
                <span className="ml-auto text-sm text-gray-500">
                  {selectedInstances.length} selected
                </span>
              </div>
            )}
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeployModal(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
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
