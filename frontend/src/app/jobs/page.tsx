"use client";

import { useEffect, useState } from "react";

const API_URL = "http://192.168.0.5:8080";

interface JobSummary {
  total: number;
  pending: number;
  queued: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
}

interface Job {
  id: string;
  name: string;
  commandType: string;
  targetType: string;
  createdAt: string;
  summary: JobSummary;
}

interface JobInstance {
  id: string;
  nodeId: string;
  status: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
}

interface JobDetail extends Job {
  description: string;
  commandData: Record<string, unknown>;
  instances: JobInstance[];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400",
    queued: "bg-blue-500/20 text-blue-400",
    running: "bg-purple-500/20 text-purple-400 animate-pulse",
    success: "bg-green-500/20 text-green-400",
    failed: "bg-red-500/20 text-red-400",
    cancelled: "bg-gray-500/20 text-gray-400",
  };
  
  const icons: Record<string, string> = {
    pending: "⏳",
    queued: "📋",
    running: "⚡",
    success: "✅",
    failed: "❌",
    cancelled: "🚫",
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || "bg-gray-500/20"}`}>
      {icons[status]} {status}
    </span>
  );
}

function SummaryBar({ summary }: { summary: JobSummary }) {
  const total = summary.total || 1;
  const segments = [
    { key: "success", count: summary.success, color: "bg-green-500" },
    { key: "running", count: summary.running, color: "bg-purple-500" },
    { key: "queued", count: summary.queued, color: "bg-blue-500" },
    { key: "pending", count: summary.pending, color: "bg-yellow-500" },
    { key: "failed", count: summary.failed, color: "bg-red-500" },
    { key: "cancelled", count: summary.cancelled, color: "bg-gray-500" },
  ];

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-32 overflow-hidden rounded-full bg-zinc-700">
        {segments.map((seg) => (
          seg.count > 0 && (
            <div
              key={seg.key}
              className={seg.color}
              style={{ width: `${(seg.count / total) * 100}%` }}
            />
          )
        ))}
      </div>
      <span className="text-xs text-zinc-400">
        {summary.success}/{summary.total}
      </span>
    </div>
  );
}

function CreateJobDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("all");
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `Job ${new Date().toLocaleTimeString()}`,
          targetType,
          commandType: "run",
          commandData: {
            command: command.split(" "),
            timeout: 300,
          },
        }),
      });

      if (res.ok) {
        onCreated();
        onClose();
      }
    } catch (err) {
      console.error("Failed to create job:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">Neuen Job erstellen</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Windows Update Check"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm text-zinc-400">Ziel</label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            >
              <option value="all">Alle Geräte</option>
              <option value="device">Einzelnes Gerät</option>
              <option value="group">Gruppe</option>
              <option value="tag">Tag</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Befehl</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="z.B. hostname"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono"
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {loading ? "Erstelle..." : "Job erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function JobDetailPanel({ job, onClose }: { job: JobDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto bg-zinc-800 p-6 shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">{job.name}</h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl">×</button>
      </div>

      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-zinc-400">Typ:</span>
            <span className="ml-2 text-white">{job.commandType}</span>
          </div>
          <div>
            <span className="text-zinc-400">Ziel:</span>
            <span className="ml-2 text-white">{job.targetType}</span>
          </div>
          <div>
            <span className="text-zinc-400">Erstellt:</span>
            <span className="ml-2 text-white">{new Date(job.createdAt).toLocaleString("de-DE")}</span>
          </div>
        </div>

        {job.commandData && (
          <div>
            <span className="text-zinc-400 text-sm">Befehl:</span>
            <pre className="mt-1 rounded bg-zinc-900 p-3 text-sm text-green-400 font-mono overflow-x-auto">
              {job.commandData.command?.join(" ") || JSON.stringify(job.commandData)}
            </pre>
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold text-white mb-3">Instanzen ({job.instances.length})</h3>
      
      <div className="space-y-2">
        {job.instances.map((inst) => (
          <div key={inst.id} className="rounded bg-zinc-700/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-white">{inst.nodeId}</span>
              <StatusBadge status={inst.status} />
            </div>
            
            {inst.completedAt && (
              <div className="text-xs text-zinc-400 space-y-1">
                <div>Exit Code: {inst.exitCode}</div>
                <div>Dauer: {inst.durationMs}ms</div>
              </div>
            )}

            {inst.stdout && (
              <pre className="mt-2 rounded bg-zinc-900 p-2 text-xs text-green-400 font-mono max-h-32 overflow-auto">
                {inst.stdout}
              </pre>
            )}

            {inst.stderr && (
              <pre className="mt-2 rounded bg-zinc-900 p-2 text-xs text-red-400 font-mono max-h-32 overflow-auto">
                {inst.stderr}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/jobs`);
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJobDetail = async (jobId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`);
      const data = await res.json();
      setSelectedJob(data);
    } catch (err) {
      console.error("Failed to fetch job detail:", err);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-900 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">🚀 Jobs</h1>
            <p className="text-zinc-400">Remote-Befehle an Geräte und Gruppen senden</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500"
          >
            + Neuer Job
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Gesamt", value: jobs.length, icon: "📋" },
            { label: "Laufend", value: jobs.reduce((a, j) => a + j.summary.running, 0), icon: "⚡" },
            { label: "Erfolgreich", value: jobs.reduce((a, j) => a + j.summary.success, 0), icon: "✅" },
            { label: "Fehlgeschlagen", value: jobs.reduce((a, j) => a + j.summary.failed, 0), icon: "❌" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-zinc-800 p-4">
              <div className="text-2xl">{stat.icon}</div>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-sm text-zinc-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Job List */}
        {loading ? (
          <div className="text-center text-zinc-400 py-12">Lade Jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📭</div>
            <h2 className="text-xl font-semibold text-white mb-2">Keine Jobs vorhanden</h2>
            <p className="text-zinc-400 mb-4">Erstelle deinen ersten Job um Befehle remote auszuführen.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-purple-600 px-6 py-2 text-white hover:bg-purple-500"
            >
              Ersten Job erstellen
            </button>
          </div>
        ) : (
          <div className="rounded-lg bg-zinc-800 overflow-hidden">
            <table className="w-full">
              <thead className="bg-zinc-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Typ</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Ziel</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Fortschritt</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">Erstellt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="hover:bg-zinc-700/30 cursor-pointer"
                    onClick={() => fetchJobDetail(job.id)}
                  >
                    <td className="px-4 py-3 text-white font-medium">{job.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300">
                        {job.commandType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{job.targetType}</td>
                    <td className="px-4 py-3">
                      <SummaryBar summary={job.summary} />
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-sm">
                      {new Date(job.createdAt).toLocaleString("de-DE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateJobDialog
          onClose={() => setShowCreate(false)}
          onCreated={fetchJobs}
        />
      )}

      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
        />
      )}
    </div>
  );
}
