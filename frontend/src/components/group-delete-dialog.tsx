"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** One use of a group and what deleting the group does to it (GET /groups/{id}/usage) */
export interface GroupUse { kind: string; count: number; names: string[]; effect: string }

const KINDS = ["members", "subgroups", "linux_approvals", "linux_exclusions", "patch_rings", "onboarding", "maintenance_windows",
  "remediation_windows", "monitoring_assignments", "config_baselines", "software_baselines", "sql_server", "jobs", "deployments"];

/** Delete a group: an unused one after a plain confirmation; a used one lists every use and what the
 *  delete does to it (members removed, sub-groups to the top, rules and rings fail-safe, assignments
 *  deleted, ...) and is deleted with `confirm=true` only after "Delete and clean up". */
export function GroupDeleteDialog({ group, onClose, onDeleted }: {
  group: { id: string; name: string }; onClose: () => void; onDeleted: (message: string) => void;
}) {
  const { t } = useI18n();
  const d = (key: string, params?: Record<string, string | number>) => t(`groupDelete.${key}`, params);
  const [uses, setUses] = useState<GroupUse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiClient.get<{ uses: GroupUse[] }>(`/groups/${group.id}/usage`, { showErrorToast: false })
      .then((res) => { if (live) setUses(res?.uses ?? []); })
      .catch(() => { if (live) { setUses([]); setError(d("usageFailed")); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await apiClient.delete(`/groups/${group.id}${uses && uses.length > 0 ? "?confirm=true" : ""}`, { showErrorToast: false })
      .catch(() => null);
    setBusy(false);
    if (res) onDeleted(d("deleted", { name: group.name }));
    else setError(t("groupDetail.deleteFailed"));
  }

  const used = !!uses && uses.length > 0;
  const known = (uses ?? []).filter((u) => KINDS.includes(u.kind));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d("title", { name: group.name })}</DialogTitle>
          <DialogDescription>{uses === null ? d("checking") : used ? d("usedIntro") : d("unused")}</DialogDescription>
        </DialogHeader>
        {uses === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{d("checking")}</p>
        ) : used && (
          <ul aria-label={d("usesLabel")} className="max-h-80 space-y-2 overflow-auto text-sm">
            {known.map((u) => (
              <li key={u.kind}>
                <span className="font-medium">{d(`kind.${u.kind}`, { count: u.count })}</span>
                <span className="text-muted-foreground"> - {d(`effect.${u.kind}`)}</span>
                {u.names.length > 0 && (
                  <span className="block truncate text-xs text-muted-foreground" title={u.names.join(", ")}>
                    {u.names.join(", ")}{u.count > u.names.length ? ` ${d("more", { count: u.count - u.names.length })}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {used && (
          <p className="flex items-start gap-2 text-sm text-amber-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{d("cannotUndo")}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="destructive" onClick={remove} disabled={busy || uses === null}>
            {busy ? t("groupDetail.deleting") : used ? d("deleteAndCleanUp") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
