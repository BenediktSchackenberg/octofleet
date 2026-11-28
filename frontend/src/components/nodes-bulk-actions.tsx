"use client";
import { useEffect, useState } from "react";
import { FolderMinus, FolderPlus, Loader2, Tag as TagIcon, Tags, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TAG_COLORS, TagColorPicker } from "@/components/tag-color-picker";

export interface TagInfo { id: string; name: string; color: string | null }

/** A node's tags as small chips: a coloured dot and the name */
export function TagChips({ tags, className = "" }: { tags?: TagInfo[] | null; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {tags.map((tag) => (
        <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color || "currentColor" }} aria-hidden="true" />
          {tag.name}
        </span>
      ))}
    </span>
  );
}

type Action = "addGroup" | "removeGroup" | "addTag" | "removeTag";
interface GroupInfo { id: string; name: string; is_dynamic: boolean }
interface Result {
  added?: number; removed?: number; alreadyMembers?: number; alreadyTagged?: number; notFound?: string[];
  dynamicGroups?: { added: number; removed: number };
}

const JSON_BODY = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, showErrorToast: false });

/** One bulk action for the selected nodes: pick the group or tag, see how many nodes it reaches, confirm.
 *  Static groups only - a dynamic group's members follow its rule. A tag can be created here. */
function BulkDialog({ action, nodeIds, onClose, onDone }: {
  action: Action; nodeIds: string[]; onClose: () => void; onDone: (message: string) => void;
}) {
  const { t } = useI18n();
  const b = (key: string, params?: Record<string, string | number>) => t(`nodes.bulk.${key}`, params);
  const isTag = action === "addTag" || action === "removeTag";
  const [items, setItems] = useState<Array<{ id: string; name: string; color?: string | null }> | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [newTag, setNewTag] = useState("");
  const [newColor, setNewColor] = useState<string>(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isTag) {
      apiClient.get<{ tags: TagInfo[] }>("/tags", { showErrorToast: false }).then((r) => setItems(r?.tags ?? []));
    } else {
      apiClient.get<{ groups: GroupInfo[] }>("/groups", { showErrorToast: false })
        .then((r) => setItems((r?.groups ?? []).filter((g) => !g.is_dynamic)));
    }
  }, [isTag]);

  const name = items?.find((i) => i.id === chosen)?.name ?? newTag.trim();
  const canRun = !busy && (!!chosen || (action === "addTag" && !!newTag.trim()));

  async function run() {
    setBusy(true);
    setError(null);
    let id = chosen;
    if (!id && action === "addTag") {
      const created = await apiClient.request<{ tag: TagInfo }>("/tags", {
        method: "POST", ...JSON_BODY({ name: newTag.trim(), color: newColor }) });
      if (!created.ok || !created.data) { setBusy(false); setError(created.status === 409 ? b("tagExists") : created.error); return; }
      id = created.data.tag.id;
    }
    const path = isTag ? `/tags/${id}/nodes` : `/groups/${id}/members`;
    const method = action === "addGroup" || action === "addTag" ? "POST" : "DELETE";
    const res = await apiClient.request<Result>(path, { method, ...JSON_BODY({ nodeIds }) });
    setBusy(false);
    if (!res.ok || !res.data) { setError(res.error); return; }
    const r = res.data;
    const parts = [
      r.added !== undefined ? b("resultAdded", { count: r.added }) : null,
      r.removed !== undefined ? b("resultRemoved", { count: r.removed }) : null,
      (r.alreadyMembers ?? r.alreadyTagged) ? b("resultAlready", { count: (r.alreadyMembers ?? r.alreadyTagged) as number }) : null,
      r.notFound?.length ? b("resultNotFound", { count: r.notFound.length }) : null,
      r.dynamicGroups && (r.dynamicGroups.added || r.dynamicGroups.removed)
        ? b("resultDynamic", { added: r.dynamicGroups.added, removed: r.dynamicGroups.removed }) : null,
    ].filter(Boolean);
    onDone(`${name}: ${parts.join(", ")}`);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{b(`${action}Title`)}</DialogTitle>
          <DialogDescription>{b(`${action}Hint`, { count: nodeIds.length })}</DialogDescription>
        </DialogHeader>
        {items === null ? (
          <p className="text-sm text-muted-foreground animate-pulse">{t("common.loading")}</p>
        ) : (
          <div className="space-y-3">
            {items.length === 0 && action !== "addTag" ? (
              <p className="text-sm text-muted-foreground">{b(isTag ? "noTags" : "noGroups")}</p>
            ) : (
              <select value={chosen} onChange={(e) => { setChosen(e.target.value); setNewTag(""); }}
                aria-label={b(isTag ? "tag" : "group")} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">{b(isTag ? "chooseTag" : "chooseGroup")}</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            )}
            {action === "addTag" && (
              <input value={newTag} onChange={(e) => { setNewTag(e.target.value); setChosen(""); }} maxLength={100}
                placeholder={b("newTag")} aria-label={b("newTag")}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            )}
            {action === "addTag" && newTag.trim() && <TagColorPicker value={newColor} onChange={setNewColor} />}
            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={run} disabled={!canRun}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {/* says how many nodes it reaches - the confirmation for many */}
            {b(`${action}Run`, { count: nodeIds.length, name: name || "…" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The bar above the Nodes list while nodes are selected: how many, the bulk actions, clear */
export function BulkActionsBar({ nodeIds, allMatching, onDone, onClear }: {
  nodeIds: string[]; allMatching: boolean; onDone: () => void; onClear: () => void;
}) {
  const { t } = useI18n();
  const b = (key: string, params?: Record<string, string | number>) => t(`nodes.bulk.${key}`, params);
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (nodeIds.length === 0 && !message) return null;
  const buttons: Array<[Action, typeof TagIcon]> = [["addGroup", FolderPlus], ["removeGroup", FolderMinus], ["addTag", TagIcon], ["removeTag", Tags]];
  return (
    <div role="region" aria-label={b("bar")} className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
      {nodeIds.length > 0 && (
        <>
          <span className="font-medium">{allMatching ? b("selectedAll", { count: nodeIds.length }) : b("selected", { count: nodeIds.length })}</span>
          {buttons.map(([key, Icon]) => (
            <Button key={key} size="sm" variant="outline" onClick={() => { setMessage(null); setAction(key); }}>
              <Icon aria-hidden="true" />{b(key)}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onClear}><X aria-hidden="true" />{b("clear")}</Button>
        </>
      )}
      {message && <span role="status" className="text-green-500">{message}</span>}
      {action && (
        <BulkDialog action={action} nodeIds={nodeIds} onClose={() => setAction(null)}
          onDone={(text) => { setAction(null); setMessage(text); onDone(); }} />
      )}
    </div>
  );
}
