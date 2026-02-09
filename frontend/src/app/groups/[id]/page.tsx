"use client";

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
import { Breadcrumb } from "@/components/ui-components";

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
}

const API_BASE = "http://192.168.0.5:8080/api/v1";
const headers = { "X-API-Key": "openclaw-inventory-dev-key", "Content-Type": "application/json" };

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editColor, setEditColor] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchGroup();
  }, [groupId]);

  async function fetchGroup() {
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}`, { headers });
      if (!res.ok) {
        router.push("/groups");
        return;
      }
      const data = await res.json();
      setGroup(data);
      setEditName(data.name);
      setEditDescription(data.description || "");
      setEditColor(data.color || "#3b82f6");
    } catch (e) {
      console.error("Failed to fetch group:", e);
      router.push("/groups");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
          color: editColor || null,
        }),
      });
      if (res.ok) {
        await fetchGroup();
        setShowEditDialog(false);
      } else {
        alert("Fehler beim Speichern");
      }
    } catch (e) {
      console.error("Failed to update group:", e);
      alert("Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        router.push("/groups");
      } else {
        alert("Fehler beim Löschen");
      }
    } catch (e) {
      console.error("Failed to delete group:", e);
      alert("Fehler beim Löschen");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}/members/${memberId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        await fetchGroup();
      }
    } catch (e) {
      console.error("Failed to remove member:", e);
    }
  }

  function getStatusBadge(lastSeen: string) {
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = (now.getTime() - lastSeenDate.getTime()) / 1000 / 60;

    if (diffMinutes < 5) {
      return <Badge className="bg-green-600">Online</Badge>;
    } else if (diffMinutes < 60) {
      return <Badge className="bg-yellow-600">Away</Badge>;
    } else {
      return <Badge variant="secondary">Offline</Badge>;
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleString("de-DE", {
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
        {/* Breadcrumb */}
        <Breadcrumb items={[{ label: "Groups", href: "/groups" }, { label: group.name }]} />
        
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
                <Badge variant="secondary">Dynamische Gruppe</Badge>
              )}
            </div>
            {group.description && (
              <p className="text-muted-foreground mt-2">{group.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowEditDialog(true)}>
              Bearbeiten
            </Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              Löschen
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Mitglieder</CardDescription>
              <CardTitle className="text-4xl">{group.members.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Erstellt am</CardDescription>
              <CardTitle className="text-lg">{formatDate(group.created_at)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Typ</CardDescription>
              <CardTitle className="text-lg">
                {group.is_dynamic ? "Dynamisch (Regel-basiert)" : "Statisch (Manuell)"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Dynamic Rule (if applicable) */}
        {group.is_dynamic && group.dynamic_rule && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Regel-Definition</CardTitle>
              <CardDescription>
                Diese Regel bestimmt die Gruppenmitgliedschaft automatisch
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(group.dynamic_rule, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Members Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Mitglieder</CardTitle>
                <CardDescription>
                  {group.is_dynamic
                    ? "Mitglieder werden automatisch durch die Regel bestimmt"
                    : "Manuell zugewiesene Geräte"}
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
                    <TableHead>Hostname</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Betriebssystem</TableHead>
                    <TableHead>Zuletzt gesehen</TableHead>
                    <TableHead>Hinzugefügt am</TableHead>
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
                            Entfernen
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Keine Mitglieder in dieser Gruppe</p>
                {!group.is_dynamic && (
                  <p className="text-sm mt-2">
                    Klicken Sie auf "Geräte hinzufügen" um Nodes zu dieser Gruppe hinzuzufügen.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gruppe bearbeiten</DialogTitle>
            <DialogDescription>Ändern Sie die Details der Gruppe.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="color">Farbe</Label>
              <div className="flex gap-2">
                <Input
                  id="color"
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  className="w-16 h-10 p-1"
                />
                <Input
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                  placeholder="#3b82f6"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editName.trim()}>
              {saving ? "Speichern..." : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gruppe löschen?</DialogTitle>
            <DialogDescription>
              Möchten Sie die Gruppe "{group.name}" wirklich löschen? Diese Aktion kann
              nicht rückgängig gemacht werden. Die Mitglieder werden nicht gelöscht,
              sondern nur aus der Gruppe entfernt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? "Löschen..." : "Löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
