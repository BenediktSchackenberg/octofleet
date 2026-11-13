"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";

export interface AvailableUpdate {
  kb_id: string | null;
  title: string;
  severity: string;
  category: string;
  source: string | null;
  is_reboot_required: boolean;
  discovered_at: string | null;
  /** A Microsoft Defender signature update: offered several times a day, installed by Defender itself */
  definition: boolean;
}

/** The updates the node's last successful update search found (Windows), reloaded on `refreshKey` */
export function useAvailableUpdates(nodeId: string, refreshKey = 0): AvailableUpdate[] | undefined {
  const [updates, setUpdates] = useState<AvailableUpdate[] | undefined>(undefined);
  useEffect(() => {
    apiClient.get<{ updates?: AvailableUpdate[] }>(`/patches/available/${encodeURIComponent(nodeId)}`, { showErrorToast: false })
      .then((res) => setUpdates(res?.updates ?? []))
      .catch(() => setUpdates([]));
  }, [nodeId, refreshKey]);
  return updates;
}

/** Pending updates that need attention: without Defender signature updates */
export function relevantUpdateCount(updates: AvailableUpdate[] | undefined): number {
  return (updates ?? []).filter((u) => !u.definition).length;
}

/** The Windows node's available (pending) updates from its last update search */
export function AvailableUpdates({ updates }: { updates: AvailableUpdate[] | undefined }) {
  const { t } = useI18n();
  if (updates === undefined) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("nodeDetail.availableUpdates", { count: updates.length })}</CardTitle>
      </CardHeader>
      <CardContent>
        {updates.length === 0 ? (
          <p className="text-muted-foreground">{t("nodeDetail.availableUpdatesNone")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>KB{/* i18n-ignore */}</TableHead>
                <TableHead>{t("nodeDetail.title")}</TableHead>
                <TableHead>{t("nodeDetail.availableUpdateSeverity")}</TableHead>
                <TableHead>{t("nodeDetail.availableUpdateFound")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {updates.map((u, i) => (
                <TableRow key={`${u.kb_id ?? ""}-${i}`}>
                  <TableCell>{u.kb_id ? <Badge variant="outline">{u.kb_id}</Badge> : "-"}</TableCell>
                  <TableCell>
                    <div className="flex max-w-[560px] items-center gap-2">
                      <span className="truncate" title={u.title}>{u.title}</span>
                      {u.definition && <Badge variant="secondary" className="shrink-0">{t("nodeDetail.definitionUpdate")}</Badge>}
                      {u.is_reboot_required && <Badge variant="destructive" className="shrink-0">{t("nodes.updates.rebootRequired")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.severity === "critical" || u.severity === "important" ? "destructive" : "secondary"}>{u.severity}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(u.discovered_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
