"use client";
import { apiClient } from "@/lib/api-client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FavoriteButton } from "@/components/FavoriteButton";
import { Rocket, CheckCircle, XCircle, Clock, Loader2, RefreshCw, Pause, Play, Trash2, ArrowLeft, Download, Package } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n-context";



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
  pending: "bg-muted/500",
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
  const { t } = useI18n();
  // Deployment and node states; unknown values are shown as sent by the server
  const statusLabel = (status: string) => (status in statusColors ? t(`deploymentsPage.status.${status}`) : status);
  const router = useRouter();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function fetchDeployment() {
    try {
      const res = await apiClient.get<Deployment>(`/deployments/${id}`, { showErrorToast: false });
      if (res) {
        setDeployment(res);
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
    await apiClient.patch(`/deployments/${id}`, { status: newStatus }, { showErrorToast: false });
    fetchDeployment();
  }

  async function cancelDeployment() {
    await apiClient.patch(`/deployments/${id}`, { status: "cancelled" }, { showErrorToast: false });
    fetchDeployment();
  }

  async function deleteDeployment() {
    if (!confirm(t("deploymentDetail.deleteConfirm"))) return;
    await apiClient.delete(`/deployments/${id}`, { showErrorToast: false });
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
        <p>{t("deploymentDetail.notFound")}</p>
        <Button asChild className="mt-4">
          <Link href="/deployments">{t("common.back")}</Link>
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
<div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/deployments"><ArrowLeft className="h-5 w-5" /></Link>
            </Button>
            <h1 className="text-3xl font-bold">{deployment.name}</h1>
            <FavoriteButton
              type="deployment"
              id={deployment.id}
              label={deployment.name}
              href={`/deployments/${deployment.id}`}
            />
            <Badge className={statusColors[deployment.status]}>{statusLabel(deployment.status)}</Badge>
          </div>
          {deployment.description && (
            <p className="text-muted-foreground mt-1 ml-12">{deployment.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchDeployment}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.refresh")}
          </Button>
          {(deployment.status === "active" || deployment.status === "paused") && (
            <Button variant="outline" onClick={toggleStatus}>
              {deployment.status === "active" ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {deployment.status === "active" ? t("deploymentDetail.pause") : t("deploymentDetail.resume")}
            </Button>
          )}
          {deployment.status === "active" && (
            <Button variant="outline" onClick={cancelDeployment}>
              <XCircle className="h-4 w-4 mr-2" />
              {t("deploymentDetail.cancel")}
            </Button>
          )}
          <Button variant="destructive" onClick={deleteDeployment}>
            <Trash2 className="h-4 w-4 mr-2" />
            {t("common.delete")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("deploymentsPage.columns.package")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{deployment.package_name}</p>
            <p className="text-sm text-muted-foreground">v{deployment.package_version}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("deploymentDetail.succeeded")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-500">{successCount}</p>
            <p className="text-sm text-muted-foreground">{t("deploymentDetail.ofNodes", { count: deployment.nodes.length })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("deploymentsPage.cards.failed")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-500">{failedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("deploymentsPage.cards.pending")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-muted-foreground">{pendingCount + inProgressCount}</p>
            {inProgressCount > 0 && (
              <p className="text-sm text-blue-500">{t("deploymentDetail.inProgress", { count: inProgressCount })}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("deploymentDetail.nodeStatus")}</CardTitle>
          <CardDescription>{t("deploymentDetail.nodeStatusText")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("deploymentDetail.columns.hostname")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("deploymentDetail.columns.attempts")}</TableHead>
                <TableHead>{t("deploymentDetail.columns.started")}</TableHead>
                <TableHead>{t("deploymentDetail.columns.completed")}</TableHead>
                <TableHead>{t("deploymentDetail.columns.exitCode")}</TableHead>
                <TableHead>{t("deploymentDetail.columns.error")}</TableHead>
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
                        {statusLabel(n.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{n.attempts}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {n.started_at ? formatDateTime(n.started_at) : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {n.completed_at ? formatDateTime(n.completed_at) : "-"}
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
