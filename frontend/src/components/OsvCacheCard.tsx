"use client";

import { useCallback, useEffect, useState } from "react";
import { Database } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CacheStatus {
  entries: number;
  without_finding: number;
  outdated: number;
  oldest: string | null;
  newest: string | null;
  size_bytes: number;
  max_age_days: number;
}

interface VerifyResult {
  checked: number;
  same: number;
  changed: number;
  failed: number;
  changed_ids: string[];
}

/**
 * The OSV advisory cache of the vulnerability scan: what it holds, and clear / verify / full scan.
 * Verifying downloads a sample of cached advisories again and corrects entries that differ.
 */
export function OsvCacheCard({ scanRunning, onFullScan }: { scanRunning: boolean; onFullScan: () => void }) {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const c = (key: string, params?: Record<string, string | number>) => t(`vulnerabilitiesPage.osvCache.${key}`, params);
  const canManage = hasPermission("settings:write");
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [busy, setBusy] = useState<"verify" | "clear" | null>(null);
  const [verified, setVerified] = useState<VerifyResult | null>(null);

  const load = useCallback(async () => {
    const result = await apiClient.request<CacheStatus>("/vulnerabilities/osv-cache", { showErrorToast: false });
    if (result.ok && result.data) setStatus(result.data);
  }, []);

  useEffect(() => { load(); }, [load, scanRunning]);

  async function verify() {
    setBusy("verify");
    try {
      const result = await apiClient.request<VerifyResult>("/vulnerabilities/osv-cache/verify?sample=50", { method: "POST", showErrorToast: false });
      if (result.ok && result.data) {
        setVerified(result.data);
        toast.success(c("verified", { checked: result.data.checked, changed: result.data.changed }));
      } else toast.error(result.error || c("error"));
      await load();
    } finally { setBusy(null); }
  }

  async function clear() {
    if (!window.confirm(c("confirmClear"))) return;
    setBusy("clear");
    try {
      const result = await apiClient.request<{ deleted: number }>("/vulnerabilities/osv-cache", { method: "DELETE", showErrorToast: false });
      if (result.ok && result.data) toast.success(c("cleared", { count: result.data.deleted }));
      else toast.error(result.error || c("error"));
      setVerified(null);
      await load();
    } finally { setBusy(null); }
  }

  return (
    <Card className="mt-6" data-testid="osv-cache">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> {c("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{c("description", { days: status?.max_age_days ?? 30 })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div><dt className="text-muted-foreground">{c("entries")}</dt><dd className="text-lg font-semibold">{status.entries}</dd></div>
            <div><dt className="text-muted-foreground">{c("outdated")}</dt><dd className="text-lg font-semibold">{status.outdated}</dd></div>
            <div><dt className="text-muted-foreground">{c("oldest")}</dt><dd>{formatDateTime(status.oldest)}</dd></div>
            <div><dt className="text-muted-foreground">{c("newest")}</dt><dd>{formatDateTime(status.newest)}</dd></div>
            <div><dt className="text-muted-foreground">{c("size")}</dt><dd>{(status.size_bytes / 1024 / 1024).toFixed(1)} MB</dd></div>
          </dl>
        )}
        {verified && (
          <p className="text-sm" data-testid="osv-cache-verified">
            {c("verifyResult", { checked: verified.checked, same: verified.same, changed: verified.changed, failed: verified.failed })}
            {verified.changed_ids.length > 0 && <span className="text-muted-foreground"> ({verified.changed_ids.join(", ")})</span>}
          </p>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={verify} disabled={busy !== null || !status?.entries}>{c("verify")}</Button>
            <Button variant="outline" onClick={onFullScan} disabled={busy !== null || scanRunning}>{c("fullScan")}</Button>
            <Button variant="outline" onClick={clear} disabled={busy !== null || scanRunning || !status?.entries}>{c("clear")}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
