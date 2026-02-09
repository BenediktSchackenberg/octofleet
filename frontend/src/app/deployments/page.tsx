"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { Plus, Rocket, CheckCircle, XCircle, Clock, Loader2, RefreshCw, Pause, Play } from "lucide-react";
import { CreateDeploymentDialog } from "@/components/create-deployment-dialog";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

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
        headers: { "X-API-Key": API_KEY },
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
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
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
