"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

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
  errorMessage: string | null;
  durationMs: number | null;
  attempt: number;
}

interface JobDetail {
  id: string;
  name: string;
  description: string;
  targetType: string;
  targetId: string;
  targetTag: string | null;
  commandType: string;
  commandData: Record<string, unknown>;
  priority: number;
  scheduledAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  timeoutSeconds: number;
  instances: JobInstance[];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    queued: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    running: "bg-purple-500/20 text-purple-400 border-purple-500/30 animate-pulse",
    success: "bg-green-500/20 text-green-400 border-green-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    cancelled: "bg-gray-500/20 text-gray-400 border-gray-500/30",
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
    <span className={`px-3 py-1 rounded-full text-sm font-medium border ${colors[status] || "bg-gray-500/20 border-gray-500/30"}`}>
      {icons[status]} {status}
    </span>
  );
}

function CommandTypeBadge({ type }: { type: string }) {
  const labels: Record<string, { label: string; color: string }> = {
    run: { label: "Command", color: "bg-blue-500/20 text-blue-400" },
    script: { label: "Script", color: "bg-purple-500/20 text-purple-400" },
    install_package: { label: "Install Package", color: "bg-green-500/20 text-green-400" },
    uninstall_package: { label: "Uninstall Package", color: "bg-red-500/20 text-red-400" },
    inventory: { label: "Inventory", color: "bg-yellow-500/20 text-yellow-400" },
  };

  const config = labels[type] || { label: type, color: "bg-gray-500/20 text-gray-400" };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number | null): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedInstance, setExpandedInstance] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    fetchJob();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchJob, 5000);
    return () => clearInterval(interval);
  }, [jobId]);

  async function fetchJob() {
    try {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, {
        headers: { ...getAuthHeader() },
      });
      if (!res.ok) {
        if (res.status === 404) {
          setError("Job nicht gefunden");
        } else {
          setError(`Fehler: ${res.status}`);
        }
        return;
      }
      const data = await res.json();
      setJob(data);
      setError(null);
    } catch (err) {
      setError("Verbindung zum Server fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  async function retryInstance(instanceId: string) {
    setRetrying(instanceId);
    try {
      const res = await fetch(`${API_URL}/api/v1/jobs/${jobId}/instances/${instanceId}/retry`, {
        method: "POST",
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        await fetchJob();
      }
    } finally {
      setRetrying(null);
    }
  }

  async function retryAllFailed() {
    if (!job) return;
    const failedInstances = job.instances.filter((i) => i.status === "failed");
    for (const instance of failedInstances) {
      await retryInstance(instance.id);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="max-w-4xl mx-auto">
          <Breadcrumb items={[{ label: "Jobs", href: "/jobs" }, { label: "Fehler" }]} />
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
            <p className="text-red-400">{error || "Job nicht gefunden"}</p>
          </div>
        </div>
      </div>
    );
  }

  const successCount = job.instances.filter((i) => i.status === "success").length;
  const failedCount = job.instances.filter((i) => i.status === "failed").length;
  const runningCount = job.instances.filter((i) => i.status === "running").length;
  const pendingCount = job.instances.filter((i) => ["pending", "queued"].includes(i.status)).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto p-6">
        {/* Breadcrumb */}
        <Breadcrumb items={[{ label: "Jobs", href: "/jobs" }, { label: job.name }]} />
        
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3">
                {job.name}
                <CommandTypeBadge type={job.commandType} />
              </h1>
              {job.description && (
                <p className="text-zinc-400 mt-1">{job.description}</p>
              )}
            </div>
            {failedCount > 0 && (
              <button
                onClick={retryAllFailed}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                🔄 Alle fehlgeschlagenen wiederholen ({failedCount})
              </button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
            <div className="text-3xl font-bold text-green-400">{successCount}</div>
            <div className="text-sm text-zinc-400">Erfolgreich</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
            <div className="text-3xl font-bold text-red-400">{failedCount}</div>
            <div className="text-sm text-zinc-400">Fehlgeschlagen</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
            <div className="text-3xl font-bold text-purple-400">{runningCount}</div>
            <div className="text-sm text-zinc-400">Laufend</div>
          </div>
          <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
            <div className="text-3xl font-bold text-yellow-400">{pendingCount}</div>
            <div className="text-sm text-zinc-400">Ausstehend</div>
          </div>
        </div>

        {/* Job Info */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3">Job Details</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-zinc-500">Erstellt:</span>
              <div>{formatDate(job.createdAt)}</div>
            </div>
            <div>
              <span className="text-zinc-500">Ziel:</span>
              <div className="capitalize">{job.targetType}</div>
            </div>
            <div>
              <span className="text-zinc-500">Timeout:</span>
              <div>{job.timeoutSeconds}s</div>
            </div>
            <div>
              <span className="text-zinc-500">Priorität:</span>
              <div>{job.priority}</div>
            </div>
          </div>
          {Object.keys(job.commandData).length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800">
              <span className="text-zinc-500 text-sm">Command Data:</span>
              <pre className="mt-2 bg-zinc-950 rounded p-3 text-xs overflow-x-auto">
                {JSON.stringify(job.commandData, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Instances */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold">
              Instanzen ({job.instances.length})
            </h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {job.instances.map((instance) => (
              <div key={instance.id} className="p-4">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() =>
                    setExpandedInstance(
                      expandedInstance === instance.id ? null : instance.id
                    )
                  }
                >
                  <div className="flex items-center gap-4">
                    <StatusBadge status={instance.status} />
                    <Link
                      href={`/nodes/${instance.nodeId}`}
                      className="font-medium text-blue-400 hover:text-blue-300"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {instance.nodeId}
                    </Link>
                    {instance.attempt > 1 && (
                      <span className="text-xs text-zinc-500">
                        Versuch #{instance.attempt}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    {instance.exitCode !== null && (
                      <span
                        className={`text-sm ${
                          instance.exitCode === 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        Exit: {instance.exitCode}
                      </span>
                    )}
                    <span className="text-sm text-zinc-500">
                      {formatDate(instance.completedAt || instance.startedAt || instance.queuedAt)}
                    </span>
                    {instance.status === "failed" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          retryInstance(instance.id);
                        }}
                        disabled={retrying === instance.id}
                        className="px-3 py-1 bg-orange-600 hover:bg-orange-500 disabled:bg-orange-800 text-white rounded text-xs font-medium transition-colors"
                      >
                        {retrying === instance.id ? "..." : "🔄 Retry"}
                      </button>
                    )}
                    <span className="text-zinc-500">
                      {expandedInstance === instance.id ? "▼" : "▶"}
                    </span>
                  </div>
                </div>

                {expandedInstance === instance.id && (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500">Queued:</span>
                        <div>{formatDate(instance.queuedAt)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Gestartet:</span>
                        <div>{formatDate(instance.startedAt)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Beendet:</span>
                        <div>{formatDate(instance.completedAt)}</div>
                      </div>
                      <div>
                        <span className="text-zinc-500">Dauer:</span>
                        <div>{formatDuration(instance.durationMs)}</div>
                      </div>
                    </div>

                    {instance.stdout && (
                      <div>
                        <div className="text-sm text-zinc-500 mb-1">Output:</div>
                        <pre className="bg-zinc-950 rounded p-3 text-xs text-green-400 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                          {instance.stdout}
                        </pre>
                      </div>
                    )}

                    {instance.stderr && instance.stderr.trim() && (
                      <div>
                        <div className="text-sm text-zinc-500 mb-1">Errors:</div>
                        <pre className="bg-zinc-950 rounded p-3 text-xs text-red-400 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                          {instance.stderr}
                        </pre>
                      </div>
                    )}

                    {instance.errorMessage && (
                      <div>
                        <div className="text-sm text-zinc-500 mb-1">Error Message:</div>
                        <pre className="bg-red-950/50 border border-red-500/30 rounded p-3 text-xs text-red-400 overflow-x-auto">
                          {instance.errorMessage}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {job.instances.length === 0 && (
              <div className="p-8 text-center text-zinc-500">
                Keine Instanzen vorhanden
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
