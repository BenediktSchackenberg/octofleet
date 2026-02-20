"use client";

import { useState } from "react";
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

// Mock data for provisioning jobs
const mockJobs = [
  {
    id: 1,
    hostname: "WEB-SERVER-01",
    mac: "52:54:00:65:d5:42",
    os: "Windows Server 2025 Standard",
    vlan: "Production",
    tentacle: "pxe-main",
    status: "applying",
    progress: 78,
    step: "DISM - Applying image...",
    startedAt: "21:45:00",
  },
  {
    id: 2,
    hostname: "DB-SERVER-02",
    mac: "52:54:00:aa:bb:cc",
    os: "Ubuntu 24.04 LTS",
    vlan: "Database",
    tentacle: "tentacle-db",
    status: "waiting",
    progress: 0,
    step: "Waiting for PXE boot...",
    startedAt: "21:52:00",
  },
  {
    id: 3,
    hostname: "APP-NODE-03",
    mac: "52:54:00:11:22:33",
    os: "Windows Server 2025 Core",
    vlan: "DMZ",
    tentacle: "tentacle-dmz",
    status: "completed",
    progress: 100,
    step: "Agent connected • RDP ready",
    startedAt: "20:30:00",
  },
  {
    id: 4,
    hostname: "CACHE-01",
    mac: "52:54:00:99:88:77",
    os: "Rocky Linux 9",
    vlan: "Production",
    tentacle: "pxe-main",
    status: "failed",
    progress: 45,
    step: "Error: SMB mount timeout",
    startedAt: "21:30:00",
  },
];

const mockTentacles = [
  { id: "pxe-main", name: "pxe-main", ip: "192.168.0.5", vlan: "Production", status: "online", jobs: 2 },
  { id: "tentacle-dmz", name: "tentacle-dmz", ip: "10.0.1.5", vlan: "DMZ", status: "online", jobs: 1 },
  { id: "tentacle-db", name: "tentacle-db", ip: "10.0.2.5", vlan: "Database", status: "online", jobs: 1 },
];

const mockUnknownMacs = [
  { mac: "52:54:00:ff:ee:dd", ip: "192.168.0.88", tentacle: "pxe-main", attempts: 3, lastSeen: "21:58:32" },
];

const mockImages = [
  { id: 1, name: "Windows Server 2025 Standard", os: "windows", size: "7.2 GB" },
  { id: 2, name: "Windows Server 2025 Core", os: "windows", size: "5.1 GB" },
  { id: 3, name: "Windows Server 2025 Datacenter", os: "windows", size: "7.4 GB" },
  { id: 4, name: "Ubuntu 24.04 LTS", os: "linux", size: "2.1 GB" },
  { id: 5, name: "Rocky Linux 9", os: "linux", size: "1.8 GB" },
];

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    waiting: { bg: "bg-yellow-500/20", text: "text-yellow-400", icon: <Clock className="h-3 w-3" /> },
    booting: { bg: "bg-blue-500/20", text: "text-blue-400", icon: <Wifi className="h-3 w-3" /> },
    applying: { bg: "bg-purple-500/20", text: "text-purple-400", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    completed: { bg: "bg-green-500/20", text: "text-green-400", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { bg: "bg-red-500/20", text: "text-red-400", icon: <XCircle className="h-3 w-3" /> },
  };

  const style = styles[status] || styles.waiting;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      {style.icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ProgressBar({ progress, status }: { progress: number; status: string }) {
  const colors: Record<string, string> = {
    waiting: "bg-yellow-500",
    booting: "bg-blue-500",
    applying: "bg-purple-500",
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

function NewJobModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [hostname, setHostname] = useState("");
  const [mac, setMac] = useState("");
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [networkMode, setNetworkMode] = useState<"dhcp" | "static">("dhcp");
  const [staticIp, setStaticIp] = useState("");
  const [installAgent, setInstallAgent] = useState(true);
  const [enableRdp, setEnableRdp] = useState(true);

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
          {/* Identity Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Identity</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Hostname</label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="WEB-SERVER-01"
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">MAC Address</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={mac}
                    onChange={(e) => setMac(e.target.value)}
                    placeholder="52:54:00:__:__:__"
                    className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                  />
                  <button className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-300 text-sm">
                    Detect
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* OS Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Operating System</h3>
            <div className="grid grid-cols-1 gap-2">
              {mockImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedImage(img.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    selectedImage === img.id
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <div className={`p-2 rounded-lg ${img.os === "windows" ? "bg-blue-500/20" : "bg-orange-500/20"}`}>
                    {img.os === "windows" ? (
                      <Monitor className="h-4 w-4 text-blue-400" />
                    ) : (
                      <Server className="h-4 w-4 text-orange-400" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium text-white">{img.name}</div>
                    <div className="text-xs text-zinc-500">{img.size}</div>
                  </div>
                  {selectedImage === img.id && (
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
                  className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                />
                <input
                  type="text"
                  placeholder="Gateway"
                  className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
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
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            Create Job &amp; Boot
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProvisioningPage() {
  const [showNewJob, setShowNewJob] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "tentacles" | "images" | "unknown">("queue");

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
          <button
            onClick={() => setShowNewJob(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
          >
            <Plus className="h-5 w-5" />
            New Job
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id: "queue", label: "Queue", count: mockJobs.length },
            { id: "tentacles", label: "Tentacles", count: mockTentacles.length },
            { id: "images", label: "Images", count: mockImages.length },
            { id: "unknown", label: "Unknown MACs", count: mockUnknownMacs.length },
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
              {tab.count > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-zinc-700 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Queue Tab */}
        {activeTab === "queue" && (
          <div className="space-y-4">
            {mockJobs.map((job) => (
              <div
                key={job.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {/* Progress Circle */}
                  <div className="relative">
                    <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                      job.status === "completed" ? "bg-green-500/20" :
                      job.status === "failed" ? "bg-red-500/20" :
                      job.status === "applying" ? "bg-purple-500/20" :
                      "bg-zinc-800"
                    }`}>
                      {job.status === "applying" ? (
                        <span className="text-xl font-bold text-purple-400">{job.progress}%</span>
                      ) : job.status === "completed" ? (
                        <CheckCircle2 className="h-8 w-8 text-green-400" />
                      ) : job.status === "failed" ? (
                        <XCircle className="h-8 w-8 text-red-400" />
                      ) : (
                        <Clock className="h-8 w-8 text-yellow-400" />
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold text-white">{job.hostname}</h3>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-400 mb-3">
                      <span className="font-mono">{job.mac}</span>
                      <span>•</span>
                      <span>{job.os}</span>
                      <span>•</span>
                      <span className="text-amber-400">{job.vlan}</span>
                    </div>
                    <ProgressBar progress={job.progress} status={job.status} />
                    <p className="text-sm text-zinc-500 mt-2">{job.step}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
                      <Eye className="h-5 w-5" />
                    </button>
                    {job.status === "failed" && (
                      <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-amber-400 transition-colors">
                        <RefreshCw className="h-5 w-5" />
                      </button>
                    )}
                    <button className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition-colors">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tentacles Tab */}
        {activeTab === "tentacles" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {mockTentacles.map((t) => (
              <div
                key={t.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Network className="h-6 w-6 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{t.name}</h3>
                    <p className="text-sm text-zinc-500 font-mono">{t.ip}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">VLAN</span>
                    <span className="text-amber-400">{t.vlan}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Status</span>
                    <span className="text-green-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      Online
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Active Jobs</span>
                    <span className="text-white">{t.jobs}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Images Tab */}
        {activeTab === "images" && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Image</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">OS Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Size</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-zinc-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {mockImages.map((img) => (
                  <tr key={img.id} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${img.os === "windows" ? "bg-blue-500/20" : "bg-orange-500/20"}`}>
                          {img.os === "windows" ? (
                            <Monitor className="h-4 w-4 text-blue-400" />
                          ) : (
                            <Server className="h-4 w-4 text-orange-400" />
                          )}
                        </div>
                        <span className="font-medium text-white">{img.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 capitalize">{img.os}</td>
                    <td className="px-4 py-3 text-zinc-400">{img.size}</td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-zinc-400 hover:text-red-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Unknown MACs Tab */}
        {activeTab === "unknown" && (
          <div className="space-y-4">
            {mockUnknownMacs.length > 0 ? (
              mockUnknownMacs.map((m, i) => (
                <div
                  key={i}
                  className="bg-zinc-900 border border-yellow-500/30 rounded-xl p-5"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-yellow-500/20">
                      <AlertCircle className="h-6 w-6 text-yellow-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-medium">New device PXE booting</p>
                      <div className="flex items-center gap-4 text-sm text-zinc-400 mt-1">
                        <span className="font-mono">{m.mac}</span>
                        <span>•</span>
                        <span>IP: {m.ip}</span>
                        <span>•</span>
                        <span>Tentacle: {m.tentacle}</span>
                        <span>•</span>
                        <span>{m.attempts} attempts</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowNewJob(true)}
                        className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium"
                      >
                        Create Job
                      </button>
                      <button className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-400 hover:text-white text-sm">
                        Ignore
                      </button>
                      <button className="px-4 py-2 rounded-lg border border-red-600/50 text-red-400 hover:bg-red-500/10 text-sm">
                        Block
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
                <Network className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-400">No unknown devices detected</p>
              </div>
            )}
          </div>
        )}
      </div>

      <NewJobModal isOpen={showNewJob} onClose={() => setShowNewJob(false)} />
    </div>
  );
}
