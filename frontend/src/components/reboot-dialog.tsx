"use client";

import Link from "next/link";
import { Cog, LoaderCircle, RotateCcw, User, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REBOOT_TIMES, rebootDate } from "@/components/reboot-choice";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";

/** A console reboot until the node has reported after it (GET /nodes/{id}/reboot, fleet `reboot_job`) */
export interface RebootJobState {
  state: "scheduled" | "restarting" | "failed";
  job_id: string;
  restart_at?: string | null;
  error?: string | null;
}

/** GET /nodes/{id}/reboot: the console reboot, and when the node last reported its updates and booted */
export interface NodeRebootStatus {
  reboot: RebootJobState | null;
  reported_at?: string | null;
  last_boot_time?: string | null;
}

const REBOOT_POLL_MS = 30_000;
type RebootPoll = { subscribers: Set<(status: NodeRebootStatus) => void>; timer?: ReturnType<typeof setInterval>; last?: NodeRebootStatus };
const rebootPolls = new Map<string, RebootPoll>();

async function loadRebootStatus(nodeId: string): Promise<void> {
  const res = await apiClient.get<NodeRebootStatus>(`/nodes/${nodeId}/reboot`, { showErrorToast: false });
  const poll = rebootPolls.get(nodeId);
  if (!res || !poll) return;
  poll.last = res;
  poll.subscribers.forEach((notify) => notify(res));
}

/**
 * The node's reboot state (GET /nodes/{id}/reboot), every 30 s while the page is visible: one
 * request per node for all its Reboot buttons and the node page, which reloads its update data
 * when the node reported again. `reload` asks at once (after a reboot or cancel).
 */
export function useNodeRebootStatus(nodeId: string | undefined, enabled = true) {
  const [status, setStatus] = useState<NodeRebootStatus | null>(null);
  useEffect(() => {
    if (!nodeId || !enabled) return;
    let poll = rebootPolls.get(nodeId);
    if (!poll) {
      poll = { subscribers: new Set() };
      rebootPolls.set(nodeId, poll);
    }
    const current = poll;
    current.subscribers.add(setStatus);
    if (current.last) setStatus(current.last);
    if (!current.timer) {
      loadRebootStatus(nodeId);
      current.timer = setInterval(() => { if (document.visibilityState === "visible") loadRebootStatus(nodeId); }, REBOOT_POLL_MS);
    }
    return () => {
      current.subscribers.delete(setStatus);
      if (current.subscribers.size === 0) {
        clearInterval(current.timer);
        rebootPolls.delete(nodeId);
      }
    };
  }, [nodeId, enabled]);
  const reload = useCallback(() => (nodeId ? loadRebootStatus(nodeId) : Promise.resolve()), [nodeId]);
  return { status, reload };
}

interface PreviewNode {
  id: string;
  found: boolean;
  hostname?: string;
  os_family?: "windows" | "linux" | null;
  online?: boolean;
  logged_on_users?: { user: string; session: string | null }[] | null;
  running_jobs?: { id: string; name: string; type: string; status: string }[];
  running_job_count?: number;
  sessions?: { terminal: number; screen: number; shell: number };
  reboot?: RebootJobState | null;
  blocker?: string | null;
}

interface RebootResult {
  jobs: { node: string; hostname: string; job_id: string }[];
  skipped: { node: string; reason: string }[];
}

type When = "now" | "in" | "at";
const MINUTES = [5, 15, 30, 60, 120];
// The server takes reboots up to 7 days ahead
const DAYS = 7;

function defaultAt(): { day: number; minute: number } {
  const d = new Date();
  d.setHours(22, 0, 0, 0);
  return { day: d.getTime() < Date.now() + 5 * 60_000 ? 1 : 0, minute: 22 * 60 };
}

/** What a reboot interrupts on one node (from the preview) */
function warnings(n: PreviewNode): string[] {
  const out: string[] = [];
  if (n.logged_on_users?.length) out.push("users");
  if (n.running_job_count) out.push("jobs");
  if (n.sessions && n.sessions.terminal + n.sessions.screen + n.sessions.shell > 0) out.push("sessions");
  if (n.reboot && n.reboot.state !== "failed") out.push("scheduled");
  return out;
}

/**
 * Reboot one or more nodes (Windows and Linux): names the nodes, warns about logged-on users,
 * unfinished jobs and open terminal/screen/shell sessions, and offers now / in N minutes / at a
 * time with an optional message for the users. Several nodes, or any warning, must be confirmed
 * explicitly. The server creates one `reboot` job per node and audits it.
 */
export function RebootDialog({ nodes, open, onOpenChange, onDone }: {
  nodes: { id: string; hostname: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<PreviewNode[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [when, setWhen] = useState<When>("now");
  const [minutes, setMinutes] = useState(15);
  const [day, setDay] = useState(() => defaultAt().day);
  const [minute, setMinute] = useState(() => defaultAt().minute);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [typedCount, setTypedCount] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = nodes.map((n) => n.id).join(",");

  useEffect(() => {
    if (!open) return;
    setPreview(null); setLoadError(null); setConfirmed(false); setTypedCount(""); setWhen("now"); setMessage("");
    let cancelled = false;
    apiClient.request<{ nodes: PreviewNode[] }>("/nodes/reboot/preview", {
      method: "POST", body: JSON.stringify({ node_ids: ids.split(",") }),
      headers: { "Content-Type": "application/json" }, showErrorToast: false,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) setPreview(res.data.nodes);
      else setLoadError(res.error ?? t("reboot.previewFailed"));
    });
    return () => { cancelled = true; };
  }, [open, ids, t]);

  const at = rebootDate(day, minute);
  const atInvalid = when === "at" && (at.getTime() < Date.now() + 60_000 || at.getTime() > Date.now() + DAYS * 86_400_000);
  const rebootable = (preview ?? []).filter((n) => n.found && !n.blocker);
  const anyWarning = rebootable.some((n) => warnings(n).length > 0);
  const many = nodes.length > 1;
  const confirmOk = (!anyWarning || confirmed) && (!many || typedCount.trim() === String(rebootable.length));
  const canSubmit = !!preview && rebootable.length > 0 && confirmOk && !atInvalid && !busy && message.length <= 200;

  async function submit() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { node_ids: rebootable.map((n) => n.id), when, message: message.trim() || null };
      if (when === "in") body.minutes = minutes;
      if (when === "at") body.at = at.toISOString();
      const res = await apiClient.request<RebootResult>("/nodes/reboot", {
        method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, showErrorToast: false,
      });
      if (!res.ok || !res.data) {
        toast.error(t("reboot.failed"), { description: res.error ?? undefined });
        return;
      }
      const skipped = res.data.skipped.length;
      (res.data.jobs.length ? toast.success : toast.warning)(t("reboot.started", { count: res.data.jobs.length }),
        { description: skipped ? t("reboot.skipped", { count: skipped }) : undefined });
      onOpenChange(false);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  const title = many ? t("reboot.titleMany", { count: nodes.length }) : t("reboot.titleOne", { name: nodes[0]?.hostname ?? "" });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" aria-hidden="true" />{title}</DialogTitle>
          <DialogDescription>{t("reboot.description")}</DialogDescription>
        </DialogHeader>

        {loadError && <p className="text-sm text-red-500">{loadError}</p>}
        {!preview && !loadError && <p className="text-sm text-muted-foreground flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{t("reboot.checking")}</p>}
        {preview && (
          <ul className="space-y-2 text-sm" data-testid="reboot-nodes">
            {preview.map((n) => {
              const name = n.hostname ?? nodes.find((x) => x.id === n.id)?.hostname ?? n.id;
              const sessions = n.sessions ? n.sessions.terminal + n.sessions.screen + n.sessions.shell : 0;
              return (
                <li key={n.id} className="rounded border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{name}</span>
                    {n.os_family && <Badge variant="outline">{n.os_family === "windows" ? "Windows" : "Linux"}{/* i18n-ignore */}</Badge>}
                    {n.found && !n.online && <Badge variant="outline" className="text-muted-foreground">{t("reboot.offline")}</Badge>}
                    {n.blocker && <Badge variant="destructive">{t(`reboot.blocker.${n.blocker}`)}</Badge>}
                    {!n.found && <Badge variant="destructive">{t("reboot.notFound")}</Badge>}
                  </div>
                  {n.found && !n.blocker && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      <li className={n.logged_on_users?.length ? "text-amber-500" : "text-muted-foreground"}>
                        <User className="inline h-3 w-3 mr-1 align-[-1px]" aria-hidden="true" />{n.logged_on_users == null ? t("reboot.usersUnknown")
                          : n.logged_on_users.length === 0 ? t("reboot.usersNone")
                          : t("reboot.users", { users: n.logged_on_users.map((u) => u.session ? `${u.user} (${u.session})` : u.user).join(", ") })}
                      </li>
                      <li className={n.running_job_count ? "text-amber-500" : "text-muted-foreground"}>
                        <Cog className="inline h-3 w-3 mr-1 align-[-1px]" aria-hidden="true" />{n.running_job_count ? (
                          <>
                            {t("reboot.jobs", { count: n.running_job_count })}{" "}
                            {(n.running_jobs ?? []).slice(0, 3).map((j, i) => (
                              <span key={j.id}>{i > 0 && ", "}<Link className="underline" href={`/jobs/${j.id}`}>{j.name}</Link></span>
                            ))}
                          </>
                        ) : t("reboot.jobsNone")}
                      </li>
                      <li className={sessions ? "text-amber-500" : "text-muted-foreground"}>
                        &gt;_ {sessions ? t("reboot.sessions", { terminal: n.sessions!.terminal, screen: n.sessions!.screen, shell: n.sessions!.shell })
                          : t("reboot.sessionsNone")}
                      </li>
                      {n.reboot && n.reboot.state !== "failed" && (
                        <li className="text-amber-500"><RotateCcw className="inline h-3 w-3 mr-1 align-[-1px]" aria-hidden="true" />{t("reboot.alreadyScheduled", { time: n.reboot.restart_at ? formatDateTime(n.reboot.restart_at) : "?" })}</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium">{t("reboot.when")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="reboot-when" checked={when === "now"} onChange={() => setWhen("now")} />
            {t("reboot.now")}
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="reboot-when" checked={when === "in"} onChange={() => setWhen("in")} />
            {t("reboot.inMinutesLabel")}
            <select value={minutes} onChange={(e) => { setMinutes(Number(e.target.value)); setWhen("in"); }}
              aria-label={t("reboot.inMinutesLabel")} className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-white">
              {MINUTES.map((m) => <option key={m} value={m}>{t("reboot.minutes", { count: m })}</option>)}
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="reboot-when" checked={when === "at"} onChange={() => setWhen("at")} />
            {t("reboot.atLabel")}
            <select value={day} onChange={(e) => { setDay(Number(e.target.value)); setWhen("at"); }} aria-label={t("nodes.updates.rebootDay")}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-white">
              {Array.from({ length: DAYS }, (_, d) => (
                <option key={d} value={d}>
                  {d === 0 ? t("nodes.updates.today") : d === 1 ? t("nodes.updates.tomorrow")
                    : formatDate(rebootDate(d, 0), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                </option>
              ))}
            </select>
            <select value={minute} onChange={(e) => { setMinute(Number(e.target.value)); setWhen("at"); }} aria-label={t("nodes.updates.rebootAt")}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-white">
              {REBOOT_TIMES.map((m) => <option key={m} value={m}>{formatTime(rebootDate(0, m), { hour: "2-digit", minute: "2-digit" })}</option>)}
            </select>
          </label>
          {atInvalid && <p className="text-xs text-red-400">{t("reboot.atInvalid")}</p>}
        </fieldset>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">{t("reboot.message")}</span>
          <input type="text" value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)}
            placeholder={t("reboot.messagePlaceholder")}
            className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-white" />
          <span className="block text-xs text-muted-foreground">{t("reboot.messageHint")}</span>
        </label>

        {anyWarning && (
          <label className="flex items-start gap-2 text-sm text-amber-500">
            <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} aria-label={t("reboot.confirmWarnings")} />
            <span>{t("reboot.confirmWarnings")}</span>
          </label>
        )}
        {many && preview && (
          <label className="block space-y-1 text-sm">
            <span>{t("reboot.typeCount", { count: rebootable.length })}</span>
            <input type="text" inputMode="numeric" value={typedCount} onChange={(e) => setTypedCount(e.target.value)}
              aria-label={t("reboot.typeCount", { count: rebootable.length })}
              className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-white" />
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="destructive" onClick={submit} disabled={!canSubmit}>
            {busy ? <><LoaderCircle className="animate-spin" aria-hidden="true" />{t("reboot.submitting")}</> : many ? t("reboot.submitMany", { count: rebootable.length }) : t("reboot.submitOne")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Reboot button for one node (node header, Updates tab): opens the dialog; while a reboot is
 * scheduled it shows when, with Cancel reboot. Hidden without `nodes:reboot`.
 */
export function RebootButton({ nodeId, hostname, size = "default", label }: {
  nodeId: string;
  hostname: string;
  size?: "default" | "sm";
  label?: string;
}) {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const allowed = hasPermission("nodes:reboot");
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // while a reboot is pending, follow it until the node has reported after it (shared poll)
  const { status, reload: load } = useNodeRebootStatus(nodeId, allowed);
  const state = status?.reboot ?? null;

  if (!allowed) return null;

  async function cancel() {
    setCancelling(true);
    try {
      const res = await apiClient.request<RebootResult>("/nodes/reboot", {
        method: "POST", body: JSON.stringify({ node_ids: [nodeId], action: "cancel" }),
        headers: { "Content-Type": "application/json" }, showErrorToast: false,
      });
      if (res.ok && res.data?.jobs.length) toast.success(t("reboot.cancelSent", { name: hostname }));
      else toast.error(t("reboot.cancelFailed"), { description: res.error ?? res.data?.skipped[0]?.reason });
      await load();
    } finally {
      setCancelling(false);
    }
  }

  if (state && state.state !== "failed") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Link href={`/jobs/${state.job_id}`}>
          <Badge variant="outline" className="border-amber-500/50 text-amber-500">
            <RotateCcw className="h-3 w-3" aria-hidden="true" />{state.restart_at ? t(`reboot.state.${state.state}`, { time: formatDateTime(state.restart_at) }) : t("reboot.state.pending")}
          </Badge>
        </Link>
        <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling}>
          {cancelling ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}{t("reboot.cancel")}
        </Button>
      </span>
    );
  }
  return (
    <>
      {state?.state === "failed" && (
        <Link href={`/jobs/${state.job_id}`} title={state.error ?? undefined}>
          <Badge variant="destructive">{t("reboot.state.failed")}</Badge>
        </Link>
      )}
      <Button size={size} variant="outline" onClick={() => setOpen(true)}
        className="border-red-500/60 text-red-500 hover:bg-red-500/10">
        <RotateCcw aria-hidden="true" />{label ?? t("reboot.button")}
      </Button>
      <RebootDialog nodes={[{ id: nodeId, hostname }]} open={open} onOpenChange={setOpen} onDone={load} />
    </>
  );
}
