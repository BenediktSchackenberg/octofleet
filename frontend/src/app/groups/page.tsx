"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { getAuthHeader } from "@/lib/auth-context";
import { Plus, FolderTree, Tag, Users } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

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
        fetch(`${API_URL}/api/v1/groups`, { headers: getAuthHeader() }),
        fetch(`${API_URL}/api/v1/tags`, { headers: getAuthHeader() }),
      ]);
      
      if (groupsRes.ok) {
        const data = await groupsRes.json();
        setGroups(data.groups || []);
      }
      if (tagsRes.ok) {
        const data = await tagsRes.json();
        setTags(data.tags || []);
      }
    } catch (e) {
      console.error("Failed to fetch groups:", e);
    } finally {
      setLoading(false);
    }
  }

  async function createGroup() {
    try {
      const res = await fetch(`${API_URL}/api/v1/groups`, {
        method: "POST",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(newGroup),
      });
      if (res.ok) {
        setShowCreateGroup(false);
        setNewGroup({ name: "", description: "", color: "#3b82f6" });
        fetchData();
      }
    } catch (e) {
      console.error("Failed to create group:", e);
    }
  }

  async function deleteGroup(groupId: string) {
    if (!confirm("Delete this group?")) return;
    try {
      await fetch(`${API_URL}/api/v1/groups/${groupId}`, {
        method: "DELETE",
        headers: getAuthHeader(),
      });
      fetchData();
    } catch (e) {
      console.error("Failed to delete group:", e);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Breadcrumb items={[{ label: "Groups" }]} />
        <h1 className="text-2xl font-bold mb-6">📁 Groups</h1>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <Breadcrumb items={[{ label: "Groups" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">📁 Groups</h1>
          <p className="text-muted-foreground">{groups.length} groups, {tags.length} tags</p>
        </div>
        <Button onClick={() => setShowCreateGroup(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create Group
        </Button>
      </div>

      {/* Create Group Form */}
      {showCreateGroup && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New Group</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <input
                  type="text"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="Production Servers"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input
                  type="text"
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="All production servers"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Color</label>
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
                Create Group
              </Button>
              <Button variant="outline" onClick={() => setShowCreateGroup(false)}>
                Cancel
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
                    <Badge variant="secondary">Dynamic</Badge>
                  )}
                </div>
                <CardDescription>{group.description || "No description"}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span>{group.member_count} members</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Tags Section */}
      {tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" /> Tags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="text-sm py-1 px-3"
                  style={{ borderColor: tag.color || undefined }}
                >
                  {tag.name} ({tag.device_count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
