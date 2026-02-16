'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Service {
  id: string;
  name: string;
  description: string;
  class_name: string;
  status: string;
  config_values: Record<string, any>;
  desired_state_version: number;
  available_roles: string[];
  nodes: {
    id: string;
    node_id: string;
    hostname: string;
    role: string;
    status: string;
    health_status: string;
    os_name: string;
  }[];
}

interface Node {
  id: string;
  hostname: string;
  os_name: string;
  is_online: boolean;
}

interface LogEntry {
  id: string;
  action: string;
  status: string;
  message: string;
  hostname: string;
  started_at: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'openclaw-inventory-dev-key';

const statusColors: Record<string, string> = {
  provisioning: 'bg-yellow-100 text-yellow-800',
  healthy: 'bg-green-100 text-green-800',
  degraded: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
  stopped: 'bg-gray-100 text-gray-800',
  pending: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  draining: 'bg-yellow-100 text-yellow-800',
  reconciling: 'bg-blue-100 text-blue-800',
};

const healthColors: Record<string, string> = {
  healthy: 'text-green-600',
  unhealthy: 'text-red-600',
  unknown: 'text-gray-400',
};

export default function ServiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serviceId = params.serviceId as string;
  
  const [service, setService] = useState<Service | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddNodeModal, setShowAddNodeModal] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    fetchService();
    fetchLogs();
    fetchNodes();
  }, [serviceId]);

  const fetchService = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/services/${serviceId}`, {
        headers: { 'X-API-Key': API_KEY },
      });
      if (res.ok) {
        setService(await res.json());
      }
    } catch (error) {
      console.error('Failed to fetch service:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/services/${serviceId}/logs?limit=20`, {
        headers: { 'X-API-Key': API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  };

  const fetchNodes = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/nodes`, {
        headers: { 'X-API-Key': API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        setAllNodes(data.nodes || []);
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    }
  };

  const handleRemoveNode = async (nodeId: string) => {
    if (!confirm('Remove this node from the service?')) return;
    
    try {
      const res = await fetch(`${API_URL}/api/v1/services/${serviceId}/nodes/${nodeId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': API_KEY },
      });
      if (res.ok) {
        fetchService();
        fetchLogs();
      }
    } catch (error) {
      alert('Failed to remove node');
    }
  };

  const handleDeleteService = async () => {
    if (!confirm('Delete this service? This cannot be undone.')) return;
    
    try {
      const res = await fetch(`${API_URL}/api/v1/services/${serviceId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': API_KEY },
      });
      if (res.ok) {
        router.push('/services');
      }
    } catch (error) {
      alert('Failed to delete service');
    }
  };

  const handleReconcile = async () => {
    if (service?.nodes.length === 0) {
      alert('No nodes assigned to this service');
      return;
    }
    
    setReconciling(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/services/${serviceId}/reconcile`, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY },
      });
      
      if (res.ok) {
        const data = await res.json();
        alert(`Reconciliation triggered! ${data.jobsCreated} job(s) created.`);
        fetchLogs();
      } else {
        const error = await res.text();
        alert(`Reconciliation failed: ${error}`);
      }
    } catch (error) {
      alert('Failed to trigger reconciliation');
    } finally {
      setReconciling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Service not found</p>
        <Link href="/services" className="text-blue-600 hover:underline">← Back to Services</Link>
      </div>
    );
  }

  // Get nodes not yet assigned
  const assignedNodeIds = service.nodes.map(n => n.node_id);
  const availableNodes = allNodes.filter(n => !assignedNodeIds.includes(n.id));

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4">
        <Link href="/services" className="hover:text-blue-600">Services</Link>
        <span className="mx-2">/</span>
        <span>{service.name}</span>
      </nav>

      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold">{service.name}</h1>
          <p className="text-gray-500">{service.description || 'No description'}</p>
          <p className="text-gray-400 text-sm mt-1">Template: {service.class_name}</p>
        </div>
        <div className="flex items-center space-x-3">
          <span className={`px-3 py-1 rounded text-sm font-medium ${statusColors[service.status]}`}>
            {service.status}
          </span>
          <button
            onClick={handleReconcile}
            disabled={reconciling || service.nodes.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {reconciling ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Reconciling...
              </>
            ) : (
              <>
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reconcile
              </>
            )}
          </button>
          <button
            onClick={handleDeleteService}
            className="px-3 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <p className="text-gray-500 text-sm">Active Nodes</p>
          <p className="text-2xl font-bold">{service.nodes.filter(n => n.status === 'active').length}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-gray-500 text-sm">Config Version</p>
          <p className="text-2xl font-bold">v{service.desired_state_version}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <p className="text-gray-500 text-sm">Total Nodes</p>
          <p className="text-2xl font-bold">{service.nodes.length}</p>
        </div>
      </div>

      {/* Nodes */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="font-semibold">Assigned Nodes</h2>
          <button
            onClick={() => setShowAddNodeModal(true)}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            + Add Node
          </button>
        </div>
        {service.nodes.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No nodes assigned yet
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-sm font-medium text-gray-500">Hostname</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500">Role</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500">Health</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500">OS</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {service.nodes.map((node) => (
                <tr key={node.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/nodes/${node.node_id}`} className="text-blue-600 hover:underline">
                      {node.hostname}
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-sm">{node.role}</span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-sm ${statusColors[node.status]}`}>
                      {node.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className={healthColors[node.health_status]}>
                      {node.health_status === 'healthy' ? '●' : node.health_status === 'unhealthy' ? '○' : '◌'} {node.health_status}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500 text-sm">{node.os_name}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleRemoveNode(node.node_id)}
                      className="text-red-600 hover:underline text-sm"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reconciliation Log */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Activity Log</h2>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No activity yet</div>
        ) : (
          <div className="divide-y">
            {logs.map((log) => (
              <div key={log.id} className="p-3 flex items-start">
                <span className={`w-2 h-2 rounded-full mt-1.5 mr-3 ${
                  log.status === 'success' ? 'bg-green-500' : log.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                }`}></span>
                <div className="flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{log.action}</span>
                    {log.hostname && <span className="text-gray-500"> on {log.hostname}</span>}
                  </p>
                  <p className="text-xs text-gray-500">{log.message}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(log.started_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Node Modal */}
      {showAddNodeModal && (
        <AddNodeModal
          serviceId={serviceId}
          availableNodes={availableNodes}
          roles={service.available_roles || ['primary']}
          onClose={() => setShowAddNodeModal(false)}
          onAdded={() => {
            setShowAddNodeModal(false);
            fetchService();
            fetchLogs();
          }}
        />
      )}
    </div>
  );
}

function AddNodeModal({
  serviceId,
  availableNodes,
  roles,
  onClose,
  onAdded,
}: {
  serviceId: string;
  availableNodes: Node[];
  roles: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [nodeId, setNodeId] = useState(availableNodes[0]?.id || '');
  const [role, setRole] = useState(roles[0] || 'primary');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch(`${API_URL}/api/v1/services/${serviceId}/nodes`, {
        method: 'POST',
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, role }),
      });
      
      if (res.ok) {
        onAdded();
      } else {
        const err = await res.json();
        alert(err.detail || 'Failed to add node');
      }
    } catch (error) {
      alert('Error adding node');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Add Node to Service</h2>
        {availableNodes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>All nodes are already assigned to this service</p>
            <button onClick={onClose} className="mt-4 text-blue-600 hover:underline">Close</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Node</label>
              <select
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                className="w-full border rounded-lg p-2"
                required
              >
                {availableNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.hostname} {n.is_online ? '🟢' : '⚫'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full border rounded-lg p-2"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end space-x-2 pt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Node'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
