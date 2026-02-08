import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Timeline } from "@/components/timeline";

interface NodeDetails {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  os_build: string;
  last_seen: string;
  first_seen: string;
  is_online: boolean;
  cpuName: string | null;
  totalMemoryGb: number | null;
  softwareCount: number;
  hardwareUpdatedAt: string | null;
  groups: { id: string; name: string; color: string; icon: string | null }[];
  tags: { id: string; name: string; color: string }[];
}

interface InventoryChange {
  id: number;
  category: string;
  changeType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

async function getNodeDetails(nodeId: string): Promise<NodeDetails | null> {
  try {
    const res = await fetch(`http://192.168.0.5:8080/api/v1/nodes/${nodeId}`, {
      headers: { 'X-API-Key': 'openclaw-inventory-dev-key' },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getNodeHistory(nodeId: string, limit: number = 50): Promise<InventoryChange[]> {
  try {
    const res = await fetch(`http://192.168.0.5:8080/api/v1/nodes/${nodeId}/history?limit=${limit}`, {
      headers: { 'X-API-Key': 'openclaw-inventory-dev-key' },
      cache: 'no-store'
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.changes || [];
  } catch {
    return [];
  }
}

function getStatusBadge(lastSeen: string) {
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  const diffMinutes = (now.getTime() - lastSeenDate.getTime()) / 1000 / 60;
  
  if (diffMinutes < 5) {
    return <Badge className="bg-green-600 text-white">Online</Badge>;
  } else if (diffMinutes < 60) {
    return <Badge className="bg-yellow-600 text-white">Away</Badge>;
  } else {
    return <Badge variant="secondary">Offline</Badge>;
  }
}

function formatDateTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default async function NodeDetailPage({ 
  params 
}: { 
  params: Promise<{ nodeId: string }> 
}) {
  const { nodeId } = await params;
  const [node, history] = await Promise.all([
    getNodeDetails(nodeId),
    getNodeHistory(nodeId)
  ]);
  
  if (!node) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            ← Zurück zum Dashboard
          </Link>
          <Card className="mt-8 p-12 text-center">
            <CardContent>
              <p className="text-xl text-muted-foreground">Node nicht gefunden</p>
              <p className="text-sm text-muted-foreground mt-2">ID: {nodeId}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }
  
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/" className="text-muted-foreground hover:text-primary">
              ← Zurück zum Dashboard
            </Link>
            <div className="flex items-center gap-4 mt-2">
              <h1 className="text-4xl font-bold">{node.hostname}</h1>
              {getStatusBadge(node.last_seen)}
            </div>
            <p className="text-muted-foreground mt-1">{node.node_id}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              📊 Inventory abrufen
            </Button>
            <Button variant="outline">
              ⚙️ Einstellungen
            </Button>
          </div>
        </div>

        {/* System Info Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Betriebssystem</CardDescription>
              <CardTitle className="text-lg">{node.os_name || 'Unbekannt'}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {node.os_version && `Version ${node.os_version}`}
                {node.os_build && ` (Build ${node.os_build})`}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Prozessor</CardDescription>
              <CardTitle className="text-lg truncate" title={node.cpuName || undefined}>
                {node.cpuName || 'Unbekannt'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">CPU Info</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Arbeitsspeicher</CardDescription>
              <CardTitle className="text-lg">
                {node.totalMemoryGb ? `${node.totalMemoryGb.toFixed(1)} GB` : 'Unbekannt'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">RAM installiert</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Software</CardDescription>
              <CardTitle className="text-lg">
                {node.softwareCount} Programme
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Installiert
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Groups and Tags */}
        {(node.groups.length > 0 || node.tags.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-8">
            {node.groups.map(group => (
              <Badge 
                key={group.id} 
                style={{ backgroundColor: group.color, color: 'white' }}
              >
                {group.icon && `${group.icon} `}{group.name}
              </Badge>
            ))}
            {node.tags.map(tag => (
              <Badge 
                key={tag.id} 
                variant="outline"
                style={{ borderColor: tag.color, color: tag.color }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Timeline Section */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Timeline */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📜 Änderungsverlauf
                </CardTitle>
                <CardDescription>
                  Erkannte Änderungen am System
                </CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>Noch keine Änderungen erfasst</p>
                    <p className="text-sm mt-2">
                      Änderungen werden beim nächsten Inventory-Push erkannt
                    </p>
                  </div>
                ) : (
                  <Timeline changes={history} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">📅 Zeitstempel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Erste Erfassung</p>
                  <p className="font-medium">{formatDateTime(node.first_seen)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Zuletzt gesehen</p>
                  <p className="font-medium">{formatDateTime(node.last_seen)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Änderungen</p>
                  <p className="font-medium">{history.length} erfasst</p>
                </div>
              </CardContent>
            </Card>

            {/* Category Filter */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🏷️ Kategorien</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {['Hardware', 'Software', 'Security', 'Network', 'System'].map(cat => (
                    <Badge key={cat} variant="outline" className="cursor-pointer hover:bg-accent">
                      {cat}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">⚡ Aktionen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start">
                  🔄 Inventory jetzt abrufen
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  📋 Vollständigen Report
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  📤 Als CSV exportieren
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
