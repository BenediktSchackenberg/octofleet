"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TAG_COLORS, TagColorPicker } from "@/components/tag-color-picker";

interface ManagedTag {
  id: string; name: string; color: string | null;
  device_count: number; dynamic_groups: number; jobs: number;
}

const JSON_BODY = (body: unknown) => ({ body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, showErrorToast: false });

/** Tags you can manage: rename, colour, delete - each with where it is used. A tag is a label you set on
 *  nodes; a group is a set of nodes you deploy to (static, or by a rule that may test tags). */
export function TagsManager({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const g = (key: string, params?: Record<string, string | number>) => t(`groupsPage.tagsManager.${key}`, params);
  const [tags, setTags] = useState<ManagedTag[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", color: null as string | null });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await apiClient.get<{ tags: ManagedTag[] }>("/tags", { showErrorToast: false });
    setTags(res?.tags ?? []);
  };
  useEffect(() => { load(); }, []);

  const done = async () => { setEditing(null); setCreating(false); setError(null); await load(); onChanged?.(); };

  async function save(tag: ManagedTag | null) {
    setBusy(true); setError(null);
    const res = tag
      ? await apiClient.request(`/tags/${tag.id}`, { method: "PATCH", ...JSON_BODY({ name: draft.name, color: draft.color }) })
      : await apiClient.request("/tags", { method: "POST", ...JSON_BODY({ name: draft.name.trim(), color: draft.color }) });
    setBusy(false);
    if (!res.ok) { setError(res.status === 409 ? g("exists") : res.error); return; }
    await done();
  }

  async function remove(tag: ManagedTag) {
    const usage = g("usage", { nodes: tag.device_count, groups: tag.dynamic_groups, jobs: tag.jobs });
    if (!confirm(tag.device_count || tag.dynamic_groups ? g("confirmDeleteUsed", { name: tag.name, usage }) : g("confirmDelete", { name: tag.name }))) return;
    setBusy(true);
    const res = await apiClient.request(`/tags/${tag.id}`, { method: "DELETE", showErrorToast: false });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await done();
  }

  const editRow = (tag: ManagedTag | null) => (
    <TableRow key={tag?.id ?? "new"} className="hover:bg-transparent">
      <TableCell colSpan={4}>
        <span className="flex flex-wrap items-center gap-3">
          <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={100}
            aria-label={g("name")} placeholder={g("name")} onKeyDown={(e) => { if (e.key === "Enter" && draft.name.trim()) save(tag); }}
            className="h-8 w-56 rounded-md border bg-background px-2 text-sm" />
          <TagColorPicker value={draft.color} onChange={(c) => setDraft({ ...draft, color: c })} />
          {tag && tag.dynamic_groups > 0 && <span className="text-xs text-muted-foreground">{g("renameFollows", { count: tag.dynamic_groups })}</span>}
        </span>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button size="sm" variant="ghost" disabled={busy || !draft.name.trim()} onClick={() => save(tag)} aria-label={g("save")}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setCreating(false); setError(null); }} aria-label={t("common.cancel")}>
          <X aria-hidden="true" />
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{g("hint")}</p>
        <Button size="sm" variant="outline" disabled={creating}
          onClick={() => { setCreating(true); setEditing(null); setDraft({ name: "", color: TAG_COLORS[0] }); }}>
          <Plus aria-hidden="true" />{g("new")}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {tags === null ? (
        <p className="text-sm text-muted-foreground animate-pulse">{t("common.loading")}</p>
      ) : tags.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground">{g("none")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{g("name")}</TableHead>
              <TableHead className="text-right">{g("nodes")}</TableHead>
              <TableHead className="text-right">{g("dynamicGroups")}</TableHead>
              <TableHead className="text-right">{g("jobs")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {creating && editRow(null)}
            {tags.map((tag) => editing === tag.id ? editRow(tag) : (
              <TableRow key={tag.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: tag.color || "currentColor" }} aria-hidden="true" />
                    <TagIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />{tag.name}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {tag.device_count > 0
                    ? <Link href={`/nodes?tag=${encodeURIComponent(tag.name)}`} className="text-blue-400 hover:underline">{tag.device_count}</Link>
                    : <span className="text-muted-foreground">0</span>}
                </TableCell>
                <TableCell className={`text-right ${tag.dynamic_groups ? "" : "text-muted-foreground"}`}>{tag.dynamic_groups}</TableCell>
                <TableCell className={`text-right ${tag.jobs ? "" : "text-muted-foreground"}`}>{tag.jobs}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" aria-label={g("edit", { name: tag.name })}
                    onClick={() => { setEditing(tag.id); setCreating(false); setDraft({ name: tag.name, color: tag.color }); }}>
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-500" aria-label={g("delete", { name: tag.name })} disabled={busy}
                    onClick={() => remove(tag)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
