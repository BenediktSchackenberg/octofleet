"use client";

import { useState, useEffect } from "react";
import {
  HardDrive,
  Network,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
  ChevronLeft,
  Server,
  Monitor,
  Disc,
  FolderOpen,
  RefreshCw,
  Play,
  Check,
} from "lucide-react";
import Link from "next/link";
import { API_BASE } from '@/lib/api-config';


const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "octofleet-inventory-dev-key";

interface ProvisioningImage {
  id: string;
  name: string;
  display_name: string;
  wim_path: string;
  wim_index: number;
  os_type: string | null;
  os_version: string | null;
  edition: string | null;
  architecture: string;
  is_active: boolean;
}

interface ProvisioningTemplate {
  platform: string;
  display_name: string;
  ipxe_template: string;
  drivers: string[];
  notes: string | null;
  is_active: boolean;
}

interface ISOInfo {
  path: string;
  name: string;
  size: number;
  size_human: string;
  detected_os: string | null;
  mounted: boolean;
  mount_target: string | null;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API Error: ${res.status}`);
  }
  return res.json();
}

// ============================================
// Image Form Modal
// ============================================
function ImageModal({
  image,
  onClose,
  onSaved,
}: {
  image: ProvisioningImage | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!image;
  const [form, setForm] = useState({
    name: image?.name || "",
    display_name: image?.display_name || "",
    wim_path: image?.wim_path || "/images/",
    wim_index: image?.wim_index || 1,
    os_type: image?.os_type || "windows-server",
    os_version: image?.os_version || "",
    edition: image?.edition || "",
    architecture: image?.architecture || "amd64",
    is_active: image?.is_active ?? true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!form.name || !form.display_name || !form.wim_path) {
      setError("Name, Display Name, and Path are required");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit) {
        await fetchApi(`/api/v1/provisioning/images/${image.id}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
      } else {
        await fetchApi("/api/v1/provisioning/images", {
          method: "POST",
          body: JSON.stringify(form),
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-xl">
        <div className="p-4 border-b border-zinc-700 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {isEdit ? "Edit Image" : "Add New Image"}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Name (ID) *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={isEdit}
                placeholder="win2025-standard"
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Display Name *</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Windows Server 2025 Standard"
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Path to WIM/Kernel *
              <span className="text-zinc-500 ml-2">(relative to PXE server /srv/images)</span>
            </label>
            <input
              type="text"
              value={form.wim_path}
              onChange={(e) => setForm({ ...form, wim_path: e.target.value })}
              placeholder="/images/win2025/install.wim"
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">OS Type</label>
              <select
                value={form.os_type || ""}
                onChange={(e) => setForm({ ...form, os_type: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white"
              >
                <option value="windows-server">Windows Server</option>
                <option value="windows">Windows Client</option>
                <option value="linux">Linux</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Version</label>
              <input
                type="text"
                value={form.os_version || ""}
                onChange={(e) => setForm({ ...form, os_version: e.target.value })}
                placeholder="2025"
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Edition</label>
              <input
                type="text"
                value={form.edition || ""}
                onChange={(e) => setForm({ ...form, edition: e.target.value })}
                placeholder="Standard"
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">WIM Index</label>
              <input
                type="number"
                value={form.wim_index}
                onChange={(e) => setForm({ ...form, wim_index: parseInt(e.target.value) || 1 })}
                min={1}
                max={20}
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="rounded"
              />
              <span className="text-zinc-300">Active</span>
            </label>
            <select
              value={form.architecture}
              onChange={(e) => setForm({ ...form, architecture: e.target.value })}
              className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="amd64">amd64 (x64)</option>
              <option value="arm64">arm64</option>
            </select>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-2"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Admin Page
// ============================================
export default function ProvisioningAdminPage() {
  const [activeTab, setActiveTab] = useState<"isos" | "images" | "templates" | "nfs">("isos");
  const [images, setImages] = useState<ProvisioningImage[]>([]);
  const [templates, setTemplates] = useState<ProvisioningTemplate[]>([]);
  const [isos, setIsos] = useState<ISOInfo[]>([]);
  const [isoPath, setIsoPath] = useState("/mnt/isos");
  const [isLoading, setIsLoading] = useState(true);
  const [isoLoading, setIsoLoading] = useState(false);
  const [editingImage, setEditingImage] = useState<ProvisioningImage | null | "new">(null);
  const [setupStatus, setSetupStatus] = useState<Record<string, string>>({});
  
  // NFS State
  const [nfsMounts, setNfsMounts] = useState<{server: string; target: string; type: string; total?: string; used?: string; available?: string; percent?: string}[]>([]);
  const [nfsLoading, setNfsLoading] = useState(false);
  const [showNfsModal, setShowNfsModal] = useState(false);
  const [newNfs, setNewNfs] = useState({ server_path: "", mount_target: "/mnt/", add_to_fstab: true });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [imgData, tmplData] = await Promise.all([
        fetchApi<ProvisioningImage[]>("/api/v1/provisioning/images?active_only=false"),
        fetchApi<ProvisioningTemplate[]>("/api/v1/provisioning/templates"),
      ]);
      setImages(imgData);
      setTemplates(tmplData);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const scanIsos = async () => {
    setIsoLoading(true);
    try {
      const data = await fetchApi<{ iso_path: string; isos: ISOInfo[] }>(
        `/api/v1/provisioning/iso/scan?path=${encodeURIComponent(isoPath)}`
      );
      setIsos(data.isos);
    } catch (err) {
      console.error(err);
      alert("Failed to scan ISOs");
    } finally {
      setIsoLoading(false);
    }
  };

  const handleAutoSetup = async (iso: ISOInfo) => {
    setSetupStatus({ ...setupStatus, [iso.path]: "loading" });
    try {
      const result = await fetchApi<{ status: string; message?: string }>(
        `/api/v1/provisioning/iso/auto-setup?iso_path=${encodeURIComponent(iso.path)}`,
        { method: "POST" }
      );
      setSetupStatus({ ...setupStatus, [iso.path]: result.status });
      // Refresh ISO list and images
      await scanIsos();
      await loadData();
    } catch (err) {
      setSetupStatus({ ...setupStatus, [iso.path]: "error" });
      alert(`Setup failed: ${err}`);
    }
  };

  // NFS Functions
  const loadNfsMounts = async () => {
    setNfsLoading(true);
    try {
      const data = await fetchApi<{ mounts: typeof nfsMounts }>("/api/v1/provisioning/iso/nfs/list");
      setNfsMounts(data.mounts || []);
    } catch (err) {
      console.error(err);
    } finally {
      setNfsLoading(false);
    }
  };

  const handleMountNfs = async () => {
    if (!newNfs.server_path || !newNfs.mount_target) {
      alert("Server path and mount target are required");
      return;
    }
    try {
      await fetchApi("/api/v1/provisioning/iso/nfs/mount", {
        method: "POST",
        body: JSON.stringify(newNfs),
      });
      setShowNfsModal(false);
      setNewNfs({ server_path: "", mount_target: "/mnt/", add_to_fstab: true });
      await loadNfsMounts();
    } catch (err) {
      alert(`Mount failed: ${err}`);
    }
  };

  const handleUnmountNfs = async (target: string) => {
    if (!confirm(`Unmount ${target}?`)) return;
    try {
      await fetchApi(`/api/v1/provisioning/iso/nfs/unmount?target=${encodeURIComponent(target)}`, {
        method: "POST",
      });
      await loadNfsMounts();
    } catch (err) {
      alert(`Unmount failed: ${err}`);
    }
  };

  useEffect(() => {
    loadData();
    scanIsos();
    loadNfsMounts();
  }, []);

  const handleDeleteImage = async (id: string, name: string) => {
    if (!confirm(`Delete image "${name}"?`)) return;
    try {
      await fetchApi(`/api/v1/provisioning/images/${id}`, { method: "DELETE" });
      loadData();
    } catch (err) {
      alert("Failed to delete");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/provisioning"
            className="text-zinc-400 hover:text-white flex items-center gap-1 text-sm mb-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Provisioning
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <HardDrive className="h-6 w-6 text-amber-500" />
            Provisioning Admin
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Manage OS images and platform templates</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("isos")}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === "isos" ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            <Disc className="h-4 w-4 inline mr-2" />
            ISO Files ({isos.length})
          </button>
          <button
            onClick={() => setActiveTab("images")}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === "images" ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            OS Images ({images.length})
          </button>
          <button
            onClick={() => setActiveTab("templates")}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === "templates" ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            Templates ({templates.length})
          </button>
          <button
            onClick={() => setActiveTab("nfs")}
            className={`px-4 py-2 rounded-lg font-medium ${
              activeTab === "nfs" ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            <Network className="h-4 w-4 inline mr-2" />
            NFS Shares
          </button>
        </div>

        {/* ISO Tab */}
        {activeTab === "isos" && (
          <div className="space-y-4">
            {/* ISO Path Input */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-center gap-4">
                <FolderOpen className="h-5 w-5 text-zinc-400" />
                <input
                  type="text"
                  value={isoPath}
                  onChange={(e) => setIsoPath(e.target.value)}
                  placeholder="/mnt/isos"
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono"
                />
                <button
                  onClick={scanIsos}
                  disabled={isoLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                >
                  {isoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Scan
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-2">
                ISOs should be on an NFS share mounted to this path. Detected ISOs will be shown below.
              </p>
            </div>

            {/* ISO List */}
            {isoLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              </div>
            ) : isos.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
                <Disc className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">No ISO files found in {isoPath}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {isos.map((iso) => (
                  <div
                    key={iso.path}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className={`p-3 rounded-lg ${
                      iso.detected_os?.includes('windows') ? 'bg-blue-500/20' :
                      iso.detected_os?.includes('linux') ? 'bg-orange-500/20' :
                      iso.detected_os === 'drivers' ? 'bg-purple-500/20' :
                      'bg-zinc-800'
                    }`}>
                      <Disc className={`h-6 w-6 ${
                        iso.detected_os?.includes('windows') ? 'text-blue-400' :
                        iso.detected_os?.includes('linux') ? 'text-orange-400' :
                        iso.detected_os === 'drivers' ? 'text-purple-400' :
                        'text-zinc-400'
                      }`} />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-white">{iso.name}</div>
                      <div className="text-sm text-zinc-500">
                        {iso.size_human} • {iso.detected_os || 'Unknown OS'}
                        {iso.mounted && iso.mount_target && (
                          <span className="text-green-400 ml-2">
                            → Mounted at {iso.mount_target}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {iso.mounted ? (
                        <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm flex items-center gap-1">
                          <Check className="h-4 w-4" />
                          Mounted
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAutoSetup(iso)}
                          disabled={setupStatus[iso.path] === "loading"}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm"
                        >
                          {setupStatus[iso.path] === "loading" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          Setup
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Images Tab */}
        {activeTab === "images" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setEditingImage("new")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                <Plus className="h-4 w-4" />
                Add Image
              </button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead className="bg-zinc-800 text-zinc-400 text-sm">
                    <tr>
                      <th className="text-left px-4 py-3">Image</th>
                      <th className="text-left px-4 py-3">Path</th>
                      <th className="text-left px-4 py-3">Type</th>
                      <th className="text-left px-4 py-3">Index</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {images.map((img) => (
                      <tr key={img.id} className="hover:bg-zinc-800/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${
                              img.os_type === "linux" ? "bg-orange-500/20" : "bg-blue-500/20"
                            }`}>
                              {img.os_type === "linux" ? (
                                <Server className="h-4 w-4 text-orange-400" />
                              ) : (
                                <Monitor className="h-4 w-4 text-blue-400" />
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-white">{img.display_name}</div>
                              <div className="text-xs text-zinc-500 font-mono">{img.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
                            {img.wim_path}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-400">
                          {img.os_type} {img.os_version}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-400">{img.wim_index}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            img.is_active 
                              ? "bg-green-500/20 text-green-400" 
                              : "bg-zinc-700 text-zinc-400"
                          }`}>
                            {img.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setEditingImage(img)}
                            className="p-2 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-white"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteImage(img.id, img.display_name)}
                            className="p-2 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Templates Tab */}
        {activeTab === "templates" && (
          <div className="space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-zinc-800 text-zinc-400 text-sm">
                  <tr>
                    <th className="text-left px-4 py-3">Platform</th>
                    <th className="text-left px-4 py-3">Drivers</th>
                    <th className="text-left px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {templates.map((tmpl) => (
                    <tr key={tmpl.platform} className="hover:bg-zinc-800/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{tmpl.display_name}</div>
                        <div className="text-xs text-zinc-500 font-mono">{tmpl.platform}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">
                        {tmpl.drivers.length > 0 ? tmpl.drivers.join(", ") : "None"}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-500">{tmpl.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* NFS Tab */}
        {activeTab === "nfs" && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-zinc-400 text-sm">
                Mount NFS shares from your network storage to access ISO files.
              </p>
              <button
                onClick={() => setShowNfsModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                <Plus className="h-4 w-4" />
                Add NFS Share
              </button>
            </div>

            {nfsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              </div>
            ) : nfsMounts.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
                <Network className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">No NFS shares mounted</p>
                <p className="text-zinc-500 text-sm mt-1">Add a share to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {nfsMounts.map((mount) => (
                  <div
                    key={mount.target}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className="p-3 rounded-lg bg-blue-500/20">
                      <Server className="h-6 w-6 text-blue-400" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-white font-mono">{mount.server}</div>
                      <div className="text-sm text-zinc-500">
                        → {mount.target}
                        {mount.total && (
                          <span className="ml-4">
                            {mount.used} / {mount.total} ({mount.percent})
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-sm">
                      {mount.type}
                    </span>
                    <button
                      onClick={() => handleUnmountNfs(mount.target)}
                      className="p-2 hover:bg-zinc-700 rounded-lg text-zinc-400 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Modals */}
        {editingImage && (
          <ImageModal
            image={editingImage === "new" ? null : editingImage}
            onClose={() => setEditingImage(null)}
            onSaved={loadData}
          />
        )}

        {/* NFS Mount Modal */}
        {showNfsModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md">
              <div className="p-4 border-b border-zinc-700 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add NFS Share</h2>
                <button onClick={() => setShowNfsModal(false)} className="text-zinc-400 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">NFS Server:Path *</label>
                  <input
                    type="text"
                    value={newNfs.server_path}
                    onChange={(e) => setNewNfs({ ...newNfs, server_path: e.target.value })}
                    placeholder="192.168.0.24:/mnt/user/isos"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Mount Target *</label>
                  <input
                    type="text"
                    value={newNfs.mount_target}
                    onChange={(e) => setNewNfs({ ...newNfs, mount_target: e.target.value })}
                    placeholder="/mnt/isos"
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newNfs.add_to_fstab}
                    onChange={(e) => setNewNfs({ ...newNfs, add_to_fstab: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-zinc-300">Add to /etc/fstab (persistent across reboots)</span>
                </label>
              </div>
              <div className="p-4 border-t border-zinc-700 flex justify-end gap-3">
                <button
                  onClick={() => setShowNfsModal(false)}
                  className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleMountNfs}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium"
                >
                  Mount
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
