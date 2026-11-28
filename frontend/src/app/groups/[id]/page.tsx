"use client";
import { apiClient } from "@/lib/api-client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { AddDevicesDialog } from "@/components/add-devices-dialog";
import { GroupFormDialog, passGroupNotice, takeGroupNotice } from "@/components/group-form-dialog";
import type { GroupRule } from "@/components/group-rule-builder";
import { ChevronRight, FolderPlus, FolderTree, RefreshCw, Sparkles } from "lucide-react";
import { getAuthHeader } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { useRecentlyOpened } from "@/hooks/useRecentlyOpened";
import { useI18n } from "@/lib/i18n-context";

interface GroupMember {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string | null;
  last_seen: string;
  is_online: boolean;
  assigned_at: string;
  assigned_by: string;
}

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_dynamic: boolean;
  dynamic_rule: Record<string, unknown> | null;
  color: string | null;
  icon: string | null;
  created_at: string;
  updated_at: string;
  members: GroupMember[];
  /** ancestors, top-level first (breadcrumb) */
  parents?: Array<{ id: string; name: string }>;
  /** direct sub-groups */
  children?: Array<{ id: string; name: string; is_dynamic: boolean; color: string | null; member_count: number }>;
}



function getHeaders(): Record<string, string> {
  return { ...getAuthHeader(), "Content-Type": "application/json" };
}

export default function GroupDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  // "Recently opened" and the breadcrumb show the group's name instead of its id
  const { nameRecent } = useRecentlyOpened();
  useEffect(() => {
    if (group?.name) nameRecent(`/groups/${String(params.id)}`, group.name);
  }, [group?.name, params.id, nameRecent]);
  const [loading, setLoading] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [creatingChild, setCreatingChild] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchGroup();
    setNotice(takeGroupNotice());
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchGroup() {
    try {
      const data = await apiClient.get<GroupDetail>(`/groups/${groupId}`, { showErrorToast: false });
      if (!data) {
        router.push("/groups");
        return;
      }
      setGroup(data);
    } catch (e) {
      console.error("Failed to fetch group:", e);
      router.push("/groups");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      const res = await apiClient.delete(`/groups/${groupId}`, { showErrorToast: false });
      if (res) {
        router.push("/groups");
      } else {
        alert(t("groupDetail.deleteFailed"));
      }
    } catch (e) {
      console.error("Failed to delete group:", e);
      alert(t("groupDetail.deleteFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      const res = await apiClient.delete(`/groups/${groupId}/members/${encodeURIComponent(memberId)}`, { showErrorToast: false });
      if (res) {
        await fetchGroup();
      }
    } catch (e) {
      console.error("Failed to remove member:", e);
    }
  }

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      const data = await apiClient.post<{ added: number; removed: number }>(`/groups/${groupId}/evaluate`, {}, { showErrorToast: false });
      if (data) {
        await fetchGroup();
        alert(t("groupDetail.evaluated", { added: data.added, removed: data.removed }));
      } else {
        alert(t("groupDetail.evaluateFailed"));
      }
    } catch (e) {
      console.error("Failed to evaluate group:", e);
      alert(t("groupDetail.evaluateFailed"));
    } finally {
      setEvaluating(false);
    }
  }

  function getStatusBadge(lastSeen: string) {
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeenDate.getTime()) / 1000 / 60;

    if (diffMinutes < 5) {
      return <Badge className="bg-green-600">{t("common.online")}</Badge>;
    } else if (diffMinutes < 60) {
      return <Badge className="bg-yellow-600">{t("groupDetail.away")}</Badge>;
    } else {
      return <Badge variant="secondary">{t("common.offline")}</Badge>;
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return formatDateTime(date, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </div>
      </main>
    );
  }

  if (!group) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb: the parent groups */}
        <nav aria-label={t("groupDetail.parents")} className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href="/groups" className="hover:underline">{t("groupsPage.title")}</Link>
          {(group.parents ?? []).map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1">
              <ChevronRight className="size-3.5" aria-hidden="true" />
              <Link href={`/groups/${p.id}`} className="hover:underline">{p.name}</Link>
            </span>
          ))}
          <ChevronRight className="size-3.5" aria-hidden="true" /><span className="text-foreground">{group.name}</span>
        </nav>
{/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mt-2">
              {group.color && (
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <h1 className="text-4xl font-bold">{group.name}</h1>
              {group.is_dynamic && (
                <Badge variant="secondary">{t("groupDetail.dynamicGroup")}</Badge>
              )}
            </div>
            {group.description && (
              <p className="text-muted-foreground mt-2">{group.description}</p>
            )}
            {notice && <p role="status" className="mt-2 text-sm text-green-500">{notice}</p>}
          </div>
          <div className="flex gap-2">
            {group.is_dynamic && (
              <Button 
                variant="outline" 
                onClick={handleEvaluate}
                disabled={evaluating}
                className="gap-1"
              >
                <RefreshCw className={`h-4 w-4 ${evaluating ? 'animate-spin' : ''}`} />
                {evaluating ? t("groupDetail.evaluating") : t("groupDetail.evaluate")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowEditDialog(true)}>
              {t("common.edit")}
            </Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              {t("common.delete")}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("groupDetail.members")}</CardDescription>
              <CardTitle className="text-4xl">{group.members.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("groupDetail.createdAt")}</CardDescription>
              <CardTitle className="text-lg">{formatDate(group.created_at)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("groupDetail.type")}</CardDescription>
              <CardTitle className="text-lg">
                {group.is_dynamic ? t("groupDetail.typeDynamic") : t("groupDetail.typeStatic")}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Dynamic Rule (if applicable) */}
        {group.is_dynamic && group.dynamic_rule && (
          <Card className="mb-8 border-purple-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                {t("groupDetail.ruleTitle")}
              </CardTitle>
              <CardDescription>
                {t("groupDetail.ruleDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RuleDisplay rule={group.dynamic_rule} />
            </CardContent>
          </Card>
        )}

        {/* Sub-groups: each opens its own page; members are each group's own (not inherited) */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><FolderTree className="h-5 w-5" aria-hidden="true" />{t("groupDetail.subgroups", { count: group.children?.length ?? 0 })}</CardTitle>
                <CardDescription>{t("groupDetail.subgroupsHint")}</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setCreatingChild(true)}>
                <FolderPlus className="h-4 w-4 mr-1" aria-hidden="true" />{t("groupDetail.addSubgroup")}
              </Button>
            </div>
          </CardHeader>
          {(group.children?.length ?? 0) > 0 && (
            <CardContent>
              <Table>
                <TableBody>
                  {group.children!.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/groups/${c.id}`)}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color || "#3b82f6" }} aria-hidden="true" />
                          <Link href={`/groups/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{c.name}</Link>
                          {c.is_dynamic && <span className="inline-flex items-center gap-1 text-xs text-purple-400"><Sparkles className="size-3" aria-hidden="true" />{t("groupsPage.dynamic")}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{t(c.member_count === 1 ? "groupsPage.membersOne" : "groupsPage.members", { count: c.member_count })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>

        {/* Members Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("groupDetail.members")}</CardTitle>
                <CardDescription>
                  {group.is_dynamic
                    ? t("groupDetail.membersDynamic")
                    : t("groupDetail.membersStatic")}
                </CardDescription>
              </div>
              {!group.is_dynamic && (
                <AddDevicesDialog
                  groupId={group.id}
                  existingMemberIds={group.members.map((m) => m.id)}
                  onMembersAdded={fetchGroup}
                />
              )}
            </div>
          </CardHeader>
          <CardContent>
            {group.members.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("groupDetail.columns.hostname")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("groupDetail.columns.os")}</TableHead>
                    <TableHead>{t("groupDetail.columns.lastSeen")}</TableHead>
                    <TableHead>{t("groupDetail.columns.addedAt")}</TableHead>
                    {!group.is_dynamic && <TableHead></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/nodes/${member.node_id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {member.hostname}
                        </Link>
                      </TableCell>
                      <TableCell>{getStatusBadge(member.last_seen)}</TableCell>
                      <TableCell>{member.os_name || "-"}</TableCell>
                      <TableCell>{formatDate(member.last_seen)}</TableCell>
                      <TableCell>{formatDate(member.assigned_at)}</TableCell>
                      {!group.is_dynamic && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            {t("groupDetail.remove")}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t("groupDetail.noMembers")}</p>
                {!group.is_dynamic && (
                  <p className="text-sm mt-2">
                    {t("groupDetail.noMembersHint")}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      {showEditDialog && (
        <GroupFormDialog
          group={{ id: group.id, name: group.name, description: group.description, color: group.color, parent_id: group.parent_id,
                   is_dynamic: group.is_dynamic, dynamic_rule: (group.dynamic_rule as unknown as GroupRule) ?? null }}
          onClose={() => setShowEditDialog(false)}
          onSaved={async (_id, text) => { setShowEditDialog(false); setNotice(text); await fetchGroup(); }} />
      )}
      {creatingChild && (
        <GroupFormDialog parentId={group.id} onClose={() => setCreatingChild(false)}
          onSaved={(id, text) => { setCreatingChild(false); passGroupNotice(text); router.push(`/groups/${id}`); }} />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("groupDetail.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("groupDetail.deleteText", { name: group.name })}
              {(group.children?.length ?? 0) > 0 && <> {t("groupDetail.deleteSubgroups", { count: group.children!.length })}</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? t("groupDetail.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

// Helper component to display dynamic rules in a human-readable format
function RuleDisplay({ rule }: { rule: Record<string, unknown> }) {
  const { t } = useI18n();
  const FIELD_LABELS: Record<string, string> = {
    os_name: t("groupDetail.rule.fields.os_name"),
    os_version: t("groupDetail.rule.fields.os_version"),
    os_build: t("groupDetail.rule.fields.os_build"),
    hostname: t("groupDetail.rule.fields.hostname"),
    agent_version: t("groupDetail.rule.fields.agent_version"),
    domain: t("groupDetail.rule.fields.domain"),
    is_domain_joined: t("groupDetail.rule.fields.is_domain_joined"),
    tags: `🏷️ ${t("groupDetail.rule.fields.tags")}`,
  };

  const OP_LABELS: Record<string, string> = {
    equals: t("groupDetail.rule.ops.equals"),
    not_equals: t("groupDetail.rule.ops.not_equals"),
    contains: t("groupDetail.rule.ops.contains"),
    not_contains: t("groupDetail.rule.ops.not_contains"),
    startswith: t("groupDetail.rule.ops.startswith"),
    endswith: t("groupDetail.rule.ops.endswith"),
    gte: "≥",
    lte: "≤",
    gt: ">",
    lt: "<",
    regex: t("groupDetail.rule.ops.regex"),
    has_tag: t("groupDetail.rule.ops.has_tag"),
  };

  const operator = (rule.operator as string) || "AND";
  const conditions = (rule.conditions as Array<{ field: string; op: string; value: string }>) || [];

  if (conditions.length === 0) {
    return <p className="text-muted-foreground">{t("groupDetail.rule.none")}</p>;
  }

  return (
    <div className="space-y-2">
      {conditions.map((cond, idx) => (
        <div key={idx} className="flex items-center gap-2 flex-wrap">
          {idx > 0 && (
            <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/30">
              {operator}
            </Badge>
          )}
          <Badge variant="secondary">{FIELD_LABELS[cond.field] || cond.field}</Badge>
          <span className="text-muted-foreground">{OP_LABELS[cond.op] || cond.op}</span>
          <code className="px-2 py-1 bg-muted rounded text-sm font-mono">
            {String(cond.value)}
          </code>
        </div>
      ))}
    </div>
  );
}
