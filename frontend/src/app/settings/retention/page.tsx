"use client";
import { apiClient } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Database, Save, Lock } from "lucide-react";

interface RetentionJob {
  job_id: number;
  type: "retention" | "compression";
  last_run_status: string | null;
  last_successful_finish: string | null;
  next_start: string | null;
}

interface RetentionItem {
  category: string;
  table: string;
  keep_days: number;
  compress_after_days: number | null;
  legal_hold: boolean;
  management_enabled: boolean;
  default_keep_days: number;
  default_compress_after_days: number | null;
  applied: boolean;
  size_bytes: number | null;
  oldest: string | null;
  chunks?: number;
  compressed_chunks?: number;
  jobs: RetentionJob[];
}

interface Draft { keep: string; compress: string; compressOn: boolean; }

const CATEGORIES = ["security_events", "file_events", "performance_metrics", "hardware_changes"];

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"]; // i18n-ignore
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${formatNumber(value, { maximumFractionDigits: unit >= 3 ? 1 : 0 })} ${units[unit]}`;
}

function draftOf(item: RetentionItem): Draft {
  return {
    keep: String(item.keep_days),
    compress: String(item.compress_after_days ?? item.default_compress_after_days ?? 7),
    compressOn: item.compress_after_days !== null,
  };
}

export default function RetentionPage() {
  const { t } = useI18n();
  const { token } = useAuth();
  const [items, setItems] = useState<RetentionItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const data = await apiClient.get<{ retention: RetentionItem[] }>(`/retention`, { showErrorToast: false });
    const list = data?.retention || [];
    setItems(list);
    setDrafts(Object.fromEntries(list.map(i => [i.category, draftOf(i)])));
    setLoading(false);
  }
  useEffect(() => { if (token) load(); }, [token]);

  function setDraft(category: string, change: Partial<Draft>) {
    setDrafts(d => ({ ...d, [category]: { ...d[category], ...change } }));
  }

  async function save(item: RetentionItem, body: Record<string, unknown>) {
    setSaving(item.category);
    const result = await apiClient.put<RetentionItem>(`/retention/${item.category}`, body);
    if (result) toast.success(t("retentionPage.saved", { name: label(item.category) }));
    await load();
    setSaving(null);
  }

  function saveDraft(item: RetentionItem) {
    const draft = drafts[item.category];
    const keep = Number(draft.keep);
    if (!item.management_enabled
        && !window.confirm(t("retentionPage.activateConfirm", { name: label(item.category), days: keep }))) return;
    if (!item.legal_hold && keep < item.keep_days
        && !window.confirm(t("retentionPage.shortenConfirm", { name: label(item.category), days: keep }))) return;
    save(item, {
      keep_days: keep,
      management_enabled: true,
      compress_after_days: draft.compressOn ? Number(draft.compress) : null,
    });
  }

  function toggleHold(item: RetentionItem) {
    if (!item.legal_hold || window.confirm(t("retentionPage.releaseHoldConfirm", { name: label(item.category), days: item.keep_days }))) {
      save(item, { legal_hold: !item.legal_hold });
    }
  }

  function label(category: string) {
    return CATEGORIES.includes(category) ? t(`retentionPage.categories.${category}.title`) : category;
  }

  function jobLine(job: RetentionJob) {
    return t("retentionPage.jobLine", {
      type: t(`retentionPage.jobTypes.${job.type}`),
      id: job.job_id,
      next: formatDateTime(job.next_start),
      last: job.last_run_status ? t("retentionPage.lastRun", { status: job.last_run_status, time: formatDateTime(job.last_successful_finish) }) : t("retentionPage.notRunYet"),
    });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-[1920px] mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <Database className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold">{t("retentionPage.title")}</h1>
            <p className="text-zinc-400 text-sm">{t("retentionPage.subtitle")}</p>
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-blue-500/20 rounded-xl p-4 mb-6 text-sm text-blue-300 space-y-1">
          <div><strong>{t("retentionPage.keepDays")}</strong> = {t("retentionPage.keepHelp")}</div>
          <div><strong>{t("retentionPage.compressAfter")}</strong> = {t("retentionPage.compressHelp")}</div>
          <div><strong>{t("retentionPage.legalHold")}</strong> = {t("retentionPage.legalHoldHelp")}</div>
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div> :
        <div className="space-y-4">
          {items.map(item => {
            const draft = drafts[item.category] || draftOf(item);
            const dirty = draft.keep !== String(item.keep_days)
              || draft.compressOn !== (item.compress_after_days !== null)
              || (draft.compressOn && draft.compress !== String(item.compress_after_days));
            return (
              <div key={item.category} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-semibold">{label(item.category)}</h3>
                    {CATEGORIES.includes(item.category) && <p className="text-xs text-zinc-400 mt-1">{t(`retentionPage.categories.${item.category}.description`)}</p>}
                  </div>
                  <button onClick={() => toggleHold(item)} disabled={!item.management_enabled || saving === item.category}
                    className={`flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${item.legal_hold ? "bg-red-500/20 text-red-300 border border-red-500/30" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}>
                    <Lock className="h-3 w-3" /> {item.legal_hold ? t("retentionPage.legalHoldOn") : t("retentionPage.legalHoldOff")}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="text-xs text-green-400">{t("retentionPage.keepDays")}</label>
                    <input type="number" min={1} max={3650} value={draft.keep} disabled={item.legal_hold}
                      onChange={e => setDraft(item.category, { keep: e.target.value })}
                      className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm disabled:opacity-50" />
                  </div>
                  <div>
                    <label className="text-xs text-yellow-400 flex items-center gap-2">
                      <input type="checkbox" checked={draft.compressOn}
                        onChange={e => setDraft(item.category, { compressOn: e.target.checked })} />
                      {t("retentionPage.compressAfter")}
                    </label>
                    <input type="number" min={1} value={draft.compress} disabled={!draft.compressOn}
                      onChange={e => setDraft(item.category, { compress: e.target.value })}
                      className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm disabled:opacity-50" />
                  </div>
                  <button onClick={() => saveDraft(item)} disabled={(item.management_enabled && !dirty) || saving === item.category}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600">
                    <Save className="h-4 w-4" /> {saving === item.category ? t("retentionPage.saving") : item.management_enabled ? t("common.save") : t("retentionPage.activate")}
                  </button>
                </div>
                <div className="mt-4 text-xs text-zinc-400 space-y-1">
                  {!item.management_enabled ? (
                    <div className="text-amber-400">{t("retentionPage.activationRequired")}</div>
                  ) : !item.applied ? (
                    <div className="text-amber-400">{t("retentionPage.notApplied", { table: item.table })}</div>
                  ) : (
                    <>
                      <div>{t("retentionPage.stored", {
                        size: formatSize(item.size_bytes),
                        oldest: formatDateTime(item.oldest),
                        compressed: item.compressed_chunks ?? 0,
                        chunks: item.chunks ?? 0,
                      })}</div>
                      {item.legal_hold && <div className="text-red-300">{t("retentionPage.holdActive")}</div>}
                      {item.jobs.map(job => <div key={job.job_id}>{jobLine(job)}</div>)}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>}
      </div>
    </div>
  );
}
