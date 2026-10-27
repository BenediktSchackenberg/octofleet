"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";

/** Removal fields of GET /api/v1/nodes/{id} (#160). */
export interface NodeRemovalInfo {
  removalState?: "uninstall_pending" | "uninstall_running" | "uninstall_failed" | "uninstalled" | null;
  removalError?: string | null;
  removalRequestedAt?: string | null;
  removalRequestedBy?: string | null;
  removalDeleteAfter?: boolean;
  uninstalledAt?: string | null;
  canDelete?: boolean;
  forceDeleteAfter?: string | null;
}

interface Props {
  nodeId: string;
  hostname: string;
  removal: NodeRemovalInfo;
  onChanged: () => void;
}

/** Typing the hostname confirms a destructive action. */
function HostnameConfirm({ hostname, value, onChange }: { hostname: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <Label htmlFor="confirm-hostname">{t("nodes.removal.confirmHostname", { hostname })}</Label>
      <Input id="confirm-hostname" value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} placeholder={hostname} />
    </div>
  );
}

/** "Remove node…" button and dialog: uninstall the agent, optionally delete the node afterwards. */
export function RemoveNodeButton({ nodeId, hostname, onChanged }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiClient.request(`/nodes/${nodeId}/uninstall`, {
        method: "POST",
        body: JSON.stringify({ deleteAfterUninstall: deleteAfter }),
        headers: { "Content-Type": "application/json" },
      });
      setOpen(false);
      setConfirm("");
      if (!res.ok) {
        // apiClient shows the error; the node may have changed meanwhile (e.g. another
        // admin's request), so show its current state instead of the old one.
        onChanged();
        return;
      }
      if (deleteAfter) {
        // The node page goes away with the node; the list shows the progress.
        toast.success(t("nodes.removal.requested", { hostname }));
        router.push("/nodes");
      } else {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const option = (value: boolean, title: string, text: string) => (
    <label className={`flex gap-3 rounded-md border p-3 cursor-pointer ${deleteAfter === value ? "border-red-500 bg-red-500/5" : "border-border"}`}>
      <input type="radio" name="removal-mode" className="mt-1" checked={deleteAfter === value} onChange={() => setDeleteAfter(value)} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </label>
  );

  return (
    <>
      <Button variant="outline" className="bg-red-500/10 border-red-500 text-red-500 hover:bg-red-500/20" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4 mr-1" /> {t("nodes.removal.button")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirm(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("nodes.removal.title", { hostname })}</DialogTitle>
            <DialogDescription>{t("nodes.removal.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {option(false, t("nodes.removal.uninstallOnly"), t("nodes.removal.uninstallOnlyText"))}
            {option(true, t("nodes.removal.uninstallAndDelete"), t("nodes.removal.uninstallAndDeleteText"))}
            <p className="text-xs text-muted-foreground">{t("nodes.removal.offlineHint")}</p>
            <HostnameConfirm hostname={hostname} value={confirm} onChange={setConfirm} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={busy || confirm !== hostname} onClick={submit}>
              {deleteAfter ? t("nodes.removal.uninstallAndDelete") : t("nodes.removal.uninstallOnly")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Status of a removal on the node page, with cancel and delete actions. */
export function NodeRemovalBanner({ nodeId, hostname, removal, onChanged }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const state = removal.removalState;

  // While the removal is under way, follow it: refresh the page when the state changes
  // and leave it once the background task deleted the node.
  const inProgress = state === "uninstall_pending" || state === "uninstall_running"
    || (state === "uninstalled" && !!removal.removalDeleteAfter);
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(async () => {
      const res = await apiClient.richGet<NodeRemovalInfo>(`/nodes/${nodeId}`, { showErrorToast: false });
      if (res.status === 404) {
        clearInterval(timer);
        toast.success(t("nodes.removal.removed", { hostname }));
        router.push("/nodes");
      } else if (res.ok && res.data?.removalState !== state) {
        clearInterval(timer);
        onChanged();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [inProgress, state, nodeId, hostname, onChanged, router, t]);

  if (!state) return null;

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "-");
  const forceAllowed = !!removal.forceDeleteAfter && new Date(removal.forceDeleteAfter) <= new Date();
  const canDeleteNow = removal.canDelete || forceAllowed;

  const cancel = async () => {
    setBusy(true);
    try {
      await apiClient.request(`/nodes/${nodeId}/uninstall`, { method: "DELETE" });
      // Reload on success and on errors (apiClient shows them): a rejected request
      // usually means the state changed, e.g. the agent already picked up the job.
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const deleteNode = async () => {
    setBusy(true);
    try {
      const res = await apiClient.request(`/nodes/${nodeId}${removal.canDelete ? "" : "?force=true"}`, { method: "DELETE" });
      setDeleteOpen(false);
      if (!res.ok) {
        // apiClient shows the error. The node is not in the state this banner shows
        // (e.g. the agent was reinstalled and reactivated it): reload it.
        onChanged();
        return;
      }
      toast.success(t("nodes.removal.removed", { hostname }));
      router.push("/nodes");
    } finally {
      setBusy(false);
    }
  };

  const message =
    state === "uninstalled"
      ? t("nodes.removal.stateUninstalled", { time: fmt(removal.uninstalledAt) })
      : state === "uninstall_failed"
        ? t("nodes.removal.stateFailed")
        : state === "uninstall_running"
          ? t(removal.removalDeleteAfter ? "nodes.removal.stateRunningDelete" : "nodes.removal.stateRunning")
          : t(removal.removalDeleteAfter ? "nodes.removal.statePendingDelete" : "nodes.removal.statePending", {
            time: fmt(removal.removalRequestedAt),
            user: removal.removalRequestedBy || "-",
          });

  return (
    <div className={`mb-6 rounded-md border p-4 flex flex-wrap items-start justify-between gap-3 ${state === "uninstalled" ? "border-zinc-500 bg-zinc-500/10" : "border-amber-500 bg-amber-500/10"}`}>
      <div className="flex gap-3 min-w-0">
        <AlertTriangle className={`h-5 w-5 mt-0.5 shrink-0 ${state === "uninstalled" ? "text-zinc-400" : "text-amber-500"}`} />
        <div className="space-y-1 min-w-0">
          <p className="font-medium">{message}</p>
          {state === "uninstall_failed" && removal.removalError && (
            <p className="text-sm text-muted-foreground">{t("nodes.removal.reason", { reason: removal.removalError })}</p>
          )}
          {state !== "uninstalled" && removal.forceDeleteAfter && (
            <p className="text-sm text-muted-foreground">
              {forceAllowed ? t("nodes.removal.forceAllowed") : t("nodes.removal.forceFrom", { time: fmt(removal.forceDeleteAfter) })}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(state === "uninstall_pending" || state === "uninstall_failed") && (
          <Button variant="outline" disabled={busy} onClick={cancel}>{t("nodes.removal.cancelRequest")}</Button>
        )}
        {canDeleteNow && (
          <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={busy} onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> {removal.canDelete ? t("nodes.removal.deleteNode") : t("nodes.removal.deleteAnyway")}
          </Button>
        )}
      </div>
      <Dialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setConfirm(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("nodes.removal.deleteTitle", { hostname })}</DialogTitle>
            <DialogDescription>
              {removal.canDelete ? t("nodes.removal.deleteText") : t("nodes.removal.deleteAnywayText")}
            </DialogDescription>
          </DialogHeader>
          <HostnameConfirm hostname={hostname} value={confirm} onChange={setConfirm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t("common.cancel")}</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={busy || confirm !== hostname} onClick={deleteNode}>
              {t("nodes.removal.deleteNode")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Removal badge for the node list, with "Cancel" while the request is open. */
export function NodeRemovalStatus({ nodeId, state, onChanged }: { nodeId: string; state?: NodeRemovalInfo["removalState"]; onChanged: () => void }) {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!state) return null;

  const cancel = async (e: MouseEvent) => {
    e.stopPropagation(); // the grid card itself opens the node
    setBusy(true);
    try {
      await apiClient.request(`/nodes/${nodeId}/uninstall`, { method: "DELETE" });
      onChanged(); // also after an error (apiClient shows it): the list shows the current state
    } finally {
      setBusy(false);
    }
  };

  const style =
    state === "uninstalled" ? "bg-zinc-500/20 text-zinc-300" : state === "uninstall_failed" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400";
  const label =
    state === "uninstalled" ? "nodes.removal.badgeUninstalled" : state === "uninstall_failed" ? "nodes.removal.badgeFailed"
      : state === "uninstall_running" ? "nodes.removal.badgeRunning" : "nodes.removal.badgePending";

  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      <span className={`inline-block rounded px-2 py-0.5 text-xs ${style}`}>{t(label)}</span>
      {(state === "uninstall_pending" || state === "uninstall_failed") && hasPermission("nodes:delete") && (
        <button type="button" disabled={busy} onClick={cancel} className="text-xs text-zinc-400 underline hover:text-zinc-200 disabled:opacity-50">
          {t("nodes.removal.cancel")}
        </button>
      )}
    </span>
  );
}
