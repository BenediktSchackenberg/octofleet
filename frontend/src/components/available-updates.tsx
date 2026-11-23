"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";
import { UPDATE_COLS, installedUpdateType } from "@/lib/update-tables";

/** An update's reboot marker, the same on Windows (reported by Windows Update) and Linux (estimated by
 *  the server from the package name): "Needs a reboot" / "May need a reboot", nothing otherwise */
export function UpdateRebootBadge({ behavior }: { behavior?: string | null }) {
  const { t } = useI18n();
  if (behavior === "always") return <Badge variant="destructive" className="shrink-0">{t("nodes.updates.rebootBadge.always")}</Badge>;
  if (behavior === "can") return <Badge variant="secondary" className="shrink-0">{t("nodes.updates.rebootBadge.can")}</Badge>;
  return null;
}

export interface AvailableUpdate {
  kb_id: string | null;
  title: string;
  severity: string;
  category: string;
  source: string | null;
  is_reboot_required: boolean;
  /** never / always / can (may request one), as Windows reports it; null from older agents */
  reboot_behavior?: string | null;
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
export function AvailableUpdates({ updates, selected, onSelectedChange, actions }: {
  updates: AvailableUpdate[] | undefined;
  /** KB IDs selected for "Install selected"; without onSelectedChange there are no checkboxes */
  selected?: string[];
  onSelectedChange?: (kbIds: string[]) => void;
  /** Buttons in the header (search, install) */
  actions?: React.ReactNode;
}) {
  const { t } = useI18n();
  if (updates === undefined) return null;
  const selectable = updates.map((u) => u.kb_id).filter((kb): kb is string => !!kb);
  const chosen = selected ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <CardTitle>{t("nodeDetail.availableUpdates", { count: updates.length })}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent>
        {updates.length === 0 ? (
          <p className="text-muted-foreground">{t("nodeDetail.availableUpdatesNone")}</p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className={UPDATE_COLS.select}>
                  {onSelectedChange && (
                    <Checkbox aria-label={t("nodes.updates.selectAll")}
                      checked={chosen.length > 0 && chosen.length === selectable.length}
                      onCheckedChange={(checked) => onSelectedChange(checked ? selectable : [])} />
                  )}
                </TableHead>
                <TableHead className={UPDATE_COLS.kb}>KB{/* i18n-ignore */}</TableHead>
                <TableHead>{t("nodeDetail.title")}</TableHead>
                <TableHead className={UPDATE_COLS.type}>{t("nodeDetail.type")}</TableHead>
                <TableHead className={UPDATE_COLS.date}>{t("nodeDetail.availableUpdateFound")}</TableHead>
                <TableHead className={UPDATE_COLS.status}>{t("nodeDetail.availableUpdateSeverity")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {updates.map((u, i) => (
                <TableRow key={`${u.kb_id ?? ""}-${i}`}>
                  {(
                    <TableCell>
                      {onSelectedChange && u.kb_id && (
                        <Checkbox aria-label={t("nodes.updates.selectPackage", { name: u.kb_id })}
                          checked={chosen.includes(u.kb_id)}
                          onCheckedChange={(checked) => onSelectedChange(checked
                            ? [...chosen.filter((kb) => kb !== u.kb_id), u.kb_id!] : chosen.filter((kb) => kb !== u.kb_id))} />
                      )}
                    </TableCell>
                  )}
                  <TableCell>{u.kb_id ? <Badge variant="outline">{u.kb_id}</Badge> : "-"}</TableCell>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate" title={u.title}>{u.title}</span>
                      {u.definition && <Badge variant="secondary" className="shrink-0">{t("nodeDetail.definitionUpdate")}</Badge>}
                      <UpdateRebootBadge behavior={u.is_reboot_required ? "always" : u.reboot_behavior} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`nodeDetail.installedUpdateType.${installedUpdateType(u.title)}`)}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(u.discovered_at)}</TableCell>
                  <TableCell>
                    <Badge variant={u.severity === "critical" || u.severity === "important" ? "destructive" : "secondary"}>{u.severity}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
