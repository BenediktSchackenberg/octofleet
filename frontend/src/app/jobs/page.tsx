"use client";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, Zap, Rocket } from "lucide-react";
import { StatusBadge as StatusBadgeNew, statusToVariant } from "@/components/ui/StatusBadge";
import { StandardPage } from "@/components/ui/StandardPage";
import { formatDateTime } from "@/lib/format";
import { TASK_WINDOW_HOURS } from "@/lib/tasks";

type T = (key: string, params?: Record<string, string | number>) => string;

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
  createdAt: string;
  summary: JobSummary;
}

interface JobInstance {
  id: string;
  nodeId: string;
  status: string;
  completedAt: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
}

interface JobDetail {
  id: string;
  name: string;
  commandType: string;
  targetType: string;
  targetName?: string;
  createdAt: string;
  commandData: Record<string, unknown>;
  instances: JobInstance[];
}

interface Counts { total: number; running: number; success: number; failed: number }

const STATUSES = ["failed", "running", "pending", "success", "cancelled"] as const;
/** Time ranges of the filter; the default is the window of the Tasks page and the sidebar badge */
const RANGES = { "24h": 24, "7d": TASK_WINDOW_HOURS, "30d": 30 * 24, all: 0 } as const;
type Range = keyof typeof RANGES;
const DEFAULT_RANGE: Range = "7d";
const PAGE_SIZE = 50;

interface Filters { q: string; status: string; type: string; range: Range; node: string }
const EMPTY_FILTERS: Filters = { q: "", status: "", type: "", range: DEFAULT_RANGE, node: "" };

/** Filters from the URL (?q=&status=&type=&range=&node=); unknown values are ignored */
function filtersFromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const range = p.get("range") as Range | null;
  const status = p.get("status") || "";
  return {
    q: p.get("q") || "",
    status: (STATUSES as readonly string[]).includes(status) ? status : "",
    type: p.get("type") || "",
    range: range && range in RANGES ? range : DEFAULT_RANGE,
    node: p.get("node") || "",
  };
}

/** Keeps the filters in the URL (replaceState: no history entry per change) */
function filtersToUrl(f: Filters) {
  const url = new URL(window.location.href);
  for (const key of ["q", "status", "type", "range", "node", "target"]) url.searchParams.delete(key);
  if (f.q) url.searchParams.set("q", f.q);
  if (f.status) url.searchParams.set("status", f.status);
  if (f.type) url.searchParams.set("type", f.type);
  if (f.range !== DEFAULT_RANGE) url.searchParams.set("range", f.range);
  if (f.node) url.searchParams.set("node", f.node);
  window.history.replaceState(window.history.state, "", url.toString());
}

/** The job's state from its instance counts */
function jobState(s: JobSummary): string {
  if (s.running + s.queued > 0) return "running";
  if (s.pending > 0) return "pending";
  if (s.failed > 0) return "failed";
  if (s.total > 0 && s.success === s.total) return "success";
  if (s.cancelled > 0) return "cancelled";
  return "pending";
}

function StatusBadge({ status, t }: { status: string; t: T }) {
  return <StatusBadgeNew variant={statusToVariant(status)} dot>{t(`jobsPage.status.${status}`)}</StatusBadgeNew>;
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
            <div key={seg.key} className={seg.color} style={{ width: `${(seg.count / total) * 100}%` }} />
          )
        ))}
      </div>
      <span className="text-xs text-zinc-400">{summary.success}/{summary.total}</span>
    </div>
  );
}

function CreateJobDialog({ onClose, onCreated, initialNode }: { onClose: () => void; onCreated: () => void; initialNode?: string }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [jobType, setJobType] = useState<"run" | "install_package">("run");
  const [targetType, setTargetType] = useState("all");
  const [targetId, setTargetId] = useState("");
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For package installation
  const [packages, setPackages] = useState<{id: string; name: string; displayName?: string; latestVersion?: string}[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [versions, setVersions] = useState<{id: string; version: string}[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // For node/group selection
  const [nodes, setNodes] = useState<{id: string; node_id: string; hostname: string}[]>([]);
  const [groups, setGroups] = useState<{id: string; name: string}[]>([]);

  useEffect(() => {
    Promise.all([
      apiClient.get<{ packages: any[] }>(`/packages`, { showErrorToast: false }),
      apiClient.get<{ nodes: any[] }>(`/nodes`, { showErrorToast: false }),
      apiClient.get<{ groups: any[] }>(`/groups`, { showErrorToast: false }),
    ]).then(async ([pkgRes, nodeRes, groupRes]) => {
      if (pkgRes) { setPackages(pkgRes.packages || pkgRes || []); }
      if (nodeRes) {
        const list = nodeRes.nodes || nodeRes || [];
        setNodes(list);
        // "Start job" on a node page opens the dialog with that node (?target=<node ID, UUID or hostname>)
        const match = initialNode && list.find((n: any) =>
          n.id === initialNode || n.node_id === initialNode || n.hostname?.toLowerCase() === initialNode.toLowerCase());
        if (match) { setTargetType("device"); setTargetId(match.id); }
      }
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
        .then(data => { if (data?.versions) setVersions(data.versions); })
        .finally(() => setLoadingVersions(false));
    }
  }, [selectedPackageId]);

  const selectedPackage = packages.find(p => p.id === selectedPackageId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let commandType = "run";
      let commandData: Record<string, unknown> = {};

      if (jobType === "run") {
        commandType = "run";
        commandData = { command: command.split(" "), timeout: 300 };
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
        name: name || (jobType === "install_package"
          ? t("jobsPage.create.defaultInstallName", { package: selectedPackage?.name || "?", time: formatDateTime(new Date()) })
          : t("jobsPage.create.defaultName", { time: formatDateTime(new Date()) })),
        targetType,
        commandType,
        commandData,
      };

      // The target the backend reads: targetId (node or group UUID)
      if ((targetType === "device" || targetType === "group") && targetId) {
        body.targetId = targetId;
      }

      const res = await apiClient.post(`/jobs`, body, { showErrorToast: false });
      if (res) {
        onCreated();
        onClose();
      } else {
        setError(t("jobsPage.create.failed"));
      }
    } catch (err) {
      console.error("Failed to create job:", err);
      setError(t("jobsPage.create.failed"));
    } finally {
      setLoading(false);
    }
  };

  const field = "mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">{t("jobsPage.create.title")}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400">{t("jobsPage.create.jobType")}</label>
            <select value={jobType} onChange={(e) => setJobType(e.target.value as "run" | "install_package")} className={field}>
              <option value="run">🖥️ {t("jobsPage.create.typeRun")}</option>
              <option value="install_package">📦 {t("jobsPage.create.typeInstall")}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">{t("jobsPage.create.name")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={jobType === "install_package" ? t("jobsPage.create.namePlaceholderInstall") : t("jobsPage.create.namePlaceholderRun")}
              className={field}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400">{t("jobsPage.create.target")}</label>
            <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setTargetId(""); }} className={field}>
              <option value="all">🌐 {t("jobsPage.create.targetAll")}</option>
              <option value="device">💻 {t("jobsPage.create.targetDevice")}</option>
              <option value="group">📁 {t("jobsPage.create.targetGroup")}</option>
            </select>
          </div>

          {targetType === "device" && (
            <div>
              <label className="block text-sm text-zinc-400">{t("jobsPage.create.selectDevice")}</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={field} required>
                <option value="">{t("jobsPage.create.chooseDevice")}</option>
                {nodes.map(n => (<option key={n.id} value={n.id}>{n.hostname}</option>))}
              </select>
            </div>
          )}

          {targetType === "group" && (
            <div>
              <label className="block text-sm text-zinc-400">{t("jobsPage.create.selectGroup")}</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={field} required>
                <option value="">{t("jobsPage.create.chooseGroup")}</option>
                {groups.map(g => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
            </div>
          )}

          {jobType === "run" && (
            <div>
              <label className="block text-sm text-zinc-400">{t("jobsPage.create.command")}</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t("jobsPage.create.commandPlaceholder")}
                className={`${field} font-mono`}
                required
              />
            </div>
          )}

          {jobType === "install_package" && (
            <>
              <div>
                <label className="block text-sm text-zinc-400">{t("jobsPage.create.package")}</label>
                <select
                  value={selectedPackageId}
                  onChange={(e) => { setSelectedPackageId(e.target.value); setSelectedVersionId(""); }}
                  className={field}
                  required
                >
                  <option value="">{t("jobsPage.create.choosePackage")}</option>
                  {packages.map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
              </div>

              {selectedPackageId && (
                <div>
                  <label className="block text-sm text-zinc-400">{t("jobsPage.create.version")}</label>
                  {loadingVersions ? (
                    <p className="text-zinc-500 text-sm mt-1">{t("jobsPage.create.loadingVersions")}</p>
                  ) : versions.length > 0 ? (
                    <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)} className={field} required>
                      <option value="">{t("jobsPage.create.chooseVersion")}</option>
                      {versions.map(v => (<option key={v.id} value={v.id}>{v.version}</option>))}
                    </select>
                  ) : (
                    <p className="text-yellow-400 text-sm mt-1">⚠️ {t("jobsPage.create.noVersions")}</p>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || (jobType === "install_package" && (!selectedPackageId || !selectedVersionId || versions.length === 0))}
              className="rounded bg-purple-600 px-4 py-2 text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {loading ? t("jobsPage.create.creating") : t("jobsPage.create.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** GET /jobs/{id} returns the job's database row (snake_case) with its instances */
function toJobDetail(data: Record<string, any>): JobDetail {
  return {
    id: String(data.id),
    name: data.name,
    commandType: data.commandType || data.command_type,
    targetType: data.targetType || data.target_type,
    targetName: data.targetName || data.target_name,
    createdAt: data.createdAt || data.created_at,
    commandData: (data.commandData || data.command_data || {}) as Record<string, unknown>,
    instances: (data.instances || []).map((i: Record<string, any>) => ({
      id: String(i.id),
      nodeId: i.nodeId || i.node_id,
      status: i.status,
      completedAt: i.completedAt || i.completed_at || null,
      exitCode: i.exitCode ?? i.exit_code ?? null,
      stdout: i.stdout ?? null,
      stderr: i.stderr ?? null,
      durationMs: i.durationMs ?? i.duration_ms ?? null,
    })),
  };
}

function JobDetailPanel({ job, nodeNames, onClose, onRetry }: {
  job: JobDetail; nodeNames: Map<string, string>; onClose: () => void; onRetry: (instanceId: string) => void;
}) {
  const { t } = useI18n();
  // The jobs table has no state of its own: a job can be cancelled while an instance has not finished
  const unfinished = job.instances.some((i) => ["pending", "queued", "running"].includes(i.status));
  const command = job.commandData?.command;
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto bg-zinc-800 p-6 shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">{job.name}</h2>
        <div className="flex items-center gap-2">
          {unfinished ? (
            <button
              onClick={async () => {
                if (!confirm(t("jobsPage.detail.confirmCancel"))) return;
                await apiClient.delete(`/jobs/${job.id}`);
                onClose();
              }}
              className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-medium"
            >
              ✋ {t("jobsPage.detail.cancel")}
            </button>
          ) : (
            <button
              onClick={async () => {
                if (!confirm(t("jobsPage.detail.confirmDelete"))) return;
                await apiClient.delete(`/jobs/${job.id}`);
                onClose();
              }}
              className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium"
            >
              🗑️ {t("jobsPage.detail.delete")}
            </button>
          )}
          <Link href={`/jobs/${job.id}`} className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm">
            {t("jobsPage.detail.openPage")}
          </Link>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl" aria-label={t("jobsPage.detail.close")}>×</button>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-zinc-400">{t("jobsPage.columns.type")}:</span><span className="ml-2 text-white">{job.commandType}</span></div>
          <div><span className="text-zinc-400">{t("jobsPage.columns.target")}:</span><span className="ml-2 text-white">{job.targetName || job.targetType}</span></div>
          <div><span className="text-zinc-400">{t("jobsPage.columns.created")}:</span><span className="ml-2 text-white">{formatDateTime(job.createdAt)}</span></div>
        </div>

        {job.commandData && Object.keys(job.commandData).length > 0 && (
          <div>
            <span className="text-zinc-400 text-sm">{t("jobsPage.detail.command")}:</span>
            <pre className="mt-1 rounded bg-zinc-900 p-3 text-sm text-green-400 font-mono overflow-x-auto">
              {Array.isArray(command) ? command.join(" ") : JSON.stringify(job.commandData)}
            </pre>
          </div>
        )}
      </div>

      <h3 className="text-lg font-semibold text-white mb-3">{t("jobsPage.detail.instances", { count: job.instances.length })}</h3>

      <div className="space-y-2">
        {job.instances.map((inst) => (
          <div key={inst.id} className="rounded bg-zinc-700/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <Link href={`/nodes/${inst.nodeId}`} className="font-medium text-blue-400 hover:text-blue-300">
                {nodeNames.get(inst.nodeId) || inst.nodeId}
              </Link>
              <div className="flex items-center gap-2">
                <StatusBadge status={inst.status} t={t} />
                {(inst.status === "failed" || inst.status === "cancelled") && (
                  <button onClick={() => onRetry(inst.id)} className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white text-xs">
                    🔄 {t("jobsPage.detail.retry")}
                  </button>
                )}
              </div>
            </div>

            {inst.completedAt && (
              <div className="text-xs text-zinc-400 space-y-1">
                <div>{t("jobsPage.detail.finished")}: {formatDateTime(inst.completedAt)}</div>
                <div>{t("jobsPage.detail.exitCode")}: {inst.exitCode ?? "-"}</div>
              </div>
            )}

            {inst.stdout && (
              <pre className="mt-2 rounded bg-zinc-900 p-2 text-xs text-green-400 font-mono max-h-32 overflow-auto whitespace-pre-wrap">{inst.stdout}</pre>
            )}
            {inst.stderr && (
              <pre className="mt-2 rounded bg-zinc-900 p-2 text-xs text-red-400 font-mono max-h-32 overflow-auto whitespace-pre-wrap">{inst.stderr}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function JobsPage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [commandTypes, setCommandTypes] = useState<string[]>([]);
  const [nodeNames, setNodeNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  // Filters are read from the URL after mounting (like useTabParam); null = not read yet
  const [filters, setFilters] = useState<Filters | null>(null);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  // ?target=<node> ("Start job" on the node page): open the dialog with that node
  const [initialNode, setInitialNode] = useState<string | undefined>(undefined);

  useEffect(() => {
    const f = filtersFromUrl();
    setFilters(f);
    setSearch(f.q);
    const target = new URLSearchParams(window.location.search).get("target");
    if (target) { setInitialNode(target); setShowCreate(true); }
    apiClient.get<{ nodes: { id: string; hostname?: string }[] }>("/nodes", { showErrorToast: false })
      .then((res) => setNodeNames(new Map((res?.nodes ?? []).map((n) => [n.id, n.hostname || n.id]))))
      .catch(() => {});
  }, []);

  const update = (change: Partial<Filters>) => {
    setFilters((current) => {
      const next = { ...(current ?? EMPTY_FILTERS), ...change };
      filtersToUrl(next);
      return next;
    });
    setOffset(0);
  };

  // Search: applied 300 ms after the last keystroke
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update({ q: value.trim() }), 300);
  };

  const fetchJobs = useCallback(async () => {
    if (!filters) return;
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (filters.node) params.set("node", filters.node);
      if (filters.status) params.set("status", filters.status);
      if (filters.type) params.set("command_type", filters.type);
      if (filters.q) params.set("q", filters.q);
      if (RANGES[filters.range]) params.set("since_hours", String(RANGES[filters.range]));
      const data = await apiClient.get<{ jobs: any[]; total: number; counts: Counts; command_types: string[] }>(
        `/jobs?${params.toString()}`, { showErrorToast: false });
      setJobs((data?.jobs || []).map((j: any) => ({
        id: j.job_id || j.id,
        name: j.name,
        commandType: j.command_type || j.commandType,
        targetType: j.target_type || j.targetType,
        targetName: j.target_name || j.targetName,
        createdAt: j.created_at || j.createdAt,
        summary: {
          total: j.total_instances ?? 0,
          pending: j.pending ?? 0,
          queued: j.queued ?? 0,
          running: j.running ?? 0,
          success: j.success ?? 0,
          failed: j.failed ?? 0,
          cancelled: j.cancelled ?? 0,
        },
      })));
      setTotal(data?.total ?? 0);
      setCounts(data?.counts ?? null);
      setCommandTypes(data?.command_types ?? []);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  const fetchJobDetail = async (jobId: string) => {
    try {
      const data = await apiClient.get<Record<string, any>>(`/jobs/${jobId}`, { showErrorToast: false });
      setSelectedJob(data ? toJobDetail(data) : null);
    } catch (err) {
      console.error("Failed to fetch job detail:", err);
    }
  };

  const retryInstance = async (instanceId: string) => {
    const res = await apiClient.post(`/jobs/instances/${instanceId}/retry`, {}, { showErrorToast: false }).catch(() => null);
    if (res) {
      if (selectedJob) fetchJobDetail(selectedJob.id);
      fetchJobs();
    } else {
      alert(t("jobsPage.detail.retryFailed"));
    }
  };

  useEffect(() => {
    if (!filters) return;
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [filters, fetchJobs]);

  const f = filters ?? EMPTY_FILTERS;
  const filtered = !!(f.q || f.status || f.type || f.node || f.range !== DEFAULT_RANGE);
  const rangeLabel = t(`jobsPage.range.${f.range}`);
  const cards: { key: string; label: string; value: number; icon: string; status: string }[] = [
    { key: "total", label: t("jobsPage.cards.total"), value: counts?.total ?? 0, icon: "📋", status: "" },
    { key: "running", label: t("jobsPage.cards.running"), value: counts?.running ?? 0, icon: "⚡", status: "running" },
    { key: "success", label: t("jobsPage.cards.success"), value: counts?.success ?? 0, icon: "✅", status: "success" },
    { key: "failed", label: t("jobsPage.cards.failed"), value: counts?.failed ?? 0, icon: "❌", status: "failed" },
  ];
  const select = "rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white";

  return (
    <StandardPage
      title={t("jobsPage.title")}
      description={t("jobsPage.description")}
      icon={<Zap className="h-6 w-6" />}
      loading={loading}
      actions={
        <button onClick={() => setShowCreate(true)} className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-500">
          + {t("jobsPage.newJob")}
        </button>
      }
    >
      <div className="mx-auto max-w-6xl">
        {/* Filter bar - kept in the URL */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t("jobsPage.filters.search")}
            aria-label={t("jobsPage.filters.search")}
            className={`${select} w-64`}
          />
          <select value={f.status} onChange={(e) => update({ status: e.target.value })} className={select} aria-label={t("jobsPage.filters.status")}>
            <option value="">{t("jobsPage.filters.allStatuses")}</option>
            {STATUSES.map((s) => (<option key={s} value={s}>{t(`jobsPage.status.${s}`)}</option>))}
          </select>
          <select value={f.type} onChange={(e) => update({ type: e.target.value })} className={select} aria-label={t("jobsPage.filters.type")}>
            <option value="">{t("jobsPage.filters.allTypes")}</option>
            {commandTypes.map((type) => (<option key={type} value={type}>{type}</option>))}
          </select>
          <select value={f.range} onChange={(e) => update({ range: e.target.value as Range })} className={select} aria-label={t("jobsPage.filters.range")}>
            {(Object.keys(RANGES) as Range[]).map((r) => (<option key={r} value={r}>{t(`jobsPage.range.${r}`)}</option>))}
          </select>
          {f.node && (
            <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 text-sm">
              {t("jobsPage.forNode", { node: nodeNames.get(f.node) || f.node })}
              <button onClick={() => update({ node: "" })} className="ml-2 hover:text-white" aria-label={t("jobsPage.filters.removeNode")}>×</button>
            </span>
          )}
          {filtered && (
            <button
              onClick={() => { setSearch(""); update({ ...EMPTY_FILTERS }); }}
              className="text-sm text-zinc-400 hover:text-white underline"
            >
              {t("jobsPage.showAllJobs")}
            </button>
          )}
        </div>

        {/* Counts of the jobs matching the filters (without the status), for the selected time range */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
          {cards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => update({ status: f.status === card.status ? "" : card.status })}
              className={`rounded-lg bg-zinc-800 p-4 text-left border transition-colors ${
                f.status === card.status && card.status ? "border-purple-500" : "border-transparent hover:border-zinc-600"}`}
            >
              <div className="text-2xl">{card.icon}</div>
              <div className="text-2xl font-bold text-white">{card.value}</div>
              <div className="text-sm text-zinc-400">{card.label}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-zinc-500 mb-6">{t("jobsPage.cardsNote", { range: rangeLabel })}</p>

        {loading ? (
          <div className="text-center text-zinc-400 py-12">{t("jobsPage.loading")}</div>
        ) : jobs.length === 0 && !filtered ? (
          <div className="text-center py-20">
            <div className="flex justify-center gap-4 mb-6 text-zinc-500">
              <Terminal className="w-10 h-10" />
              <Zap className="w-10 h-10 text-purple-400" />
              <Rocket className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">{t("jobsPage.empty.title")}</h2>
            <p className="text-zinc-400 mb-1">{t("jobsPage.empty.text")}</p>
            <p className="text-zinc-500 text-sm mb-6">{t("jobsPage.empty.hint")}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-8 py-3 text-white font-semibold hover:from-purple-500 hover:to-indigo-500 transition-all shadow-lg shadow-purple-900/30"
            >
              🚀 {t("jobsPage.empty.create")}
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center text-zinc-400 py-12">{t("jobsPage.noMatches")}</div>
        ) : (
          <>
            <div className="rounded-lg bg-zinc-800 overflow-hidden">
              <table className="w-full">
                <thead className="bg-zinc-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">{t("jobsPage.columns.name")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">{t("jobsPage.columns.status")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">{t("jobsPage.columns.type")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">{t("jobsPage.columns.target")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">{t("jobsPage.columns.progress")}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-zinc-400">{t("jobsPage.columns.created")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-700">
                  {jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-zinc-700/30 cursor-pointer" onClick={() => fetchJobDetail(job.id)}>
                      <td className="px-4 py-3 text-white font-medium break-words max-w-[360px]">{job.name}</td>
                      <td className="px-4 py-3"><StatusBadge status={jobState(job.summary)} t={t} /></td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-300">{job.commandType}</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {job.targetType === "all" ? t("jobsPage.create.targetAll") : (job.targetName && job.targetName !== "—" ? job.targetName : job.targetType)}
                      </td>
                      <td className="px-4 py-3"><SummaryBar summary={job.summary} /></td>
                      <td className="px-4 py-3 text-zinc-400 text-sm">{formatDateTime(job.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Paging */}
            <div className="flex items-center justify-between mt-3 text-sm text-zinc-400">
              <span>{t("jobsPage.paging.range", { from: offset + 1, to: offset + jobs.length, total })}</span>
              <div className="flex gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="rounded bg-zinc-800 px-3 py-1 disabled:opacity-40 hover:bg-zinc-700">{t("jobsPage.paging.previous")}</button>
                <button disabled={offset + jobs.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="rounded bg-zinc-800 px-3 py-1 disabled:opacity-40 hover:bg-zinc-700">{t("jobsPage.paging.next")}</button>
              </div>
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <CreateJobDialog
          initialNode={initialNode}
          onClose={() => { setShowCreate(false); setInitialNode(undefined); }}
          onCreated={fetchJobs}
        />
      )}

      {selectedJob && (
        <JobDetailPanel job={selectedJob} nodeNames={nodeNames} onClose={() => setSelectedJob(null)} onRetry={retryInstance} />
      )}
    </StandardPage>
  );
}
