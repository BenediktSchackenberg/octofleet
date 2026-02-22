"use client";

import { useState, useEffect } from "react";
import {
  Network,
  Plus,
  Server,
  Monitor,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Wifi,
  HardDrive,
  Play,
  Trash2,
  Eye,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "octofleet-inventory-dev-key";

// Types
interface ProvisioningTask {
  id: string;
  mac_address: string;
  hostname: string | null;
  platform: string;
  image_name: string | null;
  image_display_name: string | null;
  status: string;
  status_message: string | null;
  progress_percent: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ProvisioningImage {
  id: string;
  name: string;
  display_name: string;
  os_type: string | null;
  os_version: string | null;
  edition: string | null;
  architecture: string;
  is_active: boolean;
}

interface ProvisioningTemplate {
  platform: string;
  display_name: string;
  drivers: string[];
  notes: string | null;
  is_active: boolean;
}

// API Functions
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
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    pending: { bg: "bg-yellow-500/20", text: "text-yellow-400", icon: <Clock className="h-3 w-3" /> },
    queued: { bg: "bg-yellow-500/20", text: "text-yellow-400", icon: <Clock className="h-3 w-3" /> },
    booting: { bg: "bg-blue-500/20", text: "text-blue-400", icon: <Wifi className="h-3 w-3" /> },
    installing: { bg: "bg-purple-500/20", text: "text-purple-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    completed: { bg: "bg-green-500/20", text: "text-green-400", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { bg: "bg-red-500/20", text: "text-red-400", icon: <XCircle className="h-3 w-3" /> },
  };

  const style = styles[status] || styles.pending;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      {style.icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ProgressBar({ progress, status }: { progress: number; status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500",
    queued: "bg-yellow-500",
    booting: "bg-blue-500",
    installing: "bg-purple-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
  };

  return (
    <div className="w-full bg-zinc-700 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${colors[status] || "bg-zinc-500"}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function NewJobModal({
  isOpen,
  onClose,
  onCreated,
  images,
  templates,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  images: ProvisioningImage[];
  templates: ProvisioningTemplate[];
}) {
  const [hostname, setHostname] = useState("");
  const [mac, setMac] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [networkMode, setNetworkMode] = useState<"dhcp" | "static">("dhcp");
  const [staticIp, setStaticIp] = useState("");
  const [gateway, setGateway] = useState("");
  const [subnet, setSubnet] = useState("/24");
  const [domainJoin, setDomainJoin] = useState(false);
  const [domainName, setDomainName] = useState("");
  const [installAgent, setInstallAgent] = useState(true);
  const [enableRdp, setEnableRdp] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MAC validation
  const isValidMac = (mac: string) => {
    const cleaned = mac.toUpperCase().replace(/-/g, ":");
    return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(cleaned);
  };

  const handleSubmit = async () => {
    setError(null);

    // Validation
    if (!mac || !isValidMac(mac)) {
      setError("Invalid MAC address format (e.g., 00:15:5D:00:23:03)");
      return;
    }
    if (!selectedImage) {
      setError("Please select an operating system");
      return;
    }
    if (!selectedPlatform) {
      setError("Please select a platform");
      return;
    }

    setIsSubmitting(true);

    try {
      await fetchApi("/api/v1/provisioning/tasks", {
        method: "POST",
        body: JSON.stringify({
          mac_address: mac.toUpperCase().replace(/-/g, ":"),
          hostname: hostname || null,
          platform: selectedPlatform,
          image_name: selectedImage,
        }),
      });

      // Success - reset form and close
      setHostname("");
      setMac("");
      setSelectedImage(null);
      setSelectedPlatform(null);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-zinc-700">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Monitor className="h-5 w-5 text-amber-500" />
            New Provisioning Job
          </h2>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Identity Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Identity</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Hostname (optional)</label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="WEB-SERVER-01"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">MAC Address *</label>
                <input
                  type="text"
                  value={mac}
                  onChange={(e) => setMac(e.target.value)}
                  placeholder="00:15:5D:00:23:03"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Platform Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Platform *</h3>
            <div className="grid grid-cols-3 gap-2">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.platform}
                  onClick={() => setSelectedPlatform(tmpl.platform)}
                  className={`p-3 rounded-lg border transition-all text-left ${
                    selectedPlatform === tmpl.platform
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <div className="font-medium text-white text-sm">{tmpl.display_name}</div>
                  {tmpl.notes && (
                    <div className="text-xs text-zinc-500 mt-1">{tmpl.notes}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* OS Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Operating System *</h3>
            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto">
              {images.map((img) => (
                <button
                  key={img.name}
                  onClick={() => setSelectedImage(img.name)}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    selectedImage === img.name
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${
                    img.os_type === "windows-server" || img.os_type === "windows"
                      ? "bg-blue-500/20"
                      : "bg-orange-500/20"
                  }`}>
                    {img.os_type === "windows-server" || img.os_type === "windows" ? (
                      <Monitor className="h-4 w-4 text-blue-400" />
                    ) : (
                      <Server className="h-4 w-4 text-orange-400" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-white">{img.display_name}</div>
                    <div className="text-xs text-zinc-500">{img.architecture} • {img.edition || img.os_type}</div>
                  </div>
                  {selectedImage === img.name && (
                    <CheckCircle2 className="h-5 w-5 text-amber-500" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Network */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Network</h3>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="network"
                  checked={networkMode === "dhcp"}
                  onChange={() => setNetworkMode("dhcp")}
                  className="text-amber-500"
                />
                <span className="text-zinc-300">DHCP</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="network"
                  checked={networkMode === "static"}
                  onChange={() => setNetworkMode("static")}
                  className="text-amber-500"
                />
                <span className="text-zinc-300">Static IP</span>
              </label>
            </div>
            {networkMode === "static" && (
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="192.168.0.100"
                  value={staticIp}
                  onChange={(e) => setStaticIp(e.target.value)}
                  className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                />
                <input
                  type="text"
                  placeholder="/24"
                  value={subnet}
                  onChange={(e) => setSubnet(e.target.value)}
                  className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                />
                <input
                  type="text"
                  placeholder="Gateway"
                  value={gateway}
                  onChange={(e) => setGateway(e.target.value)}
                  className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
            )}
          </div>

          {/* Domain Join (Windows only) */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Domain (Windows)</h3>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={domainJoin}
                onChange={(e) => setDomainJoin(e.target.checked)}
                className="rounded text-amber-500"
              />
              <span className="text-zinc-300">Join Domain</span>
            </label>
            {domainJoin && (
              <input
                type="text"
                placeholder="home.lab"
                value={domainName}
                onChange={(e) => setDomainName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
              />
            )}
          </div>

          {/* Options */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Options</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={installAgent}
                  onChange={(e) => setInstallAgent(e.target.checked)}
                  className="rounded text-amber-500"
                />
                <span className="text-zinc-300">Install Octofleet Agent</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableRdp}
                  onChange={(e) => setEnableRdp(e.target.checked)}
                  className="rounded text-amber-500"
                />
                <span className="text-zinc-300">Enable RDP</span>
              </label>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-zinc-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Create Job
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProvisioningPage() {
  const [showNewJob, setShowNewJob] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "templates" | "images">("queue");
  const [tasks, setTasks] = useState<ProvisioningTask[]>([]);
  const [images, setImages] = useState<ProvisioningImage[]>([]);
  const [templates, setTemplates] = useState<ProvisioningTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data from API
  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [tasksData, imagesData, templatesData] = await Promise.all([
        fetchApi<ProvisioningTask[]>("/api/v1/provisioning/tasks"),
        fetchApi<ProvisioningImage[]>("/api/v1/provisioning/images"),
        fetchApi<ProvisioningTemplate[]>("/api/v1/provisioning/templates"),
      ]);
      setTasks(tasksData);
      setImages(imagesData);
      setTemplates(templatesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      await fetchApi(`/api/v1/provisioning/tasks/${taskId}`, { method: "DELETE" });
      loadData();
    } catch (err) {
      alert("Failed to delete task");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Network className="h-8 w-8 text-amber-500" />
              Provisioning
            </h1>
            <p className="text-zinc-400 mt-1">Zero-Touch OS Deployment via PXE</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => setShowNewJob(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
            >
              <Plus className="h-5 w-5" />
              New Job
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 flex items-center gap-3">
            <AlertCircle className="h-5 w-5" />
            {error}
            <button onClick={loadData} className="ml-auto text-sm underline">
              Retry
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id: "queue", label: "Queue", count: tasks.length },
            { id: "templates", label: "Templates", count: templates.length },
            { id: "images", label: "Images", count: images.length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-amber-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              {tab.label}
              <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-700 text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Loading State */}
        {isLoading && tasks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
          </div>
        )}

        {/* Queue Tab */}
        {activeTab === "queue" && !isLoading && (
          <div className="space-y-4">
            {tasks.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <Network className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">No provisioning tasks</p>
                <button
                  onClick={() => setShowNewJob(true)}
                  className="mt-4 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm"
                >
                  Create First Job
                </button>
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Progress Circle */}
                    <div className="relative">
                      <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                        task.status === "completed" ? "bg-green-500/20" :
                        task.status === "failed" ? "bg-red-500/20" :
                        task.status === "installing" ? "bg-purple-500/20" :
                        "bg-zinc-800"
                      }`}>
                        {task.status === "installing" ? (
                          <span className="text-xl font-bold text-purple-400">{task.progress_percent}%</span>
                        ) : task.status === "completed" ? (
                          <CheckCircle2 className="h-8 w-8 text-green-400" />
                        ) : task.status === "failed" ? (
                          <XCircle className="h-8 w-8 text-red-400" />
                        ) : (
                          <Clock className="h-8 w-8 text-yellow-400" />
                        )}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-lg font-semibold text-white">
                          {task.hostname || task.mac_address}
                        </h3>
                        <StatusBadge status={task.status} />
                      </div>
                      <div className="flex items-center gap-4 text-sm text-zinc-400 mb-3">
                        <span className="font-mono">{task.mac_address}</span>
                        <span>•</span>
                        <span>{task.image_display_name || task.image_name}</span>
                        <span>•</span>
                        <span className="text-amber-400">{task.platform}</span>
                      </div>
                      <ProgressBar progress={task.progress_percent} status={task.status} />
                      <p className="text-sm text-zinc-500 mt-2">
                        {task.status_message || `Created ${new Date(task.created_at).toLocaleString()}`}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                        <Eye className="h-5 w-5" />
                      </button>
                      {task.status === "failed" && (
                        <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-amber-400 transition-colors">
                          <RefreshCw className="h-5 w-5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Templates Tab */}
        {activeTab === "templates" && !isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {templates.map((t) => (
              <div
                key={t.platform}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Network className="h-6 w-6 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{t.display_name}</h3>
                    <p className="text-sm text-zinc-500 font-mono">{t.platform}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Status</span>
                    <span className={t.is_active ? "text-green-400" : "text-red-400"}>
                      {t.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Drivers</span>
                    <span className="text-white">{t.drivers.length}</span>
                  </div>
                  {t.notes && (
                    <p className="text-zinc-500 text-xs mt-2">{t.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Images Tab */}
        {activeTab === "images" && !isLoading && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Image</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">OS Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Version</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Architecture</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {images.map((img) => (
                  <tr key={img.id} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          img.os_type === "windows-server" || img.os_type === "windows"
                            ? "bg-blue-500/20"
                            : "bg-orange-500/20"
                        }`}>
                          {img.os_type === "windows-server" || img.os_type === "windows" ? (
                            <Monitor className="h-4 w-4 text-blue-400" />
                          ) : (
                            <Server className="h-4 w-4 text-orange-400" />
                          )}
                        </div>
                        <div>
                          <span className="font-medium text-white">{img.display_name}</span>
                          <p className="text-xs text-zinc-500 font-mono">{img.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 capitalize">{img.os_type}</td>
                    <td className="px-4 py-3 text-zinc-400">{img.os_version}</td>
                    <td className="px-4 py-3 text-zinc-400">{img.architecture}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        img.is_active ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {img.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewJobModal
        isOpen={showNewJob}
        onClose={() => setShowNewJob(false)}
        onCreated={loadData}
        images={images}
        templates={templates}
      />
    </div>
  );
}
