"use client";
import { apiClient } from "@/lib/api-client";

import { useEffect, useState } from "react";
import { Terminal, Zap, Rocket } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge as StatusBadgeNew, statusToVariant } from "@/components/ui/StatusBadge";
import { StandardPage } from "@/components/ui/StandardPage";



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
  targetName?: string;
  status: string;
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
  return <StatusBadgeNew variant={statusToVariant(status)} dot>{status}</StatusBadgeNew>;
}

function SummaryBar({ summary }: { summary: JobSummary }) {
  if (!summary) return null;
  const total = summary.total || 1;
  const segments = [
    { key: "success", count: summary.success, color: "bg-green-500" },
    { key: "running", count: summary.running, color: "bg-purple-500" },
    { key: "queued", count: summary.queued, color: "bg-blue-500" },
    { key: "pending", count: summary.pending, color: "bg-yellow-500" },
    { key: "failed", count: summary.failed, color: "bg-red-500" },
    { key: "cancelled", count: summary.cancelled, color: "bg-muted/500" },
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
  const [jobType, setJobType] = useState<"run" | "install_package">("run");
  const [targetType, setTargetType] = useState("all");
  const [targetId, setTargetId] = useState("");
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  
  // For package installation
  const [packages, setPackages] = useState<{id: string; name: string; displayName?: string; latestVersion?: string}[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versions, setVersions] = useState<{id: string; version: string}[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  
  // For node/group selection
  const [nodes, setNodes] = useState<{node_id: string; hostname: string}[]>([]);
  const [groups, setGroups] = useState<{id: string; name: string}[]>([]);

  useEffect(() => {
    // Fetch packages, nodes, and groups
    Promise.all([
      apiClient.get<{ packages: any[] }>(`/packages`, { showErrorToast: false }),
      apiClient.get<{ nodes: any[] }>(`/nodes`, { showErrorToast: false }),
      apiClient.get<{ groups: any[] }>(`/groups`, { showErrorToast: false }),
    ]).then(async ([pkgRes, nodeRes, groupRes]) => {
      if (pkgRes) { setPackages(pkgRes.packages || pkgRes || []); }
      if (nodeRes) { setNodes(nodeRes.nodes || nodeRes || []); }
      if (groupRes) { setGroups(groupRes.groups || groupRes || []); }
    });
  }, []);

  // Fetch versions when package changes
  useEffect(() => {
    if (selectedPackageId) {
      setLoadingVersions(true);
      setVersions([]);
      setSelectedVersionId("");
      apiClient.get<{ versions: any[] }>(`/packages/${selectedPackageId}`, { showErrorToast: false })
        
        .then(data => {
          if (data?.versions) {
            setVersions(data.versions);
          }
        })
        .finally(() => setLoadingVersions(false));
    }
  }, [selectedPackageId]);

  const selectedPackage = packages.find(p => p.id === selectedPackageId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let commandType = "run";
      let commandData: Record<string, unknown> = {};

      if (jobType === "run") {
        commandType = "run";
        commandData = {
          command: command.split(" "),
          timeout: 300,
        };
      } else if (jobType === "install_package") {
        commandType = "install_package";
        const pkg = packages.find(p => p.id === selectedPackageId);
        const ver = versions.find(v => v.id === selectedVersionId);
        commandData = {
          packageId: selectedPackageId,
          versionId: selectedVersionId,
          packageName: pkg?.displayName || pkg?.name,
          version: ver?.version,
        };
      }

      const body: Record<string, unknown> = {
        name: name || `${jobType === "install_package" ? "Install " + (selectedPackage?.name || "Package") : "Job"} ${new Date().toLocaleTimeString()}`,
        targetType,
        commandType,
        commandData,
      };

      // Add target ID for specific targets
      if (targetType === "device" && targetId) {
        body.targetDeviceId = targetId;
      } else if (targetType === "group" && targetId) {
        body.targetGroupId = targetId;
      }

      const res = await apiClient.post(`/jobs`, body, { showErrorToast: false });

      if (res) {
        onCreated();
        onClose();
      } else {
        alert("Fehler beim Erstellen des Jobs");
      }
    } catch (err) {
      console.error("Failed to create job:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">Neuen Job erstellen</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Job Type */}
          <div>
            <label className="block text-sm text-zinc-400">Job-Typ</label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value as "run" | "install_package")}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            >
              <option value="run">🖥️ Befehl ausführen</option>
              <option value="install_package">📦 Paket installieren</option>
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm text-zinc-400">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={jobType === "install_package" ? "z.B. 7-Zip Installation" : "z.B. Windows Update Check"}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            />
          </div>
          
          {/* Target Type */}
          <div>
            <label className="block text-sm text-zinc-400">Ziel</label>
            <select
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setTargetId(""); }}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            >
              <option value="all">🌐 Alle Geräte</option>
              <option value="device">💻 Einzelnes Gerät</option>
              <option value="group">📁 Gruppe</option>
            </select>
          </div>

          {/* Target Selection */}
          {targetType === "device" && (
            <div>
              <label className="block text-sm text-zinc-400">Gerät auswählen</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                required
              >
                <option value="">-- Gerät wählen --</option>
                {nodes.map(n => (
                  <option key={n.node_id} value={n.node_id}>{n.hostname}</option>
                ))}
              </select>
            </div>
          )}

          {targetType === "group" && (
            <div>
              <label className="block text-sm text-zinc-400">Gruppe auswählen</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                required
              >
                <option value="">-- Gruppe wählen --</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Command (for run type) */}
          {jobType === "run" && (
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
          )}

          {/* Package Selection (for install_package type) */}
          {jobType === "install_package" && (
            <>
              <div>
                <label className="block text-sm text-zinc-400">Paket</label>
                <select
                  value={selectedPackageId}
                  onChange={(e) => { setSelectedPackageId(e.target.value); setSelectedVersionId(""); }}
                  className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                  required
                >
                  <option value="">-- Paket wählen --</option>
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {selectedPackageId && (
                <div>
                  <label className="block text-sm text-zinc-400">Version</label>
                  {loadingVersions ? (
                    <p className="text-zinc-500 text-sm mt-1">Lade Versionen...</p>
                  ) : versions.length > 0 ? (
                    <select
                      value={selectedVersionId}
                      onChange={(e) => setSelectedVersionId(e.target.value)}
                      className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                      required
                    >
                      <option value="">-- Version wählen --</option>
                      {versions.map(v => (
                        <option key={v.id} value={v.id}>{v.version}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-yellow-400 text-sm mt-1">⚠️ Dieses Paket hat noch keine Versionen. Bitte erst eine Version hinzufügen.</p>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading || (jobType === "install_package" && (!selectedPackageId || !selectedVersionId || versions.length === 0))}
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

function JobDetailPanel({ job, onClose, onRetry }: { job: JobDetail; onClose: () => void; onRetry: (instanceId: string) => void }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto bg-zinc-800 p-6 shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">{job.name}</h2>
        <div className="flex items-center gap-2">
          {(job.status === "pending" || job.status === "queued" || job.status === "running") && (
            <button
              onClick={async () => {
                if (!confirm("Job abbrechen?")) return;
                await apiClient.delete(`/jobs/${job.id}`);
                onClose();
              }}
              className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-medium"
            >
              ✋ Abbrechen
            </button>
          )}
          {(job.status === "completed" || job.status === "failed" || job.status === "cancelled") && (
            <button
              onClick={async () => {
                if (!confirm("Job endgültig löschen?")) return;
                await apiClient.delete(`/jobs/${job.id}`);
                onClose();
              }}
              className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium"
            >
              🗑️ Löschen
            </button>
          )}
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl">×</button>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-zinc-400">Typ:</span>
            <span className="ml-2 text-white">{job.commandType}</span>
          </div>
          <div>
            <span className="text-zinc-400">Ziel:</span>
            <span className="ml-2 text-white">{job.targetName || job.targetType}</span>
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
                            {Array.isArray(job.commandData?.command) ? job.commandData.command.join(" ") : JSON.stringify(job.commandData)}
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
              <div className="flex items-center gap-2">
                <StatusBadge status={inst.status} />
                {(inst.status === "failed" || inst.status === "cancelled") && (
                  <button
                    onClick={() => onRetry(inst.id)}
                    className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs"
                  >
                    🔄 Retry
                  </button>
                )}
              </div>
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
      const data = await apiClient.get<{ jobs: any[] }>(`/jobs`, { showErrorToast: false });
      setJobs((data?.jobs || []).map((j: any) => ({
        id: j.job_id || j.id,
        name: j.name,
        status: j.status || "unknown",
        commandType: j.command_type || j.commandType,
        targetType: j.target_type || j.targetType,
        targetName: j.targetName || j.target_name || j.targetType || j.target_type,
        createdAt: j.created_at || j.createdAt,
        summary: j.summary || {
          total: j.total_instances ?? 0,
          pending: j.pending ?? 0,
          queued: j.queued ?? 0,
          running: j.running ?? 0,
          success: j.success ?? 0,
          failed: j.failed ?? 0,
          cancelled: j.cancelled ?? 0,
        },
      })));
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchJobDetail = async (jobId: string) => {
    try {
      const data = await apiClient.get<JobDetail>(`/jobs/${jobId}`, { showErrorToast: false });
      setSelectedJob(data ?? null);
    } catch (err) {
      console.error("Failed to fetch job detail:", err);
    }
  };

  const retryInstance = async (instanceId: string) => {
    try {
      const res = await apiClient.post(`/jobs/instances/${instanceId}/retry`, {}, { showErrorToast: false });
      if (res) {
        // Refresh the job detail
        if (selectedJob) {
          fetchJobDetail(selectedJob.id);
        }
        fetchJobs();
      } else {
        alert("Retry fehlgeschlagen");
      }
    } catch (err) {
      console.error("Failed to retry instance:", err);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <StandardPage
      title="Jobs"
      description="Remote-Befehle an Geräte und Gruppen senden"
      icon={<Zap className="h-6 w-6" />}
      loading={loading}
      actions={
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500"
        >
          + Neuer Job
        </button>
      }
    >
      <div className="mx-auto max-w-6xl">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Gesamt", value: jobs.length, icon: "📋" },
            { label: "Laufend", value: jobs.reduce((a, j) => a + (j?.summary?.running ?? 0), 0), icon: "⚡" },
            { label: "Erfolgreich", value: jobs.reduce((a, j) => a + (j?.summary?.success ?? 0), 0), icon: "✅" },
            { label: "Fehlgeschlagen", value: jobs.reduce((a, j) => a + (j?.summary?.failed ?? 0), 0), icon: "❌" },
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
          <div className="text-center py-20">
            <div className="flex justify-center gap-4 mb-6 text-zinc-500">
              <Terminal className="w-10 h-10" />
              <Zap className="w-10 h-10 text-purple-400" />
              <Rocket className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Keine Jobs vorhanden</h2>
            <p className="text-zinc-400 mb-1">Erstelle deinen ersten Job um Befehle remote auszuführen.</p>
            <p className="text-zinc-500 text-sm mb-6">Jobs können Shell-Kommandos, Skripte oder Paket-Installationen auf deinen Nodes ausführen.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-8 py-3 text-white font-semibold hover:from-purple-500 hover:to-indigo-500 transition-all shadow-lg shadow-purple-900/30"
            >
              🚀 Ersten Job erstellen
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
                    <td className="px-4 py-3 text-zinc-300">{job.targetName || job.targetType}</td>
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
          onRetry={retryInstance}
        />
      )}
    </StandardPage>
  );
}
