"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TAG_COLORS, TagColorPicker } from "@/components/tag-color-picker";
import { EMPTY_RULE, GroupRuleBuilder, ruleComplete, type GroupRule } from "@/components/group-rule-builder";
import { SearchSelect, groupOptions } from "@/components/search-select";

interface GroupOption { id: string; name: string; parent_id: string | null; color?: string | null }
export interface GroupFormValue {
  id?: string; name: string; description: string | null; color: string | null; parent_id: string | null;
  is_dynamic: boolean; dynamic_rule: GroupRule | null;
}

/** A message for the page shown next (a new group opens its own page) - read once by takeGroupNotice */
export function passGroupNotice(text: string | null) {
  try { if (text) sessionStorage.setItem("octofleet-group-notice", text); } catch { /* storage unavailable: no message */ }
}
export function takeGroupNotice(): string | null {
  try {
    const text = sessionStorage.getItem("octofleet-group-notice");
    sessionStorage.removeItem("octofleet-group-notice");
    return text;
  } catch { return null; }
}

/** Ids of a group and all its sub-groups - none of them can become its parent (that would make a loop) */
function selfAndBelow(groups: GroupOption[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) { out.add(g.id); grew = true; }
  }
  return out;
}

/** Create or edit a group: name, description, colour, the parent group (sub-groups), and static or
 *  dynamic - a dynamic group takes its members from a rule, previewed while it is written. */
export function GroupFormDialog({ group, parentId, onClose, onSaved }: {
  group?: GroupFormValue; parentId?: string | null; onClose: () => void; onSaved: (id: string, message: string | null) => void;
}) {
  const { t } = useI18n();
  const g = (key: string, params?: Record<string, string | number>) => t(`groupForm.${key}`, params);
  const editing = !!group?.id;
  const [value, setValue] = useState<GroupFormValue>(group ?? {
    name: "", description: "", color: TAG_COLORS[0], parent_id: parentId ?? null, is_dynamic: false, dynamic_rule: null });
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ groups: GroupOption[] }>("/groups", { showErrorToast: false }).then((res) => setGroups(res?.groups ?? []));
  }, []);
  const blocked = group?.id ? selfAndBelow(groups, group.id) : new Set<string>();
  const rule = value.dynamic_rule ?? EMPTY_RULE;
  const valid = value.name.trim() !== "" && (!value.is_dynamic || ruleComplete(rule));

  async function save() {
    setBusy(true); setError(null);
    const body: Record<string, unknown> = {
      name: value.name.trim(), description: value.description || null, color: value.color, parentId: value.parent_id,
      ...(value.is_dynamic ? { dynamicRule: rule } : {}), ...(editing ? {} : { isDynamic: value.is_dynamic }),
    };
    const res = await apiClient.request<{ group: { id: string }; members?: number | { added: number; removed: number } | null }>(
      editing ? `/groups/${group!.id}` : "/groups",
      { method: editing ? "PUT" : "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, showErrorToast: false });
    setBusy(false);
    if (!res.ok || !res.data) { setError(res.status === 409 ? g("exists") : res.error); return; }
    const m = res.data.members;
    const message = typeof m === "number" ? (value.is_dynamic ? g("createdDynamic", { count: m }) : null)
      : m ? g("ruleApplied", { added: m.added, removed: m.removed }) : null;
    onSaved(res.data.group.id, message);
  }

  const input = "h-9 w-full rounded-md border bg-background px-3 text-sm";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? g("editTitle", { name: group!.name }) : g("newTitle")}</DialogTitle>
          <DialogDescription>{g("hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span>{g("name")}</span>
            <input autoFocus value={value.name} onChange={(e) => setValue({ ...value, name: e.target.value })} maxLength={100} className={input} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{g("description")}</span>
            <input value={value.description ?? ""} onChange={(e) => setValue({ ...value, description: e.target.value })} className={input} />
          </label>
          <div className="space-y-1 text-sm">
            <span>{g("color")}</span>
            <div><TagColorPicker value={value.color} onChange={(c) => setValue({ ...value, color: c })} /></div>
          </div>
          <div className="space-y-1 text-sm">
            <span>{g("parent")}</span>
            {/* searchable by path; empty = top level; the group itself and its sub-groups are not offered */}
            <SearchSelect options={groupOptions(groups).filter((o) => !blocked.has(o.id))} value={value.parent_id}
              onChange={(id) => setValue({ ...value, parent_id: id })} label={g("parent")} placeholder={g("topLevel")} />
          </div>
          {!editing && (
            <fieldset className="space-y-1 text-sm">
              <legend>{g("type")}</legend>
              <label className="mr-4 inline-flex items-center gap-2">
                <input type="radio" name="group-type" checked={!value.is_dynamic} onChange={() => setValue({ ...value, is_dynamic: false })} />{g("static")}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="group-type" checked={value.is_dynamic}
                  onChange={() => setValue({ ...value, is_dynamic: true, dynamic_rule: value.dynamic_rule ?? EMPTY_RULE })} />{g("dynamic")}
              </label>
              <p className="text-muted-foreground">{value.is_dynamic ? g("dynamicHint") : g("staticHint")}</p>
            </fieldset>
          )}
          {value.is_dynamic && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">{g("rule")}</div>
              <GroupRuleBuilder rule={rule} onChange={(r) => setValue({ ...value, dynamic_rule: r })} />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={!valid || busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}{editing ? g("save") : g("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
