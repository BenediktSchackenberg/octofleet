"use client";
import { apiClient } from "@/lib/api-client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui-components";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, FolderPlus, FolderTree, Plus, Sparkles, Tag } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { TagsManager } from "@/components/tags-manager";
import { GroupFormDialog, passGroupNotice } from "@/components/group-form-dialog";

interface Group {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_dynamic: boolean;
  color: string | null;
  member_count: number;
}

interface TagInfo { id: string }

/** The groups as a tree: top-level groups first, each followed by its sub-groups (any depth), by name */
function treeRows(groups: Group[], collapsed: Set<string>): Array<{ group: Group; depth: number; children: number }> {
  const byParent = new Map<string | null, Group[]>();
  const ids = new Set(groups.map((g) => g.id));
  for (const g of groups) {
    const parent = g.parent_id && ids.has(g.parent_id) ? g.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), g]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const rows: Array<{ group: Group; depth: number; children: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const g of byParent.get(parent) ?? []) {
      const children = (byParent.get(g.id) ?? []).length;
      rows.push({ group: g, depth, children });
      if (!collapsed.has(g.id) && depth < 20) walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

export default function GroupsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // the new-group dialog; parentId set when it was opened from a group's row (a sub-group)
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    try {
      const [groupsRes, tagsRes] = await Promise.all([
        apiClient.get<{ groups: Group[] }>(`/groups`, { showErrorToast: false }),
        apiClient.get<{ tags: TagInfo[] }>(`/tags`, { showErrorToast: false }),
      ]);
      if (groupsRes) setGroups(groupsRes.groups || []);
      if (tagsRes) setTags(tagsRes.tags || []);
    } catch (e) {
      console.error("Failed to fetch groups:", e);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => treeRows(groups, collapsed), [groups, collapsed]);
  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (loading) {
    return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><FolderTree className="h-6 w-6" aria-hidden="true" />{t("groupsPage.title")}</h1>
          <p className="text-muted-foreground">{t("groupsPage.summary", { groups: groups.length, tags: tags.length })}</p>
        </div>
        <Button onClick={() => setCreating({ parentId: null })}>
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" /> {t("groupsPage.create")}
        </Button>
      </div>

      {/* Groups as a tree: sub-groups under their parent; a row opens the group */}
      <Card>
        <CardContent className="pt-6">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("groupsPage.none")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("groupsPage.type")}</TableHead>
                  <TableHead className="text-right">{t("groupsPage.membersColumn")}</TableHead>
                  <TableHead>{t("common.description")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ group, depth, children }) => {
                  const open = !collapsed.has(group.id);
                  const Chevron = open ? ChevronDown : ChevronRight;
                  return (
                    <TableRow key={group.id} className="cursor-pointer" onClick={() => router.push(`/groups/${group.id}`)}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                          {children > 0 ? (
                            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(group.id); }}
                              aria-expanded={open} aria-label={t(open ? "groupsPage.collapse" : "groupsPage.expand", { name: group.name })}
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                              <Chevron className="size-4" aria-hidden="true" />
                            </button>
                          ) : <span className="inline-block w-5" />}
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: group.color || "#3b82f6" }} aria-hidden="true" />
                          <Link href={`/groups/${group.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{group.name}</Link>
                          {children > 0 && <span className="text-xs text-muted-foreground">{t("groupsPage.subgroups", { count: children })}</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {group.is_dynamic
                          ? <span className="inline-flex items-center gap-1 text-purple-400"><Sparkles className="size-3.5" aria-hidden="true" />{t("groupsPage.dynamic")}</span>
                          : <span className="text-muted-foreground">{t("groupsPage.static")}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{group.member_count}</TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground" title={group.description ?? undefined}>{group.description || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCreating({ parentId: group.id }); }}
                          aria-label={t("groupsPage.addSubgroup", { name: group.name })} title={t("groupsPage.addSubgroup", { name: group.name })}>
                          <FolderPlus aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{t("groupsPage.treeHint")}</p>
        </CardContent>
      </Card>

      {/* Tags: rename, colour, delete - with where each is used */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" aria-hidden="true" /> {t("groupsPage.tags")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TagsManager onChanged={fetchData} />
        </CardContent>
      </Card>

      {creating && (
        <GroupFormDialog parentId={creating.parentId} onClose={() => setCreating(null)}
          onSaved={(id, text) => { setCreating(null); passGroupNotice(text); router.push(`/groups/${id}`); }} />
      )}
    </div>
  );
}
