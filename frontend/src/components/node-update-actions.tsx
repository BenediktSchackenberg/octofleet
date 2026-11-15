"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n-context";
import { runNodeJob, type NodeJobResult } from "@/lib/node-jobs";
import { RebootChoice, useRebootChoice } from "@/components/reboot-choice";
import type { RebootBehavior } from "@/lib/update-tables";

// How long the page waits for the agent. timeoutSeconds is the agent's limit, sent as the payload's
// timeout (POST /jobs keeps the job's default of 300 s). Windows: the update search has its own
// 20-minute limit, an installation 30 minutes; then the agent searches again.
const LIMITS = {
  linux: { scan: { timeoutSeconds: 900, waitMs: 10 * 60_000 }, install: { timeoutSeconds: 3600, waitMs: 65 * 60_000 } },
  // Windows: after 30 minutes the job reports a still running installation (it is never stopped)
  windows: { scan: { timeoutSeconds: 1500, waitMs: 25 * 60_000 }, install: { timeoutSeconds: 1800, waitMs: 35 * 60_000 } },
};

type Os = "linux" | "windows";
/** The last lines of a job's output, for a toast */
function tail(text?: string, lines = 4): string | undefined {
  return text?.trim().split("\n").slice(-lines).join("\n") || undefined;
}

/**
 * "Search for updates" (patch_scan) and "Install updates" (patch_install, after a confirmation) for
 * a node, Linux or Windows.
 * - Linux: the packages in `selected`, or all available updates (`{"all": true}`).
 * - Windows: the KB IDs in `selected`, or all of `allIds`.
 * The confirmation asks what happens when an update needs a reboot (no reboot, at a set time, in one
 * minute) - on both systems.
 * `onChanged` reloads the node's data once the agent has answered.
 */
export function UpdateActions({ os, nodeUuid, updateCount, packageManager, selected, allIds = [], rebootBehavior = {},
  rebootPending = false, onChanged }: {
  os: Os;
  nodeUuid: string | undefined;
  updateCount: number;
  packageManager?: string;
  selected: string[];
  /** All available updates (KB IDs / package names): "Install updates" without a selection */
  allIds?: string[];
  /** Per update: whether installing it needs a reboot (Windows reports it; Linux: from the name) */
  rebootBehavior?: Record<string, RebootBehavior>;
  /** A reboot is already pending on the node */
  rebootPending?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [running, setRunning] = useState<"scan" | "install" | null>(null);
  // The packages / KB IDs to install, fixed when the confirmation opens; [] = all updates
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const reboot = useRebootChoice();

  /** What the dialog says about a reboot for these updates, and whether it offers the reboot choice */
  function rebootOutlook(items: string[]) {
    const ids = items.length ? items : allIds;
    const by = (b: RebootBehavior) => ids.filter((id) => (rebootBehavior[id] ?? "unknown") === b);
    const always = by("always"), can = by("can"), unknown = by("unknown");
    const kind = always.length ? "needed" : can.length ? "maybe" : unknown.length ? "unknown" : "none";
    const list = (kind === "needed" ? always : kind === "maybe" ? can : []).join(", ");
    return { kind, list, offer: rebootPending || kind !== "none" };
  }

  function installData(items: string[], timeout: number): Record<string, unknown> {
    // No reboot choice shown (no update needs one, none pending): never reboot
    const target = os === "linux" ? (items.length ? { packages: items } : { all: true }) : { kb_ids: items.length ? items : allIds };
    return { ...target, ...reboot.payload(rebootOutlook(items).offer), timeout };
  }

  /** The toast text of a finished Windows installation (the agent answers with JSON) */
  function windowsSummary(output?: string): string | undefined {
    try {
      const r = JSON.parse(output || "") as { installed?: string[]; failed?: string[]; reboot_required?: boolean; search_after?: string };
      return [
        t("nodes.updates.windowsResult", { installed: (r.installed ?? []).join(", ") || "-", failed: (r.failed ?? []).join(", ") || "-" }),
        r.reboot_required ? t(`nodes.updates.windowsReboot.${reboot.policy}`) : null,
      ].filter(Boolean).join(" · ");
    } catch {
      return tail(output, 1);
    }
  }

  async function run(kind: "scan" | "install", items: string[] = []) {
    if (!nodeUuid) return;
    setRunning(kind);
    const limits = LIMITS[os][kind];
    let result: NodeJobResult;
    try {
      result = await runNodeJob(nodeUuid, {
        name: kind === "scan" ? "Search for updates"
          : items.length ? `Install updates: ${items.join(", ")}`.slice(0, 200) : "Install updates",
        commandType: kind === "scan" ? "patch_scan" : "patch_install",
        commandData: kind === "scan" ? { timeout: limits.timeoutSeconds } : installData(items, limits.timeoutSeconds),
      }, limits.waitMs);
    } finally {
      setRunning(null);
    }
    if (result.status === "success") {
      toast.success(t(kind === "scan" ? "nodes.updates.searchDone" : "nodes.updates.installDone"),
        { description: kind === "install" ? (os === "windows" ? windowsSummary(result.output) : tail(result.output, 2)) : undefined });
    } else if (result.status === "failed") {
      toast.error(t(kind === "scan" ? "nodes.updates.searchFailed" : "nodes.updates.installFailed"),
        { description: os === "windows" && kind === "install" ? windowsSummary(result.detail) : tail(result.detail) });
    } else if (result.status === "timeout") {
      toast.warning(t("nodes.updates.timeout"));
    } else {
      toast.info(t("nodes.updates.notCreated"));
    }
    if (result.status !== "notCreated") await onChanged();
  }

  const manager = os === "windows" ? "Windows Update" : packageManager ?? "";
  const outlook = rebootOutlook(confirming ?? []);
  const scheduledInPast = reboot.inPast(outlook.offer);
  const count = confirming?.length || updateCount;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={!nodeUuid || running !== null}
        title={t(os === "windows" ? "nodes.updates.searchHintWindows" : "nodes.updates.searchHint")} onClick={() => run("scan")}>
        {running === "scan" ? `⏳ ${t("nodes.updates.searching")}` : `🔍 ${t("nodes.updates.search")}`}
      </Button>
      <Button variant="outline" size="sm" disabled={!nodeUuid || running !== null || updateCount === 0}
        onClick={() => setConfirming([...selected])}>
        {running === "install" ? `⏳ ${t("nodes.updates.installing")}`
          : selected.length ? `⬇️ ${t("nodes.updates.installSelected", { count: selected.length })}`
          : `⬇️ ${t("nodes.updates.install")}`}
      </Button>
      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming?.length ? t("nodes.updates.installSelectedConfirmTitle") : t("nodes.updates.installConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {os === "windows"
                ? t("nodes.updates.installConfirmTextWindows", { count, updates: (confirming?.length ? confirming : allIds).join(", ") })
                : confirming?.length
                  ? t("nodes.updates.installSelectedConfirmText", { manager, packages: confirming.join(", ") })
                  : t("nodes.updates.installConfirmText", { count: updateCount, manager })}
            </DialogDescription>
          </DialogHeader>
          {/* Whether a reboot is needed - stated in any case; the choice only when it can be */}
          <div className="space-y-1 text-sm">
            {rebootPending && <p className="text-amber-500">{t("nodes.updates.rebootOutlook.pending")}</p>}
            <p className={outlook.kind === "none" ? "text-muted-foreground" : "text-amber-500"}>
              {t(`nodes.updates.rebootOutlook.${outlook.kind}`, { items: outlook.list })}
              {os === "linux" && outlook.kind !== "unknown" && ` ${t("nodes.updates.rebootOutlook.estimated")}`}
            </p>
          </div>
          <RebootChoice choice={reboot} offer={outlook.offer} windows={os === "windows"} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>{t("common.cancel")}</Button>
            <Button disabled={scheduledInPast}
              onClick={() => { const items = confirming ?? []; setConfirming(null); run("install", items); }}>
              {confirming?.length ? t("nodes.updates.installSelected", { count: confirming.length }) : t("nodes.updates.install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
