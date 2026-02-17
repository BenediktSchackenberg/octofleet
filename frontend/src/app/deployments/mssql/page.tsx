"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb } from "@/components/ui-components";
import { Database, Server, HardDrive, Play, CheckCircle, XCircle, Clock, Loader2, RefreshCw, ChevronRight, AlertCircle } from "lucide-react";
import { getAuthHeader } from "@/lib/auth-context";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";

interface Edition {
  id: string;
  name: string;
  free: boolean;
  limits: string;
  versions: string[];
  downloadable: boolean;
  requiresLicense: boolean;
}

interface Node {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string;
  is_online: boolean;
}

interface MssqlInstance {
  id: string;
  nodeId: string;
  hostname: string;
  instanceName: string;
  edition: string;
  version: string;
  port: number;
  status: string;
  paths: {
    data: string;
    log: string;
    tempdb: string;
  };
  jobs: Record<string, {
    jobId: string;
    name: string;
    status: string;
    exitCode: number | null;
  }>;
  createdAt: string;
}

interface DiskConfig {
  purpose: string;
  diskNumber: number;
  driveLetter: string;
  volumeLabel: string;
  folder: string;
}

const statusColors: Record<string, string> = {
  pending: "bg-gray-500",
  disk_prep: "bg-blue-500",
  downloading: "bg-blue-500",
  installing: "bg-yellow-500",
  configuring: "bg-yellow-500",
  running: "bg-green-500",
  failed: "bg-red-500",
};

const statusLabels: Record<string, string> = {
  pending: "Ausstehend",
  disk_prep: "Disk-Vorbereitung",
  downloading: "Download",
  installing: "Installation",
  configuring: "Konfiguration",
  running: "Läuft",
  failed: "Fehlgeschlagen",
};

export default function MssqlDeploymentPage() {
  const router = useRouter();
  const [editions, setEditions] = useState<Edition[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [instances, setInstances] = useState<MssqlInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [selectedEdition, setSelectedEdition] = useState("developer");
  const [selectedVersion, setSelectedVersion] = useState("2022");
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [instanceName, setInstanceName] = useState("MSSQLSERVER");
  const [saPassword, setSaPassword] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [port, setPort] = useState(1433);
  const [includeSsms, setIncludeSsms] = useState(true);
  const [prepareDisks, setPrepareDisks] = useState(true);
  const [diskConfigs, setDiskConfigs] = useState<DiskConfig[]>([
    { purpose: "data", diskNumber: 1, driveLetter: "D", volumeLabel: "SQL_Data", folder: "Data" },
    { purpose: "log", diskNumber: 2, driveLetter: "E", volumeLabel: "SQL_Logs", folder: "Logs" },
    { purpose: "tempdb", diskNumber: 3, driveLetter: "F", volumeLabel: "SQL_TempDB", folder: "TempDB" },
  ]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const headers = { ...getAuthHeader() };
      
      // Fetch editions
      const editionsRes = await fetch(`${API_BASE}/mssql/editions`, { headers });
      const editionsData = await editionsRes.json();
      setEditions(editionsData.editions || []);

      // Fetch Windows nodes
      const nodesRes = await fetch(`${API_BASE}/nodes`, { headers });
      const nodesData = await nodesRes.json();
      const windowsNodes = (nodesData.nodes || []).filter((n: Node) => 
        n.os_name?.toLowerCase().includes("windows") || 
        (n.hostname && n.hostname === n.hostname.toUpperCase() && n.hostname !== "TESTU")
      );
      setNodes(windowsNodes);

      // Fetch existing instances
      const instancesRes = await fetch(`${API_BASE}/mssql/instances`, { headers });
      const instancesData = await instancesRes.json();
      setInstances(instancesData.instances || []);
    } catch (err) {
      setError("Fehler beim Laden der Daten");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeploy = async () => {
    if (selectedNodes.length === 0) {
      setError("Bitte mindestens einen Server auswählen");
      return;
    }
    if (!saPassword || saPassword.length < 8) {
      setError("SA-Passwort muss mindestens 8 Zeichen haben");
      return;
    }
    if ((selectedEdition === "standard" || selectedEdition === "enterprise") && !licenseKey) {
      setError(`${selectedEdition === "standard" ? "Standard" : "Enterprise"} Edition benötigt einen Lizenzschlüssel`);
      return;
    }

    setDeploying(true);
    setError(null);
    setSuccess(null);

    try {
      const headers = { 
        ...getAuthHeader(),
        "Content-Type": "application/json"
      };

      const payload: any = {
        targets: selectedNodes,
        edition: selectedEdition,
        version: selectedVersion,
        instanceName,
        features: ["SQLEngine"],
        saPassword,
        port,
        includeSsms,
      };

      if (licenseKey) {
        payload.licenseKey = licenseKey;
      }

      if (prepareDisks) {
        payload.diskConfig = {
          prepareDisks: true,
          disks: diskConfigs.map(dc => ({
            purpose: dc.purpose,
            diskIdentifier: { number: dc.diskNumber },
            driveLetter: dc.driveLetter,
            volumeLabel: dc.volumeLabel,
            allocationUnitKb: 64,
            folder: dc.folder,
          })),
        };
      }

      const res = await fetch(`${API_BASE}/mssql/install`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Deployment fehlgeschlagen");
      }

      setSuccess(`Deployment gestartet! ${data.deploymentsStarted} Jobs erstellt.`);
      setSaPassword("");
      setLicenseKey("");
      setSelectedNodes([]);
      
      // Refresh instances
      setTimeout(fetchData, 2000);
    } catch (err: any) {
      setError(err.message || "Deployment fehlgeschlagen");
    } finally {
      setDeploying(false);
    }
  };

  const toggleNodeSelection = (nodeId: string) => {
    setSelectedNodes(prev => 
      prev.includes(nodeId) 
        ? prev.filter(n => n !== nodeId)
        : [...prev, nodeId]
    );
  };

  const selectedEditionInfo = editions.find(e => e.id === selectedEdition);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Breadcrumb items={[
        { label: "Deployments", href: "/deployments" },
        { label: "SQL Server", href: "/deployments/mssql" }
      ]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="h-8 w-8" />
            SQL Server Deployment
          </h1>
          <p className="text-muted-foreground mt-1">
            Installiere Microsoft SQL Server auf Windows-Servern
          </p>
        </div>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Aktualisieren
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border border-green-500 text-green-500 px-4 py-3 rounded flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Edition & Version */}
          <Card>
            <CardHeader>
              <CardTitle>Edition & Version</CardTitle>
              <CardDescription>Wähle SQL Server Edition und Version</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Edition</Label>
                  <Select value={selectedEdition} onValueChange={setSelectedEdition}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editions.map(edition => (
                        <SelectItem key={edition.id} value={edition.id}>
                          <div className="flex items-center gap-2">
                            {edition.name}
                            {edition.free && <Badge variant="secondary" className="text-xs">Kostenlos</Badge>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedEditionInfo && (
                    <p className="text-xs text-muted-foreground">{selectedEditionInfo.limits}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Version</Label>
                  <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2019">SQL Server 2019</SelectItem>
                      <SelectItem value="2022">SQL Server 2022</SelectItem>
                      <SelectItem value="2025">SQL Server 2025</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Instanzname</Label>
                  <Input 
                    value={instanceName} 
                    onChange={e => setInstanceName(e.target.value)}
                    placeholder="MSSQLSERVER"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Port</Label>
                  <Input 
                    type="number"
                    value={port} 
                    onChange={e => setPort(parseInt(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>SA-Passwort *</Label>
                <Input 
                  type="password"
                  value={saPassword} 
                  onChange={e => setSaPassword(e.target.value)}
                  placeholder="Starkes Passwort eingeben"
                />
              </div>

              {(selectedEdition === "standard" || selectedEdition === "enterprise") && (
                <div className="space-y-2">
                  <Label>Lizenzschlüssel *</Label>
                  <Input 
                    value={licenseKey} 
                    onChange={e => setLicenseKey(e.target.value)}
                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                  />
                </div>
              )}

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="ssms" 
                  checked={includeSsms}
                  onCheckedChange={(checked) => setIncludeSsms(checked as boolean)}
                />
                <Label htmlFor="ssms">SQL Server Management Studio (SSMS) installieren</Label>
              </div>
            </CardContent>
          </Card>

          {/* Disk Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Disk-Konfiguration
              </CardTitle>
              <CardDescription>Laufwerke für SQL Server vorbereiten (64KB Allocation Units)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="prepareDisks" 
                  checked={prepareDisks}
                  onCheckedChange={(checked) => setPrepareDisks(checked as boolean)}
                />
                <Label htmlFor="prepareDisks">Disks automatisch formatieren und Ordner erstellen</Label>
              </div>

              {prepareDisks && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zweck</TableHead>
                      <TableHead>Disk #</TableHead>
                      <TableHead>Laufwerk</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Ordner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diskConfigs.map((disk, idx) => (
                      <TableRow key={disk.purpose}>
                        <TableCell className="font-medium capitalize">{disk.purpose}</TableCell>
                        <TableCell>
                          <Input 
                            type="number"
                            className="w-16"
                            value={disk.diskNumber}
                            onChange={e => {
                              const newConfigs = [...diskConfigs];
                              newConfigs[idx].diskNumber = parseInt(e.target.value);
                              setDiskConfigs(newConfigs);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            className="w-16"
                            value={disk.driveLetter}
                            maxLength={1}
                            onChange={e => {
                              const newConfigs = [...diskConfigs];
                              newConfigs[idx].driveLetter = e.target.value.toUpperCase();
                              setDiskConfigs(newConfigs);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            className="w-28"
                            value={disk.volumeLabel}
                            onChange={e => {
                              const newConfigs = [...diskConfigs];
                              newConfigs[idx].volumeLabel = e.target.value;
                              setDiskConfigs(newConfigs);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            className="w-24"
                            value={disk.folder}
                            onChange={e => {
                              const newConfigs = [...diskConfigs];
                              newConfigs[idx].folder = e.target.value;
                              setDiskConfigs(newConfigs);
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Server Selection */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Ziel-Server
              </CardTitle>
              <CardDescription>Wähle Server für die Installation</CardDescription>
            </CardHeader>
            <CardContent>
              {nodes.length === 0 ? (
                <p className="text-muted-foreground text-sm">Keine Windows-Server gefunden</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {nodes.map(node => (
                    <div 
                      key={node.node_id}
                      className={`flex items-center justify-between p-2 rounded border cursor-pointer transition-colors ${
                        selectedNodes.includes(node.node_id) 
                          ? "border-primary bg-primary/10" 
                          : "border-border hover:border-primary/50"
                      }`}
                      onClick={() => toggleNodeSelection(node.node_id)}
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox checked={selectedNodes.includes(node.node_id)} />
                        <span className="font-mono text-sm">{node.hostname}</span>
                      </div>
                      <Badge variant={node.is_online ? "default" : "secondary"}>
                        {node.is_online ? "Online" : "Offline"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              
              {selectedNodes.length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedNodes.length} Server ausgewählt
                </p>
              )}
            </CardContent>
          </Card>

          <Button 
            className="w-full" 
            size="lg"
            onClick={handleDeploy}
            disabled={deploying || selectedNodes.length === 0}
          >
            {deploying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deployment läuft...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                SQL Server installieren
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Existing Installations */}
      {instances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Installierte SQL Server</CardTitle>
            <CardDescription>Status aller SQL Server Deployments</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Server</TableHead>
                  <TableHead>Instanz</TableHead>
                  <TableHead>Edition</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pfade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instances.map(instance => (
                  <TableRow key={instance.id}>
                    <TableCell className="font-mono">{instance.hostname}</TableCell>
                    <TableCell>{instance.instanceName}</TableCell>
                    <TableCell className="capitalize">{instance.edition}</TableCell>
                    <TableCell>{instance.version}</TableCell>
                    <TableCell>{instance.port}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[instance.status] || "bg-gray-500"}>
                        {statusLabels[instance.status] || instance.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      D: {instance.paths.data}<br/>
                      L: {instance.paths.log}<br/>
                      T: {instance.paths.tempdb}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
