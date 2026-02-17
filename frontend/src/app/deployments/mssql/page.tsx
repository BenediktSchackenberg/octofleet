"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumb } from "@/components/ui-components";
import { Database, Server, HardDrive, Play, CheckCircle, XCircle, Clock, Loader2, RefreshCw, Plus, Link, Trash2 } from "lucide-react";
import { getAuthHeader } from "@/lib/auth-context";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";

interface Edition {
  id: string;
  name: string;
  free: boolean;
  limits: string;
}

interface MssqlConfig {
  id: string;
  name: string;
  description: string;
  edition: string;
  version: string;
  instanceName: string;
  port: number;
  diskConfigs: Array<{
    purpose: string;
    driveLetter: string;
    folder: string;
  }>;
}

interface Group {
  id: string;
  name: string;
  member_count: number;
}

interface Assignment {
  id: string;
  configId: string;
  configName: string;
  edition: string;
  version: string;
  groupId: string;
  groupName: string;
  enabled: boolean;
  memberCount: number;
  installedCount: number;
  pendingCount: number;
}

interface AssignmentDetail {
  id: string;
  configName: string;
  groupName: string;
  nodes: Array<{
    nodeId: string;
    hostname: string;
    isOnline: boolean;
    installStatus: string;
  }>;
  summary: {
    total: number;
    installed: number;
    pending: number;
    notInstalled: number;
    failed: number;
  };
}

const statusColors: Record<string, string> = {
  running: "bg-green-500",
  pending: "bg-yellow-500",
  disk_prep: "bg-blue-500",
  installing: "bg-blue-500",
  not_installed: "bg-gray-500",
  failed: "bg-red-500",
};

const statusLabels: Record<string, string> = {
  running: "Läuft",
  pending: "Ausstehend",
  disk_prep: "Disk-Vorbereitung",
  installing: "Installation",
  not_installed: "Nicht installiert",
  failed: "Fehlgeschlagen",
};

export default function MssqlAssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [configs, setConfigs] = useState<MssqlConfig[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentDetail | null>(null);

  // New config form
  const [showNewConfig, setShowNewConfig] = useState(false);
  const [newConfig, setNewConfig] = useState({
    name: "",
    edition: "developer",
    version: "2022",
    instanceName: "MSSQLSERVER",
    port: 1433,
  });

  // New assignment form
  const [showNewAssignment, setShowNewAssignment] = useState(false);
  const [newAssignment, setNewAssignment] = useState({
    configId: "",
    groupId: "",
    saPassword: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const headers = { ...getAuthHeader() };
      
      const [assignmentsRes, configsRes, groupsRes, editionsRes] = await Promise.all([
        fetch(`${API_BASE}/mssql/assignments`, { headers }),
        fetch(`${API_BASE}/mssql/configs`, { headers }),
        fetch(`${API_BASE}/groups`, { headers }),
        fetch(`${API_BASE}/mssql/editions`, { headers }),
      ]);

      const [assignmentsData, configsData, groupsData, editionsData] = await Promise.all([
        assignmentsRes.json(),
        configsRes.json(),
        groupsRes.json(),
        editionsRes.json(),
      ]);

      setAssignments(assignmentsData.assignments || []);
      setConfigs(configsData.configs || []);
      setGroups(groupsData.groups || []);
      setEditions(editionsData.editions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateConfig = async () => {
    const headers = { ...getAuthHeader(), "Content-Type": "application/json" };
    
    const res = await fetch(`${API_BASE}/mssql/configs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...newConfig,
        features: ["SQLEngine"],
        includeSsms: true,
        diskConfigs: [
          { purpose: "data", diskNumber: 1, driveLetter: "D", volumeLabel: "SQL_Data", folder: "Data" },
          { purpose: "log", diskNumber: 2, driveLetter: "E", volumeLabel: "SQL_Logs", folder: "Logs" },
          { purpose: "tempdb", diskNumber: 3, driveLetter: "F", volumeLabel: "SQL_TempDB", folder: "TempDB" },
        ],
      }),
    });

    if (res.ok) {
      setShowNewConfig(false);
      setNewConfig({ name: "", edition: "developer", version: "2022", instanceName: "MSSQLSERVER", port: 1433 });
      fetchData();
    }
  };

  const handleCreateAssignment = async () => {
    if (!newAssignment.configId || !newAssignment.groupId || !newAssignment.saPassword) {
      alert("Bitte alle Felder ausfüllen");
      return;
    }

    const headers = { ...getAuthHeader(), "Content-Type": "application/json" };
    
    const res = await fetch(`${API_BASE}/mssql/assignments`, {
      method: "POST",
      headers,
      body: JSON.stringify(newAssignment),
    });

    if (res.ok) {
      setShowNewAssignment(false);
      setNewAssignment({ configId: "", groupId: "", saPassword: "" });
      fetchData();
    }
  };

  const handleReconcile = async (assignmentId: string) => {
    setReconciling(assignmentId);
    const headers = { ...getAuthHeader() };
    
    try {
      const res = await fetch(`${API_BASE}/mssql/assignments/${assignmentId}/reconcile`, {
        method: "POST",
        headers,
      });
      
      if (res.ok) {
        const data = await res.json();
        alert(`${data.nodesProcessed} Jobs erstellt!`);
        fetchData();
        if (selectedAssignment?.id === assignmentId) {
          loadAssignmentDetail(assignmentId);
        }
      }
    } finally {
      setReconciling(null);
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm("Assignment wirklich löschen?")) return;
    
    const headers = { ...getAuthHeader() };
    await fetch(`${API_BASE}/mssql/assignments/${assignmentId}`, {
      method: "DELETE",
      headers,
    });
    
    fetchData();
    if (selectedAssignment?.id === assignmentId) {
      setSelectedAssignment(null);
    }
  };

  const loadAssignmentDetail = async (assignmentId: string) => {
    const headers = { ...getAuthHeader() };
    const res = await fetch(`${API_BASE}/mssql/assignments/${assignmentId}`, { headers });
    if (res.ok) {
      setSelectedAssignment(await res.json());
    }
  };

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
            SQL Server Deployments
          </h1>
          <p className="text-muted-foreground mt-1">
            Profile erstellen und Gruppen zuweisen
          </p>
        </div>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Aktualisieren
        </Button>
      </div>

      <Tabs defaultValue="assignments">
        <TabsList>
          <TabsTrigger value="assignments">Zuweisungen</TabsTrigger>
          <TabsTrigger value="configs">Profile</TabsTrigger>
        </TabsList>

        {/* Assignments Tab */}
        <TabsContent value="assignments" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNewAssignment(true)}>
              <Link className="h-4 w-4 mr-2" />
              Neue Zuweisung
            </Button>
          </div>

          {/* New Assignment Form */}
          {showNewAssignment && (
            <Card>
              <CardHeader>
                <CardTitle>Neue Zuweisung</CardTitle>
                <CardDescription>Profil einer Gruppe zuweisen</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Profil</Label>
                    <Select value={newAssignment.configId} onValueChange={v => setNewAssignment({...newAssignment, configId: v})}>
                      <SelectTrigger><SelectValue placeholder="Profil wählen" /></SelectTrigger>
                      <SelectContent>
                        {configs.map(c => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({c.edition} {c.version})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Gruppe</Label>
                    <Select value={newAssignment.groupId} onValueChange={v => setNewAssignment({...newAssignment, groupId: v})}>
                      <SelectTrigger><SelectValue placeholder="Gruppe wählen" /></SelectTrigger>
                      <SelectContent>
                        {groups.map(g => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name} ({g.member_count} Server)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>SA-Passwort</Label>
                    <Input 
                      type="password" 
                      value={newAssignment.saPassword}
                      onChange={e => setNewAssignment({...newAssignment, saPassword: e.target.value})}
                      placeholder="Starkes Passwort"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCreateAssignment}>Zuweisen</Button>
                  <Button variant="outline" onClick={() => setShowNewAssignment(false)}>Abbrechen</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assignments List */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Aktive Zuweisungen</CardTitle>
                <CardDescription>{assignments.length} Zuweisungen</CardDescription>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Keine Zuweisungen. Erstelle ein Profil und weise es einer Gruppe zu.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {assignments.map(a => (
                      <div 
                        key={a.id}
                        className={`p-3 border rounded cursor-pointer transition-colors ${
                          selectedAssignment?.id === a.id ? "border-primary bg-primary/5" : "hover:border-primary/50"
                        }`}
                        onClick={() => loadAssignmentDetail(a.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{a.configName}</p>
                            <p className="text-sm text-muted-foreground">
                              → {a.groupName} ({a.memberCount} Server)
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{a.edition} {a.version}</Badge>
                            <div className="text-xs">
                              <span className="text-green-500">{a.installedCount}✓</span>
                              {a.pendingCount > 0 && <span className="text-yellow-500 ml-1">{a.pendingCount}⏳</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Assignment Detail */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {selectedAssignment ? selectedAssignment.configName : "Details"}
                </CardTitle>
                <CardDescription>
                  {selectedAssignment ? `Gruppe: ${selectedAssignment.groupName}` : "Wähle eine Zuweisung"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedAssignment ? (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="p-2 bg-muted rounded">
                        <p className="text-2xl font-bold">{selectedAssignment.summary.total}</p>
                        <p className="text-xs text-muted-foreground">Gesamt</p>
                      </div>
                      <div className="p-2 bg-green-500/10 rounded">
                        <p className="text-2xl font-bold text-green-500">{selectedAssignment.summary.installed}</p>
                        <p className="text-xs text-muted-foreground">Installiert</p>
                      </div>
                      <div className="p-2 bg-yellow-500/10 rounded">
                        <p className="text-2xl font-bold text-yellow-500">{selectedAssignment.summary.pending}</p>
                        <p className="text-xs text-muted-foreground">Ausstehend</p>
                      </div>
                      <div className="p-2 bg-gray-500/10 rounded">
                        <p className="text-2xl font-bold text-gray-500">{selectedAssignment.summary.notInstalled}</p>
                        <p className="text-xs text-muted-foreground">Fehlt</p>
                      </div>
                    </div>

                    {/* Node List */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Server</TableHead>
                          <TableHead>Online</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedAssignment.nodes.map(n => (
                          <TableRow key={n.nodeId}>
                            <TableCell className="font-mono">{n.hostname}</TableCell>
                            <TableCell>
                              {n.isOnline ? (
                                <Badge className="bg-green-500">Online</Badge>
                              ) : (
                                <Badge variant="secondary">Offline</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusColors[n.installStatus] || "bg-gray-500"}>
                                {statusLabels[n.installStatus] || n.installStatus}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => handleReconcile(selectedAssignment.id)}
                        disabled={reconciling === selectedAssignment.id}
                      >
                        {reconciling === selectedAssignment.id ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Reconcile (Fehlende deployen)
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="icon"
                        onClick={() => handleDeleteAssignment(selectedAssignment.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    Wähle links eine Zuweisung aus
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Configs Tab */}
        <TabsContent value="configs" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowNewConfig(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neues Profil
            </Button>
          </div>

          {/* New Config Form */}
          {showNewConfig && (
            <Card>
              <CardHeader>
                <CardTitle>Neues SQL Server Profil</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input 
                      value={newConfig.name}
                      onChange={e => setNewConfig({...newConfig, name: e.target.value})}
                      placeholder="z.B. SQL Server 2022 Developer"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Edition</Label>
                    <Select value={newConfig.edition} onValueChange={v => setNewConfig({...newConfig, edition: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {editions.map(e => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name} {e.free && "(Kostenlos)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Version</Label>
                    <Select value={newConfig.version} onValueChange={v => setNewConfig({...newConfig, version: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2019">SQL Server 2019</SelectItem>
                        <SelectItem value="2022">SQL Server 2022</SelectItem>
                        <SelectItem value="2025">SQL Server 2025</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Port</Label>
                    <Input 
                      type="number"
                      value={newConfig.port}
                      onChange={e => setNewConfig({...newConfig, port: parseInt(e.target.value)})}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleCreateConfig}>Erstellen</Button>
                  <Button variant="outline" onClick={() => setShowNewConfig(false)}>Abbrechen</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Configs List */}
          <Card>
            <CardHeader>
              <CardTitle>SQL Server Profile</CardTitle>
              <CardDescription>{configs.length} Profile</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Edition</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>Disks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">{c.edition}</Badge>
                      </TableCell>
                      <TableCell>{c.version}</TableCell>
                      <TableCell>{c.port}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.diskConfigs?.map(d => `${d.driveLetter}:\\${d.folder}`).join(", ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
