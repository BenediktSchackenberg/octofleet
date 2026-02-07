import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface NodeSummary {
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  last_seen: string;
  cpu_name: string;
  total_memory_gb: number;
}

async function getNodes(): Promise<NodeSummary[]> {
  try {
    const res = await fetch('http://192.168.0.5:8080/api/v1/nodes', {
      headers: { 'X-API-Key': 'openclaw-inventory-dev-key' },
      cache: 'no-store'
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.nodes || [];
  } catch {
    return [];
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

function formatLastSeen(lastSeen: string) {
  const date = new Date(lastSeen);
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default async function Dashboard() {
  const nodes = await getNodes();
  
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold">🦎 OpenClaw Inventory</h1>
            <p className="text-muted-foreground mt-2">Übersicht aller verbundenen Nodes</p>
          </div>
          <div className="flex gap-4">
            <Button variant="outline" asChild>
              <Link href="/jobs">🚀 Jobs</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/groups">📁 Gruppen & Tags</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/api/refresh">🔄 Aktualisieren</Link>
            </Button>
          </div>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Nodes Gesamt</CardDescription>
              <CardTitle className="text-4xl">{nodes.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Online</CardDescription>
              <CardTitle className="text-4xl text-green-500">
                {nodes.filter(n => {
                  const diff = (Date.now() - new Date(n.last_seen).getTime()) / 1000 / 60;
                  return diff < 5;
                }).length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Away</CardDescription>
              <CardTitle className="text-4xl text-yellow-500">
                {nodes.filter(n => {
                  const diff = (Date.now() - new Date(n.last_seen).getTime()) / 1000 / 60;
                  return diff >= 5 && diff < 60;
                }).length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Offline</CardDescription>
              <CardTitle className="text-4xl text-muted-foreground">
                {nodes.filter(n => {
                  const diff = (Date.now() - new Date(n.last_seen).getTime()) / 1000 / 60;
                  return diff >= 60;
                }).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {nodes.length === 0 ? (
          <Card className="p-12 text-center">
            <CardContent>
              <p className="text-xl text-muted-foreground mb-4">Noch keine Nodes registriert</p>
              <p className="text-sm text-muted-foreground">
                Führe <code className="bg-muted px-2 py-1 rounded">inventory.push</code> auf einem Windows Node aus
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {nodes.map((node) => (
              <Link key={node.node_id} href={`/nodes/${node.node_id}`}>
                <Card className="hover:border-primary transition-colors cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{node.hostname}</CardTitle>
                      {getStatusBadge(node.last_seen)}
                    </div>
                    <CardDescription>{node.node_id}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">OS</span>
                        <span>{node.os_name} {node.os_version}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">CPU</span>
                        <span className="truncate max-w-[200px]">{node.cpu_name || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">RAM</span>
                        <span>{node.total_memory_gb ? `${node.total_memory_gb.toFixed(1)} GB` : '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Zuletzt gesehen</span>
                        <span>{formatLastSeen(node.last_seen)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
