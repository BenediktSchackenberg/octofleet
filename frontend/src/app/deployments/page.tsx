"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { Plus, Rocket, CheckCircle, XCircle, Clock, Loader2, RefreshCw, Pause, Play, Database, Package, ChevronRight } from "lucide-react";
import { CreateDeploymentDialog } from "@/components/create-deployment-dialog";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "octofleet-dev-key";

interface Deployment {
  id: string;
  name: string;
  description: string | null;
  package_name: string;
  package_version: string;
  target_type: string;
  mode: string;
  status: string;
  created_at: string;
  total_nodes: number;
  success_count: number;
  failed_count: number;
  pending_count: number;
  in_progress_count: number;
}

const statusColors: Record<string, string> = {
  pending: "bg-gray-500",
  active: "bg-blue-500",
  paused: "bg-yellow-500",
  completed: "bg-green-500",
  cancelled: "bg-red-500",
};

const modeLabels: Record<string, string> = {
  required: "Pflicht",
  available: "Verfügbar",
  uninstall: "Deinstallation",
};

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function fetchDeployments() {
    try {
      const res = await fetch(`${API_BASE}/deployments`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        setDeployments(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch deployments:", e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(id: string, currentStatus: string) {
    const newStatus = currentStatus === "active" ? "paused" : "active";
    try {
      await fetch(`${API_BASE}/deployments/${id}`, {
        method: "PATCH",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchDeployments();
    } catch (e) {
      console.error("Failed to update deployment:", e);
    }
  }

  useEffect(() => {
    fetchDeployments();
  }, []);

  function getProgressBar(d: Deployment) {
    const total = d.total_nodes || 1;
    const successPct = (d.success_count / total) * 100;
    const failedPct = (d.failed_count / total) * 100;
    const inProgressPct = (d.in_progress_count / total) * 100;
    
    return (
      <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden flex">
        <div className="bg-green-500 h-full" style={{ width: `${successPct}%` }} />
        <div className="bg-blue-500 h-full" style={{ width: `${inProgressPct}%` }} />
        <div className="bg-red-500 h-full" style={{ width: `${failedPct}%` }} />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Dashboard", href: "/" }, { label: "Deployments" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Rocket className="h-8 w-8" />
            Deployments
          </h1>
          <p className="text-muted-foreground">Softwareverteilung an Nodes und Gruppen</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchDeployments}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Neues Deployment
          </Button>
        </div>
      </div>

      {/* E5-13: Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Gesamt</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{deployments.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktiv</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-500">
              {deployments.filter(d => d.status === "active").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Erfolg (Nodes)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-500">
              {deployments.reduce((sum, d) => sum + d.success_count, 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fehlgeschlagen</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-500">
              {deployments.reduce((sum, d) => sum + d.failed_count, 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ausstehend</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-500">
              {deployments.reduce((sum, d) => sum + d.pending_count + d.in_progress_count, 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Special Deployments */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Link href="/deployments/mssql">
          <Card className="cursor-pointer hover:border-primary transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Database className="h-8 w-8 text-blue-500" />
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <h3 className="font-semibold text-lg">SQL Server</h3>
              <p className="text-sm text-muted-foreground">
                Express, Developer, Standard, Enterprise
              </p>
              <div className="flex gap-1 mt-2">
                <Badge variant="secondary">2019</Badge>
                <Badge variant="secondary">2022</Badge>
                <Badge variant="secondary">2025</Badge>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card className="opacity-50 cursor-not-allowed">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Package className="h-8 w-8 text-orange-500" />
              <Badge variant="outline">Bald</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold text-lg">Smart Install</h3>
            <p className="text-sm text-muted-foreground">
              Software via Chocolatey deployen
            </p>
          </CardContent>
        </Card>

        <Card className="opacity-50 cursor-not-allowed">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Rocket className="h-8 w-8 text-purple-500" />
              <Badge variant="outline">Bald</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold text-lg">Custom Scripts</h3>
            <p className="text-sm text-muted-foreground">
              Eigene PowerShell-Skripte ausführen
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alle Deployments</CardTitle>
          <CardDescription>{deployments.length} Deployments insgesamt</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : deployments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Rocket className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine Deployments erstellt</p>
              <Button className="mt-4" onClick={() => setShowCreate(true)}>
                Erstes Deployment erstellen
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Paket</TableHead>
                  <TableHead>Modus</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead>Nodes</TableHead>
                  <TableHead>Erstellt</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deployments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/deployments/${d.id}`} className="font-medium hover:text-primary hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {d.package_name} <span className="text-muted-foreground">v{d.package_version}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{modeLabels[d.mode] || d.mode}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[d.status]}>{d.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getProgressBar(d)}
                        <span className="text-xs text-muted-foreground">
                          {d.success_count}/{d.total_nodes}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <CheckCircle className="h-3 w-3 text-green-500" /> {d.success_count}
                        <XCircle className="h-3 w-3 text-red-500 ml-2" /> {d.failed_count}
                        <Clock className="h-3 w-3 text-gray-400 ml-2" /> {d.pending_count}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(d.created_at).toLocaleDateString("de-DE")}
                    </TableCell>
                    <TableCell>
                      {(d.status === "active" || d.status === "paused") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleStatus(d.id, d.status)}
                        >
                          {d.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDeploymentDialog 
        open={showCreate} 
        onOpenChange={setShowCreate}
        onCreated={fetchDeployments}
      />
    </div>
  );
}
