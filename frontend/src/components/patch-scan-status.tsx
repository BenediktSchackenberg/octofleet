"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";

export interface PatchScan {
  scanned_at: string;
  status: "succeeded" | "partial" | "failed";
  source?: string | null;
  server?: string | null;
  result_code?: number | null;
  error?: string | null;
  duration_seconds?: number | null;
  update_count?: number | null;
}

/**
 * The node's last update search (undefined while loading, null if there is none). A change of
 * `refreshKey` loads it again.
 */
export function usePatchScan(nodeId: string, refreshKey = 0): PatchScan | null | undefined {
  const [scan, setScan] = useState<PatchScan | null | undefined>(undefined);
  useEffect(() => {
    apiClient.get<{ data: PatchScan | null }>(`/patches/scan-status/${encodeURIComponent(nodeId)}`, { showErrorToast: false })
      .then((res) => setScan(res?.data ?? null))
      .catch(() => setScan(null));
  }, [nodeId, refreshKey]);
  return scan;
}

/**
 * The node's last update search, as the agent reported it: when, from where (WSUS or Windows Update;
 * on Linux the package manager, e.g. apt) and whether it worked. A failed search keeps the last update
 * list - this line says so.
 */
export function PatchScanStatus({ scan, pending, definitions = 0 }: {
  scan: PatchScan | null | undefined;
  /** The pending updates as the Updates tab counts them; the search's own count otherwise */
  pending?: number;
  /** Microsoft Defender signature updates, not counted in `pending` */
  definitions?: number;
}) {
  const { t } = useI18n();
  if (scan === undefined) return null;
  const source = scan?.source === "wsus"
    ? t("patchScan.sourceWsus", { server: scan.server ?? "?" })
    : !scan?.source || scan.source === "windows_update"
      ? t("patchScan.sourceWindowsUpdate")
      : t("patchScan.sourcePackageManager", { manager: scan.source });

  return (
    <Card>
      <CardContent className="pt-6 text-sm space-y-1">
        {!scan ? (
          <p className="text-muted-foreground">{t("patchScan.none")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{t("patchScan.last")}</span>
              <span>{formatDateTime(scan.scanned_at)}</span>
              <Badge variant={scan.status === "failed" ? "destructive" : scan.status === "partial" ? "secondary" : "default"}>
                {t(`patchScan.status.${scan.status}`)}
              </Badge>
              <span className="text-muted-foreground">{source}</span>
              {scan.status !== "failed" && <span>{t("patchScan.updates", { count: pending ?? scan.update_count ?? 0 })}</span>}
              {scan.status !== "failed" && definitions > 0 && (
                <span className="text-muted-foreground">{t("patchScan.definitions", { count: definitions })}</span>
              )}
            </div>
            {scan.status === "failed" && (
              <p className="text-destructive">
                {t("patchScan.failedKeep")} {scan.error && <span className="font-mono">{scan.error}</span>}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
