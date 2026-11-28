"use client";
import { apiClient } from "@/lib/api-client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { LoadingSpinner } from "@/components/ui-components";
import { Plus, FolderTree, Tag, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { TagsManager } from "@/components/tags-manager";



interface Group {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_dynamic: boolean;
  color: string | null;
  icon: string | null;
  member_count: number;
  created_at: string;
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
  device_count: number;
}

export default function GroupsPage() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: "", description: "", color: "#3b82f6" });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [groupsRes, tagsRes] = await Promise.all([
        apiClient.get<{ groups: Group[] }>(`/groups`, { showErrorToast: false }),
        apiClient.get<{ tags: Tag[] }>(`/tags`, { showErrorToast: false }),
      ]);
      
      if (groupsRes) { setGroups(groupsRes.groups || []); }
      if (tagsRes) { setTags(tagsRes.tags || []); }
    } catch (e) {
      console.error("Failed to fetch groups:", e);
    } finally {
      setLoading(false);
    }
  }

  async function createGroup() {
    try {
      const res = await apiClient.post(`/groups`, newGroup, { showErrorToast: false });
      if (res) {
        setShowCreateGroup(false);
        setNewGroup({ name: "", description: "", color: "#3b82f6" });
        fetchData();
      }
    } catch (e) {
      console.error("Failed to create group:", e);
    }
  }

  async function deleteGroup(groupId: string) {
    if (!confirm(t("groupsPage.deleteConfirm"))) return;
    try {
      await apiClient.delete(`/groups/${groupId}`, { showErrorToast: false });
      fetchData();
    } catch (e) {
      console.error("Failed to delete group:", e);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
<h1 className="text-2xl font-bold mb-6">📁 {t("groupsPage.title")}</h1>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
<div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📁 {t("groupsPage.title")}</h1>
          <p className="text-muted-foreground">{t("groupsPage.summary", { groups: groups.length, tags: tags.length })}</p>
        </div>
        <Button onClick={() => setShowCreateGroup(true)}>
          <Plus className="h-4 w-4 mr-2" /> {t("groupsPage.create")}
        </Button>
      </div>

      {/* Create Group Form */}
      {showCreateGroup && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("groupsPage.createTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-sm font-medium">{t("common.name")} *</label>
                <input
                  type="text"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder={t("groupsPage.namePlaceholder")}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("common.description")}</label>
                <input
                  type="text"
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder={t("groupsPage.descriptionPlaceholder")}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("groupsPage.color")}</label>
                <input
                  type="color"
                  value={newGroup.color}
                  onChange={(e) => setNewGroup({ ...newGroup, color: e.target.value })}
                  className="w-full mt-1 h-10 bg-secondary border border-input rounded-md cursor-pointer"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={createGroup} disabled={!newGroup.name}>
                {t("groupsPage.create")}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateGroup(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Groups Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        {groups.map((group) => (
          <Link key={group.id} href={`/groups/${group.id}`}>
            <Card className="hover:border-primary transition-colors cursor-pointer h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: group.color || "#3b82f6" }}
                    />
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                  </div>
                  {group.is_dynamic && (
                    <Badge variant="secondary">{t("groupsPage.dynamic")}</Badge>
                  )}
                </div>
                <CardDescription>{group.description || t("groupsPage.noDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>{t(group.member_count === 1 ? "groupsPage.membersOne" : "groupsPage.members", { count: group.member_count })}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Tags: rename, colour, delete - with where each is used */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" /> {t("groupsPage.tags")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TagsManager onChanged={fetchData} />
        </CardContent>
      </Card>
    </div>
  );
}
