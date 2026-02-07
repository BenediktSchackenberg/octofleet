import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddDevicesDialog } from "@/components/add-devices-dialog";

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

async function getGroup(id: string): Promise<GroupDetail | null> {
  try {
    const res = await fetch(`http://192.168.0.5:8080/api/v1/groups/${id}`, {
      headers: { 'X-API-Key': 'openclaw-inventory-dev-key' },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
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
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await getGroup(id);
  
  if (!group) {
    notFound();
  }
  
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-4">
              <Link href="/groups" className="text-muted-foreground hover:text-primary">
                ← Zurück zu Gruppen
              </Link>
            </div>
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
            <Button variant="outline">Bearbeiten</Button>
            <Button variant="destructive">Löschen</Button>
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
              <CardDescription>Diese Regel bestimmt die Gruppenmitgliedschaft automatisch</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                {JSON.stringify(group.dynamic_rule, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Members */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Mitglieder ({group.members.length})</h2>
            {!group.is_dynamic && (
              <AddDevicesDialog 
                groupId={group.id} 
                existingMemberIds={group.members.map(m => m.id)} 
              />
            )}
          </div>
          
          {group.members.length === 0 ? (
            <Card className="p-8 text-center">
              <CardContent>
                <p className="text-muted-foreground mb-2">Keine Mitglieder in dieser Gruppe</p>
                {!group.is_dynamic ? (
                  <p className="text-sm text-muted-foreground">
                    Füge Geräte manuell zu dieser statischen Gruppe hinzu
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Keine Geräte entsprechen der aktuellen Regel
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {group.members.map((member) => (
                <Link key={member.id} href={`/nodes/${member.node_id}`}>
                  <Card className="hover:border-primary transition-colors cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{member.hostname}</CardTitle>
                        {getStatusBadge(member.last_seen)}
                      </div>
                      <CardDescription>{member.node_id}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">OS</span>
                          <span className="truncate max-w-[150px]">{member.os_name || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Zugewiesen</span>
                          <span>{formatDate(member.assigned_at)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Durch</span>
                          <Badge variant="outline" className="text-xs">{member.assigned_by}</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
