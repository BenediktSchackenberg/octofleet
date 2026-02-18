'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://192.168.0.5:8080';

interface DiskConfig {
  purpose: 'data' | 'log' | 'tempdb';
  diskNumber: number | null;
  driveLetter: string;
  volumeLabel: string;
  folder: string;
}

interface MssqlConfig {
  id: string;
  name: string;
  description: string | null;
  edition: string;
  version: string;
  instanceName: string;
  features: string[];
  collation: string;
  port: number;
  maxMemoryMb: number | null;
  tempDbFileCount: number;
  tempDbFileSizeMb: number;
  includeSsms: boolean;
  diskConfigs: DiskConfig[];
  createdAt: string;
}

interface MssqlAssignment {
  id: string;
  configId: string;
  configName: string;
  edition: string;
  version: string;
  groupId: string;
  groupName: string;
  enabled: boolean;
  memberCount: number;
  installedCount: number;
  pendingCount: number;
  createdAt: string;
}

interface MssqlInstance {
  id: string;
  nodeId: string;
  nodeName: string;
  configId: string;
  configName: string;
  instanceName: string;
  version: string;
  edition: string;
  status: string;
  installPath: string | null;
  dataPath: string | null;
  logPath: string | null;
  tempDbPath: string | null;
  installedAt: string | null;
  lastChecked: string | null;
}

interface Group {
  id: string;
  name: string;
  memberCount?: number;
}

type TabType = 'configs' | 'assignments' | 'instances';

export default function SqlPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('configs');
  const [configs, setConfigs] = useState<MssqlConfig[]>([]);
  const [assignments, setAssignments] = useState<MssqlAssignment[]>([]);
  const [instances, setInstances] = useState<MssqlInstance[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MssqlConfig | null>(null);
  
  // Form state for new config
  const [configForm, setConfigForm] = useState({
    name: '',
    description: '',
    edition: 'developer',
    version: '2022',
    instanceName: 'MSSQLSERVER',
    features: ['SQLENGINE'],
    collation: 'Latin1_General_CI_AS',
    port: 1433,
    maxMemoryMb: 8192,
    tempDbFileCount: 4,
    tempDbFileSizeMb: 1024,
    includeSsms: true,
    diskConfigs: [
      { purpose: 'data', diskNumber: null, driveLetter: 'D', volumeLabel: 'SQL_Data', folder: 'Data' },
      { purpose: 'log', diskNumber: null, driveLetter: 'E', volumeLabel: 'SQL_Logs', folder: 'Logs' },
      { purpose: 'tempdb', diskNumber: null, driveLetter: 'F', volumeLabel: 'SQL_TempDB', folder: 'TempDB' },
    ] as DiskConfig[]
  });
  
  // Assignment form
  const [assignForm, setAssignForm] = useState({
    configId: '',
    groupId: '',
    saPassword: ''
  });

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  };

  const fetchData = async () => {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }

    setLoading(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      
      const [configsRes, assignmentsRes, instancesRes, groupsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/mssql/configs`, { headers }),
        fetch(`${API_BASE}/api/v1/mssql/assignments`, { headers }),
        fetch(`${API_BASE}/api/v1/mssql/instances`, { headers }),
        fetch(`${API_BASE}/api/v1/groups`, { headers })
      ]);

      if (!configsRes.ok || !assignmentsRes.ok || !instancesRes.ok) {
        if (configsRes.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error('Failed to fetch data');
      }

      const configsData = await configsRes.json();
      const assignmentsData = await assignmentsRes.json();
      const instancesData = await instancesRes.json();
      const groupsData = await groupsRes.json();

      setConfigs(configsData.configs || []);
      setAssignments(assignmentsData.assignments || []);
      setInstances(instancesData.instances || []);
      setGroups(groupsData.groups || groupsData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const createConfig = async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/configs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: configForm.name,
          description: configForm.description || null,
          edition: configForm.edition,
          version: configForm.version,
          instance_name: configForm.instanceName,
          features: configForm.features,
          collation: configForm.collation,
          port: configForm.port,
          max_memory_mb: configForm.maxMemoryMb,
          tempdb_file_count: configForm.tempDbFileCount,
          tempdb_file_size_mb: configForm.tempDbFileSizeMb,
          include_ssms: configForm.includeSsms,
          disk_configs: configForm.diskConfigs.map(d => ({
            purpose: d.purpose,
            disk_number: d.diskNumber,
            drive_letter: d.driveLetter,
            volume_label: d.volumeLabel,
            folder: d.folder
          }))
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to create config');
      }

      setShowConfigModal(false);
      resetConfigForm();
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating config');
    }
  };

  const deleteConfig = async (id: string) => {
    if (!confirm('Delete this SQL Server configuration?')) return;
    
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/configs/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to delete');
      fetchData();
    } catch (err) {
      alert('Error deleting config');
    }
  };

  const createAssignment = async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/assignments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          config_id: assignForm.configId,
          group_id: assignForm.groupId,
          sa_password: assignForm.saPassword
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to create assignment');
      }

      setShowAssignModal(false);
      setAssignForm({ configId: '', groupId: '', saPassword: '' });
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error creating assignment');
    }
  };

  const deleteAssignment = async (id: string) => {
    if (!confirm('Delete this assignment?')) return;
    
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/assignments/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to delete');
      fetchData();
    } catch (err) {
      alert('Error deleting assignment');
    }
  };

  const triggerReconcile = async (assignmentId: string) => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/v1/mssql/assignments/${assignmentId}/reconcile`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to trigger reconcile');
      }

      const data = await res.json();
      alert(`Reconcile triggered! ${data.jobsCreated || 0} jobs created.`);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error triggering reconcile');
    }
  };

  const resetConfigForm = () => {
    setConfigForm({
      name: '',
      description: '',
      edition: 'developer',
      version: '2022',
      instanceName: 'MSSQLSERVER',
      features: ['SQLENGINE'],
      collation: 'Latin1_General_CI_AS',
      port: 1433,
      maxMemoryMb: 8192,
      tempDbFileCount: 4,
      tempDbFileSizeMb: 1024,
      includeSsms: true,
      diskConfigs: [
        { purpose: 'data', diskNumber: null, driveLetter: 'D', volumeLabel: 'SQL_Data', folder: 'Data' },
        { purpose: 'log', diskNumber: null, driveLetter: 'E', volumeLabel: 'SQL_Logs', folder: 'Logs' },
        { purpose: 'tempdb', diskNumber: null, driveLetter: 'F', volumeLabel: 'SQL_TempDB', folder: 'TempDB' },
      ]
    });
    setEditingConfig(null);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      installed: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
      running: 'bg-blue-100 text-blue-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getEditionBadge = (edition: string) => {
    const colors: Record<string, string> = {
      developer: 'bg-purple-100 text-purple-800',
      express: 'bg-gray-100 text-gray-800',
      standard: 'bg-blue-100 text-blue-800',
      enterprise: 'bg-amber-100 text-amber-800'
    };
    return colors[edition] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">🗄️ SQL Server Management</h1>
              <p className="text-gray-500 mt-1">Deploy and manage SQL Server across your fleet</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 mt-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: 'configs', label: 'Configurations', count: configs.length },
              { id: 'assignments', label: 'Assignments', count: assignments.length },
              { id: 'instances', label: 'Instances', count: instances.length }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                  activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="mt-6 pb-12">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {/* Configs Tab */}
          {activeTab === 'configs' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium">Deployment Profiles</h2>
                <button
                  onClick={() => { resetConfigForm(); setShowConfigModal(true); }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                >
                  + New Config
                </button>
              </div>
              
              <div className="grid gap-4">
                {configs.map((config) => (
                  <div key={config.id} className="bg-white rounded-lg shadow p-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold">{config.name}</h3>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getEditionBadge(config.edition)}`}>
                            {config.edition}
                          </span>
                          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            {config.version}
                          </span>
                        </div>
                        {config.description && (
                          <p className="text-gray-500 mt-1">{config.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => deleteConfig(config.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                    
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Instance:</span>
                        <span className="ml-2 font-mono">{config.instanceName}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Port:</span>
                        <span className="ml-2">{config.port}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Memory:</span>
                        <span className="ml-2">{config.maxMemoryMb ? `${config.maxMemoryMb} MB` : 'Auto'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">TempDB:</span>
                        <span className="ml-2">{config.tempDbFileCount} files × {config.tempDbFileSizeMb} MB</span>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2 text-xs">
                      <span className="text-gray-500">Disk Layout:</span>
                      {config.diskConfigs.map((d) => (
                        <span key={d.purpose} className="bg-gray-100 px-2 py-1 rounded">
                          {d.driveLetter}: → {d.purpose}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 text-xs text-gray-400">
                      Features: {config.features.join(', ')} | Collation: {config.collation}
                    </div>
                  </div>
                ))}
                
                {configs.length === 0 && (
                  <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                    No configurations yet. Create one to get started.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Assignments Tab */}
          {activeTab === 'assignments' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium">Group Assignments</h2>
                <button
                  onClick={() => setShowAssignModal(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                >
                  + Assign to Group
                </button>
              </div>
              
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Config</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Group</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Members</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {assignments.map((a) => (
                      <tr key={a.id}>
                        <td className="px-6 py-4">
                          <div className="font-medium">{a.configName}</div>
                          <div className="text-sm text-gray-500">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs ${getEditionBadge(a.edition)}`}>
                              {a.edition}
                            </span>
                            <span className="ml-2">{a.version}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium">{a.groupName}</td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <span className="bg-gray-100 px-2 py-1 rounded text-xs">{a.memberCount} total</span>
                            {a.installedCount > 0 && (
                              <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                                {a.installedCount} installed
                              </span>
                            )}
                            {a.pendingCount > 0 && (
                              <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">
                                {a.pendingCount} pending
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded text-xs ${a.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {a.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => triggerReconcile(a.id)}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              Deploy
                            </button>
                            <button
                              onClick={() => deleteAssignment(a.id)}
                              className="text-red-600 hover:text-red-800 text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {assignments.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    No assignments yet. Assign a config to a group to deploy SQL Server.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Instances Tab */}
          {activeTab === 'instances' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-medium">Installed Instances</h2>
                <button
                  onClick={fetchData}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  ↻ Refresh
                </button>
              </div>
              
              <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Node</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instance</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Paths</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {instances.map((inst) => (
                      <tr key={inst.id}>
                        <td className="px-6 py-4 font-medium">{inst.nodeName}</td>
                        <td className="px-6 py-4 font-mono">{inst.instanceName}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${getEditionBadge(inst.edition)}`}>
                            {inst.edition}
                          </span>
                          <span className="ml-2">{inst.version}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(inst.status)}`}>
                            {inst.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-500">
                          {inst.dataPath && <div>Data: {inst.dataPath}</div>}
                          {inst.logPath && <div>Log: {inst.logPath}</div>}
                          {inst.tempDbPath && <div>TempDB: {inst.tempDbPath}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {instances.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    No SQL Server instances installed yet.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">
                {editingConfig ? 'Edit Configuration' : 'New SQL Server Configuration'}
              </h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={configForm.name}
                      onChange={(e) => setConfigForm({...configForm, name: e.target.value})}
                      className="w-full border rounded-md px-3 py-2"
                      placeholder="e.g. Production Standard 2022"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Instance Name</label>
                    <input
                      type="text"
                      value={configForm.instanceName}
                      onChange={(e) => setConfigForm({...configForm, instanceName: e.target.value})}
                      className="w-full border rounded-md px-3 py-2"
                      placeholder="MSSQLSERVER"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={configForm.description}
                    onChange={(e) => setConfigForm({...configForm, description: e.target.value})}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="Optional description"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                    <select
                      value={configForm.version}
                      onChange={(e) => setConfigForm({...configForm, version: e.target.value})}
                      className="w-full border rounded-md px-3 py-2"
                    >
                      <option value="2019">SQL Server 2019</option>
                      <option value="2022">SQL Server 2022</option>
                      <option value="2025">SQL Server 2025</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Edition</label>
                    <select
                      value={configForm.edition}
                      onChange={(e) => setConfigForm({...configForm, edition: e.target.value})}
                      className="w-full border rounded-md px-3 py-2"
                    >
                      <option value="developer">Developer</option>
                      <option value="express">Express</option>
                      <option value="standard">Standard</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                    <input
                      type="number"
                      value={configForm.port}
                      onChange={(e) => setConfigForm({...configForm, port: parseInt(e.target.value)})}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Max Memory (MB)</label>
                    <input
                      type="number"
                      value={configForm.maxMemoryMb || ''}
                      onChange={(e) => setConfigForm({...configForm, maxMemoryMb: e.target.value ? parseInt(e.target.value) : 0})}
                      className="w-full border rounded-md px-3 py-2"
                      placeholder="Auto"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Collation</label>
                    <input
                      type="text"
                      value={configForm.collation}
                      onChange={(e) => setConfigForm({...configForm, collation: e.target.value})}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">TempDB Files</label>
                    <input
                      type="number"
                      value={configForm.tempDbFileCount}
                      onChange={(e) => setConfigForm({...configForm, tempDbFileCount: parseInt(e.target.value)})}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">TempDB Size (MB)</label>
                    <input
                      type="number"
                      value={configForm.tempDbFileSizeMb}
                      onChange={(e) => setConfigForm({...configForm, tempDbFileSizeMb: parseInt(e.target.value)})}
                      className="w-full border rounded-md px-3 py-2"
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
                  <h3 className="font-medium mb-2">Disk Layout</h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    {configForm.diskConfigs.map((disk, idx) => (
                      <div key={disk.purpose} className="border rounded p-3">
                        <div className="font-medium capitalize mb-2">{disk.purpose}</div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-xs text-gray-500">Drive Letter</label>
                            <input
                              type="text"
                              value={disk.driveLetter}
                              onChange={(e) => {
                                const newDisks = [...configForm.diskConfigs];
                                newDisks[idx].driveLetter = e.target.value.toUpperCase();
                                setConfigForm({...configForm, diskConfigs: newDisks});
                              }}
                              className="w-full border rounded px-2 py-1"
                              maxLength={1}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Folder</label>
                            <input
                              type="text"
                              value={disk.folder}
                              onChange={(e) => {
                                const newDisks = [...configForm.diskConfigs];
                                newDisks[idx].folder = e.target.value;
                                setConfigForm({...configForm, diskConfigs: newDisks});
                              }}
                              className="w-full border rounded px-2 py-1"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="includeSsms"
                    checked={configForm.includeSsms}
                    onChange={(e) => setConfigForm({...configForm, includeSsms: e.target.checked})}
                    className="mr-2"
                  />
                  <label htmlFor="includeSsms" className="text-sm">Install SQL Server Management Studio (SSMS)</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => { setShowConfigModal(false); resetConfigForm(); }}
                  className="px-4 py-2 border rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createConfig}
                  disabled={!configForm.name}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Create Config
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full m-4">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Assign Config to Group</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Configuration *</label>
                  <select
                    value={assignForm.configId}
                    onChange={(e) => setAssignForm({...assignForm, configId: e.target.value})}
                    className="w-full border rounded-md px-3 py-2"
                  >
                    <option value="">Select a config...</option>
                    {configs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.edition} {c.version})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group *</label>
                  <select
                    value={assignForm.groupId}
                    onChange={(e) => setAssignForm({...assignForm, groupId: e.target.value})}
                    className="w-full border rounded-md px-3 py-2"
                  >
                    <option value="">Select a group...</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} {g.memberCount !== undefined ? `(${g.memberCount} members)` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SA Password *</label>
                  <input
                    type="password"
                    value={assignForm.saPassword}
                    onChange={(e) => setAssignForm({...assignForm, saPassword: e.target.value})}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="SQL Server SA password"
                  />
                  <p className="text-xs text-gray-500 mt-1">Password for the SQL Server SA account</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => { setShowAssignModal(false); setAssignForm({ configId: '', groupId: '', saPassword: '' }); }}
                  className="px-4 py-2 border rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createAssignment}
                  disabled={!assignForm.configId || !assignForm.groupId || !assignForm.saPassword}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Create Assignment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
