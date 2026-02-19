'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const getAuthHeaders = () => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return {
    'Content-Type': 'application/json',
    'X-API-Key': 'octofleet-inventory-dev-key',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

interface RepoFile {
  id: string;
  filename: string;
  displayName: string;
  version: string | null;
  type: string;
  category: string | null;
  sha256: string;
  size: number;
  downloads: number;
  downloadUrl: string;
}

interface RepoStats {
  totalFiles: number;
  totalSize: number;
  totalSizeFormatted: string;
  totalDownloads: number;
  byType: Array<{ type: string; count: number; size: number }>;
}

export default function RepoPage() {
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCacheModal, setShowCacheModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (typeFilter) params.append('file_type', typeFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      
      const res = await fetch(`${API_BASE}/api/v1/repo/files?${params}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files || []);
      }
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  }, [searchQuery, typeFilter, categoryFilter]);

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/repo/stats`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        setStats(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  useEffect(() => {
    Promise.all([fetchFiles(), fetchStats()]).finally(() => setLoading(false));
  }, [fetchFiles]);

  useEffect(() => {
    const timer = setTimeout(fetchFiles, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, typeFilter, categoryFilter, fetchFiles]);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} B`;
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUploading(true);
    
    const form = e.currentTarget;
    const formData = new FormData(form);
    
    try {
      const res = await fetch(`${API_BASE}/api/v1/repo/upload`, {
        method: 'POST',
        headers: { 'X-API-Key': getAuthHeaders()['X-API-Key'] },
        body: formData
      });
      
      if (!res.ok) throw new Error('Upload failed');
      
      setShowUploadModal(false);
      fetchFiles();
      fetchStats();
      form.reset();
    } catch (err) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  const handleCache = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUploading(true);
    
    const form = e.currentTarget;
    const formData = new FormData(form);
    const data = {
      url: formData.get('url'),
      display_name: formData.get('display_name'),
      version: formData.get('version'),
      category: formData.get('category')
    };
    
    try {
      const res = await fetch(`${API_BASE}/api/v1/repo/cache`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Cache failed');
      }
      
      setShowCacheModal(false);
      fetchFiles();
      fetchStats();
      form.reset();
    } catch (err) {
      alert('Cache failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, filename: string) => {
    if (!confirm(`Delete ${filename}?`)) return;
    
    try {
      const res = await fetch(`${API_BASE}/api/v1/repo/files/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        fetchFiles();
        fetchStats();
      }
    } catch (err) {
      alert('Delete failed');
    }
  };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      'msi': '📦',
      'exe': '⚙️',
      'ps1': '📜',
      'script': '📜',
      'sql-cu': '🗄️',
      'zip': '🗜️',
      'cab': '📁',
      'other': '📄'
    };
    return icons[type] || '📄';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              📦 Software Repository
            </h1>
            <p className="text-gray-500 mt-1">Local package storage for your fleet</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCacheModal(true)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
            >
              🔗 Cache URL
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              ⬆️ Upload
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow p-6">
              <div className="text-3xl font-bold">{stats.totalFiles}</div>
              <div className="text-gray-500">Total Files</div>
            </div>
            <div className="bg-white rounded-xl shadow p-6">
              <div className="text-3xl font-bold">{stats.totalSizeFormatted}</div>
              <div className="text-gray-500">Total Size</div>
            </div>
            <div className="bg-white rounded-xl shadow p-6">
              <div className="text-3xl font-bold">{stats.totalDownloads}</div>
              <div className="text-gray-500">Downloads</div>
            </div>
            <div className="bg-white rounded-xl shadow p-6">
              <div className="flex gap-2 flex-wrap">
                {stats.byType.map(t => (
                  <span key={t.type} className="px-2 py-1 bg-gray-100 rounded text-sm">
                    {getTypeIcon(t.type)} {t.count}
                  </span>
                ))}
              </div>
              <div className="text-gray-500 mt-2">By Type</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="🔍 Search files..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 border rounded-lg px-4 py-2"
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="border rounded-lg px-4 py-2"
          >
            <option value="">All Types</option>
            <option value="msi">📦 MSI</option>
            <option value="exe">⚙️ EXE</option>
            <option value="ps1">📜 PowerShell</option>
            <option value="sql-cu">🗄️ SQL CU</option>
            <option value="zip">🗜️ ZIP</option>
            <option value="other">📄 Other</option>
          </select>
          <input
            type="text"
            placeholder="Category..."
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="border rounded-lg px-4 py-2 w-40"
          />
        </div>

        {/* Files Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Downloads</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {files.map(file => (
                <tr key={file.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-medium">{file.displayName}</div>
                    <div className="text-sm text-gray-500">{file.filename}</div>
                    {file.category && (
                      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                        {file.category}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-lg">{getTypeIcon(file.type)}</span>
                    <span className="ml-2 text-sm text-gray-600">{file.type.toUpperCase()}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{file.version || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatSize(file.size)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{file.downloads}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <a
                        href={`${API_BASE}${file.downloadUrl}`}
                        className="text-blue-600 hover:underline text-sm"
                        download
                      >
                        ⬇️ Download
                      </a>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${API_BASE}${file.downloadUrl}`)}
                        className="text-gray-500 hover:text-gray-700 text-sm"
                      >
                        📋 Copy URL
                      </button>
                      <button
                        onClick={() => handleDelete(file.id, file.filename)}
                        className="text-red-600 hover:text-red-700 text-sm"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {files.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No files in repository. Upload some packages to get started!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold mb-4">⬆️ Upload File</h2>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">File *</label>
                <input
                  type="file"
                  name="file"
                  required
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Display Name</label>
                <input
                  type="text"
                  name="display_name"
                  placeholder="Friendly name"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Version</label>
                  <input
                    type="text"
                    name="version"
                    placeholder="1.0.0"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <input
                    type="text"
                    name="category"
                    placeholder="sql-updates"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cache Modal */}
      {showCacheModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold mb-4">🔗 Cache Remote URL</h2>
            <form onSubmit={handleCache} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">URL *</label>
                <input
                  type="url"
                  name="url"
                  required
                  placeholder="https://download.microsoft.com/..."
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Display Name</label>
                <input
                  type="text"
                  name="display_name"
                  placeholder="SQL Server 2022 CU15"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Version</label>
                  <input
                    type="text"
                    name="version"
                    placeholder="CU15"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <input
                    type="text"
                    name="category"
                    placeholder="sql-cu"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
              </div>
              <p className="text-sm text-gray-500">
                This will download the file from the URL and store it locally.
              </p>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCacheModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {uploading ? 'Caching...' : 'Cache File'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
