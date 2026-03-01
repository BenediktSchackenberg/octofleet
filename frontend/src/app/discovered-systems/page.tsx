'use client';

import { useState, useEffect } from 'react';
import { Navbar } from '@/components/Navbar';
interface DiscoveredSystem {
  id: string;
  mac_address: string;
  ip_address: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  boot_mode: string | null;
  first_seen: string;
  last_seen: string;
  boot_count: number;
  status: string;
  notes: string | null;
  tags: string[] | null;
}

export default function DiscoveredSystemsPage() {
  const [systems, setSystems] = useState<DiscoveredSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchSystems = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      
      const res = await fetch(`/api/v1/discovered-systems?${params}`, {
        headers: { 'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '' }
      });
      
      if (!res.ok) throw new Error('Failed to fetch systems');
      const data = await res.json();
      setSystems(data.systems || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSystems();
    const interval = setInterval(fetchSystems, 30000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/v1/discovered-systems/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || ''
        },
        body: JSON.stringify({ status })
      });
      fetchSystems();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const deleteSystem = async (id: string) => {
    if (!confirm('Delete this system from the registry?')) return;
    try {
      await fetch(`/api/v1/discovered-systems/${id}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || '' }
      });
      fetchSystems();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      discovered: 'bg-blue-500/20 text-blue-400',
      pending: 'bg-yellow-500/20 text-yellow-400',
      provisioning: 'bg-purple-500/20 text-purple-400',
      provisioned: 'bg-green-500/20 text-green-400',
      ignored: 'bg-muted/500/20 text-muted-foreground'
    };
    return colors[status] || 'bg-muted/500/20 text-muted-foreground';
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-zinc-900">
      <Navbar />
      <div className="container mx-auto px-4 py-8">
<div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Discovered Systems</h1>
            <p className="text-muted-foreground">Systems detected via PXE boot</p>
          </div>
          
          <div className="flex gap-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-zinc-800 text-white rounded px-3 py-2 border border-border"
            >
              <option value="">All Status</option>
              <option value="discovered">Discovered</option>
              <option value="pending">Pending</option>
              <option value="provisioning">Provisioning</option>
              <option value="provisioned">Provisioned</option>
              <option value="ignored">Ignored</option>
            </select>
            
            <button
              onClick={fetchSystems}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">{error}</div>
        ) : systems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h2 className="text-xl text-muted-foreground mb-2">No systems discovered yet</h2>
            <p className="text-muted-foreground">Systems will appear here when they boot via PXE</p>
          </div>
        ) : (
          <div className="bg-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-muted-foreground">MAC Address</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">IP</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">Hostname</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">Boot Mode</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">Boots</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">Last Seen</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {systems.map((system) => (
                  <tr key={system.id} className="border-t border-border hover:bg-gray-750">
                    <td className="px-4 py-3 font-mono text-sm text-white">
                      {system.mac_address}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {system.ip_address || '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {system.hostname || '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {system.boot_mode || '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {system.boot_count}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">
                      {formatDate(system.last_seen)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs ${getStatusBadge(system.status)}`}>
                        {system.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {system.status === 'discovered' && (
                          <>
                            <button
                              onClick={() => updateStatus(system.id, 'pending')}
                              className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded"
                            >
                              Provision
                            </button>
                            <button
                              onClick={() => updateStatus(system.id, 'ignored')}
                              className="text-xs bg-gray-600 hover:bg-gray-700 text-white px-2 py-1 rounded"
                            >
                              Ignore
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => deleteSystem(system.id)}
                          className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
