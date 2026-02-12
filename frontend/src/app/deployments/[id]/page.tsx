"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { Rocket, CheckCircle, XCircle, Clock, Loader2, RefreshCw, Pause, Play, Trash2, ArrowLeft, Download, Package } from "lucide-react";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

interface NodeStatus {
  id: string;
  node_id: string;
  node_name: string;
  hostname: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  error_message: string | null;
  attempts: number;
}

interface Deployment {
  id: string;
  name: string;
  description: string | null;
  package_name: string;
  package_version: string;
  target_type: string;
  target_id: string | null;
  mode: string;
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  maintenance_window_only: boolean;
  created_at: string;
  updated_at: string;
  nodes: NodeStatus[];
}

const statusColors: Record<string, string> = {
  pending: "bg-gray-500",
  downloading: "bg-blue-400",
  installing: "bg-blue-500",
  success: "bg-green-500",
  failed: "bg-red-500",
  skipped: "bg-yellow-500",
  active: "bg-blue-500",
  paused: "bg-yellow-500",
  completed: "bg-green-500",
  cancelled: "bg-red-500",
};

const statusIcons: Record<string, any> = {
  pending: Clock,
  downloading: Download,
  installing: Package,
  success: CheckCircle,
  failed: XCircle,
  skipped: Clock,
};

export default function DeploymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function fetchDeployment() {
    try {
      const res = await fetch(`${API_BASE}/deployments/${id}`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        setDeployment(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch deployment:", e);
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus() {
    if (!deployment) return;
    const newStatus = deployment.status === "active" ? "paused" : "active";
    await fetch(`${API_BASE}/deployments/${id}`, {
      method: "PATCH",
      headers: { ...getAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchDeployment();
  }

  async function cancelDeployment() {
    await fetch(`${API_BASE}/deployments/${id}`, {
      method: "PATCH",
      headers: { ...getAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    fetchDeployment();
  }

  async function deleteDeployment() {
    if (!confirm("Deployment wirklich löschen?")) return;
    await fetch(`${API_BASE}/deployments/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    router.push("/deployments");
  }

  useEffect(() => {
    fetchDeployment();
  }, [id]);

  useEffect(() => {
    if (!autoRefresh || !deployment || deployment.status === "completed" || deployment.status === "cancelled") return;
    const interval = setInterval(fetchDeployment, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, deployment?.status]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="container mx-auto p-6">
        <p>Deployment nicht gefunden</p>
        <Button asChild className="mt-4">
          <Link href="/deployments">Zurück</Link>
        </Button>
      </div>
    );
  }

  const successCount = deployment.nodes.filter((n) => n.status === "success").length;
  const failedCount = deployment.nodes.filter((n) => n.status === "failed").length;
  const pendingCount = deployment.nodes.filter((n) => n.status === "pending").length;
  const inProgressCount = deployment.nodes.filter((n) => ["downloading", "installing"].includes(n.status)).length;

  return (
    <div className="container mx-auto p-6">
      <Breadcrumb items={[
        { label: "Home", href: "/" },
        { label: "Deployments", href: "/deployments" },
        { label: deployment.name }
      ]} />

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/deployments"><ArrowLeft className="h-5 w-5" /></Link>
            </Button>
            <h1 className="text-3xl font-bold">{deployment.name}</h1>
            <Badge className={statusColors[deployment.status]}>{deployment.status}</Badge>
          </div>
          {deployment.description && (
            <p className="text-muted-foreground mt-1 ml-12">{deployment.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchDeployment}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Aktualisieren
          </Button>
          {(deployment.status === "active" || deployment.status === "paused") && (
            <Button variant="outline" onClick={toggleStatus}>
              {deployment.status === "active" ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {deployment.status === "active" ? "Pausieren" : "Fortsetzen"}
            </Button>
          )}
          {deployment.status === "active" && (
            <Button variant="outline" onClick={cancelDeployment}>
              <XCircle className="h-4 w-4 mr-2" />
              Abbrechen
            </Button>
          )}
          <Button variant="destructive" onClick={deleteDeployment}>
            <Trash2 className="h-4 w-4 mr-2" />
            Löschen
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Paket</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{deployment.package_name}</p>
            <p className="text-sm text-muted-foreground">v{deployment.package_version}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Erfolg</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-500">{successCount}</p>
            <p className="text-sm text-muted-foreground">von {deployment.nodes.length} Nodes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fehlgeschlagen</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-500">{failedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ausstehend</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-500">{pendingCount + inProgressCount}</p>
            {inProgressCount > 0 && (
              <p className="text-sm text-blue-500">{inProgressCount} in Bearbeitung</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Node Status</CardTitle>
          <CardDescription>Status pro Gerät</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hostname</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Versuche</TableHead>
                <TableHead>Gestartet</TableHead>
                <TableHead>Abgeschlossen</TableHead>
                <TableHead>Exit Code</TableHead>
                <TableHead>Fehler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployment.nodes.map((n) => {
                const Icon = statusIcons[n.status] || Clock;
                return (
                  <TableRow key={n.id}>
                    <TableCell>
                      <Link href={`/nodes/${n.node_name}`} className="hover:text-primary hover:underline">
                        {n.hostname || n.node_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[n.status]}>
                        <Icon className="h-3 w-3 mr-1" />
                        {n.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{n.attempts}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {n.started_at ? new Date(n.started_at).toLocaleString("de-DE") : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {n.completed_at ? new Date(n.completed_at).toLocaleString("de-DE") : "-"}
                    </TableCell>
                    <TableCell>{n.exit_code ?? "-"}</TableCell>
                    <TableCell className="text-sm text-red-500 max-w-xs truncate">
                      {n.error_message || "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
