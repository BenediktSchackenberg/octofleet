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

// How long the page waits for the agent: a package list refresh takes seconds to minutes, an
// upgrade can take much longer. timeoutSeconds is the agent's limit, sent as the payload's timeout.
const SCAN = { timeoutSeconds: 900, waitMs: 10 * 60_000 };
const INSTALL = { timeoutSeconds: 3600, waitMs: 65 * 60_000 };

/** The last lines of a job's output, for a toast */
function tail(text?: string, lines = 4): string | undefined {
  return text?.trim().split("\n").slice(-lines).join("\n") || undefined;
}

/**
 * "Search for updates" (patch_scan: the agent refreshes the package lists and reports the updates)
 * and "Install updates" (patch_install, after a confirmation) for a Linux node: the packages in
 * `selected`, or all available updates when nothing is selected. `onChanged` reloads the node's data
 * once the agent has answered.
 */
export function LinuxUpdateActions({ nodeUuid, updateCount, packageManager, selected, onChanged }: {
  nodeUuid: string | undefined;
  updateCount: number;
  packageManager?: string;
  selected: string[];
  onChanged: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [running, setRunning] = useState<"scan" | "install" | null>(null);
  // The packages to install, fixed when the confirmation opens; [] = all updates
  const [confirming, setConfirming] = useState<string[] | null>(null);

  async function run(kind: "scan" | "install", packages: string[] = []) {
    if (!nodeUuid) return;
    setRunning(kind);
    const limits = kind === "scan" ? SCAN : INSTALL;
    let result: NodeJobResult;
    try {
      result = await runNodeJob(nodeUuid, {
        name: kind === "scan" ? "Search for updates"
          : packages.length ? `Install updates: ${packages.join(", ")}`.slice(0, 200) : "Install updates",
        commandType: kind === "scan" ? "patch_scan" : "patch_install",
        // The time limit goes into the payload: the agent reads it there first (POST /jobs keeps the
        // default timeout of the job, 300 s - too short for an upgrade)
        commandData: kind === "scan" ? { timeout: limits.timeoutSeconds }
          : packages.length ? { packages, timeout: limits.timeoutSeconds } : { all: true, timeout: limits.timeoutSeconds },
      }, limits.waitMs);
    } finally {
      setRunning(null);
    }
    if (result.status === "success") {
      toast.success(t(kind === "scan" ? "nodes.updates.searchDone" : "nodes.updates.installDone"),
        { description: kind === "install" ? tail(result.output, 1) : undefined });
    } else if (result.status === "failed") {
      toast.error(t(kind === "scan" ? "nodes.updates.searchFailed" : "nodes.updates.installFailed"),
        { description: tail(result.detail) });
    } else if (result.status === "timeout") {
      toast.warning(t("nodes.updates.timeout"));
    } else {
      toast.info(t("nodes.updates.notCreated"));
    }
    if (result.status !== "notCreated") await onChanged();
  }

  const manager = packageManager ?? "";
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={!nodeUuid || running !== null}
        title={t("nodes.updates.searchHint")} onClick={() => run("scan")}>
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
              {confirming?.length
                ? t("nodes.updates.installSelectedConfirmText", { manager, packages: confirming.join(", ") })
                : t("nodes.updates.installConfirmText", { count: updateCount, manager })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => { const packages = confirming ?? []; setConfirming(null); run("install", packages); }}>
              {confirming?.length ? t("nodes.updates.installSelected", { count: confirming.length }) : t("nodes.updates.install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
