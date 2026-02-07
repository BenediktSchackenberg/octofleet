import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { CreateTagDialog } from "@/components/create-tag-dialog";

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

async function getGroups(): Promise<Group[]> {
  try {
    const res = await fetch('http://localhost:8080/api/v1/groups', {
      headers: { 'X-API-Key': 'openclaw-inventory-dev-key' },
      cache: 'no-store'
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.groups || [];
  } catch {
    return [];
  }
}

async function getTags(): Promise<Tag[]> {
  try {
    const res = await fetch('http://localhost:8080/api/v1/tags', {
      headers: { 'X-API-Key': 'openclaw-inventory-dev-key' },
      cache: 'no-store'
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.tags || [];
  } catch {
    return [];
  }
}

export default async function GroupsPage() {
  const [groups, tags] = await Promise.all([getGroups(), getTags()]);
  
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-4">
              <Link href="/" className="text-muted-foreground hover:text-primary">
                ← Zurück
              </Link>
            </div>
            <h1 className="text-4xl font-bold mt-2">📁 Gruppen & Tags</h1>
            <p className="text-muted-foreground mt-2">Geräte organisieren und gruppieren</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Gruppen</CardDescription>
              <CardTitle className="text-4xl">{groups.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Tags</CardDescription>
              <CardTitle className="text-4xl">{tags.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Dynamische Gruppen</CardDescription>
              <CardTitle className="text-4xl text-blue-500">
                {groups.filter(g => g.is_dynamic).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Groups Section */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Gruppen</h2>
            <CreateGroupDialog />
          </div>
          
          {groups.length === 0 ? (
            <Card className="p-8 text-center">
              <CardContent>
                <p className="text-muted-foreground mb-2">Noch keine Gruppen erstellt</p>
                <p className="text-sm text-muted-foreground">
                  Erstelle Gruppen um Geräte zu organisieren
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {groups.map((group) => (
                <Link key={group.id} href={`/groups/${group.id}`}>
                  <Card className="hover:border-primary transition-colors cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {group.color && (
                            <div 
                              className="w-3 h-3 rounded-full" 
                              style={{ backgroundColor: group.color }}
                            />
                          )}
                          <CardTitle className="text-lg">{group.name}</CardTitle>
                        </div>
                        <div className="flex gap-1">
                          {group.is_dynamic && (
                            <Badge variant="secondary" className="text-xs">Dynamisch</Badge>
                          )}
                        </div>
                      </div>
                      {group.description && (
                        <CardDescription className="line-clamp-2">{group.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Mitglieder</span>
                        <Badge variant="outline">{group.member_count} Geräte</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Tags</h2>
            <CreateTagDialog />
          </div>
          
          {tags.length === 0 ? (
            <Card className="p-8 text-center">
              <CardContent>
                <p className="text-muted-foreground mb-2">Noch keine Tags erstellt</p>
                <p className="text-sm text-muted-foreground">
                  Tags helfen bei der freien Kategorisierung von Geräten
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-3">
              {tags.map((tag) => (
                <Badge 
                  key={tag.id}
                  variant="outline"
                  className="text-sm py-2 px-4 cursor-pointer hover:bg-accent"
                  style={tag.color ? { borderColor: tag.color, color: tag.color } : {}}
                >
                  {tag.name}
                  <span className="ml-2 text-muted-foreground">({tag.device_count})</span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
