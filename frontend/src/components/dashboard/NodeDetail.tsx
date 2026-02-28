"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PerformanceTab } from "@/components/performance-tab";
import { 
  Package, Monitor, Cpu, HardDrive, Shield, Globe, 
  Cookie, Users, TrendingUp, AlertCircle, ArrowLeft,
  Activity, Server, Clock, CheckCircle2, XCircle
} from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface NodeDetailProps {
  nodeId: string;
  onBack: () => void;
}

export function NodeDetail({ nodeId, onBack }: NodeDetailProps) {
  const [nodeData, setNodeData] = useState<any>(null);
  const [hardware, setHardware] = useState<any>(null);
  const [software, setSoftware] = useState<any[]>([]);
  const [security, setSecurity] = useState<any>(null);
  const [network, setNetwork] = useState<any>(null);
  const [browser, setBrowser] = useState<any>(null);
  const [hotfixes, setHotfixes] = useState<any>({ hotfixes: [], updateHistory: [] });
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (nodeId) {
      fetchFullNodeData(nodeId);
    }
  }, [nodeId]);

  async function fetchFullNodeData(id: string) {
    setLoading(true);
    try {
      const [node, hw, sw, sec, net, br, hf] = await Promise.all([
        apiClient.get<any>(`/nodes/${id}`),
        apiClient.get<any>(`/inventory/hardware/${id}`),
        apiClient.get<any>(`/inventory/software/${id}`),
        apiClient.get<any>(`/inventory/security/${id}`),
        apiClient.get<any>(`/inventory/network/${id}`),
        apiClient.get<any>(`/inventory/browser/${id}`),
        apiClient.get<any>(`/inventory/hotfixes/${id}`),
      ]);

      if (node) setNodeData(node);
      if (hw) setHardware(hw.data || hw);
      if (sw) setSoftware(sw.data?.installedPrograms || sw.data?.software || sw.software || sw.installedPrograms || sw.data || sw || []);
      if (sec) setSecurity(sec.data || sec);
      if (net) setNetwork(net.data || net);
      if (br) setBrowser(br.data || br);
      if (hf) {
        const resolved = hf.data || hf;
        setHotfixes({
          hotfixes: resolved.hotfixes || [],
          updateHistory: resolved.updateHistory || []
        });
      }
    } catch (e) {
      console.error("Failed to fetch node data:", e);
    } finally {
      setLoading(false);
    }
  }

  function formatRelativeTime(timestamp: string | null) {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMinutes = (now.getTime() - date.getTime()) / 1000 / 60;
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${Math.floor(diffMinutes)}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  }

  function getStatusBadge(lastSeen: string) {
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = (now.getTime() - date.getTime()) / 1000 / 60;
    if (diffMinutes < 5) return <Badge className="bg-green-600 shadow-[0_0_10px_rgba(22,163,74,0.4)]">Online</Badge>;
    if (diffMinutes < 60) return <Badge className="bg-yellow-600 shadow-[0_0_10px_rgba(202,138,4,0.4)]">Away</Badge>;
    return <Badge variant="secondary">Offline</Badge>;
  }

  const InfoRow = ({ label, value, icon: Icon }: { label: string; value: any; icon?: any }) => (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0 group">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-semibold truncate max-w-[60%] tabular-nums" title={String(value)}>{value ?? "-"}</span>
    </div>
  );

  if (loading && !nodeData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <Activity className="h-10 w-10 text-primary animate-pulse" />
          <p className="text-sm font-medium text-muted-foreground">Loading Node Data...</p>
        </div>
      </div>
    );
  }

  if (!nodeData) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header with Glass Effect */}
      <div className="flex items-center justify-between sticky top-0 z-10 py-4 bg-background/80 backdrop-blur-md border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black tracking-tight">{nodeData.hostname}</h2>
              {getStatusBadge(nodeData.last_seen)}
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-widest mt-0.5">
              <Server className="h-3 w-3" /> {nodeData.node_id}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
           <Badge variant="outline" className="bg-primary/5 border-primary/20 text-primary px-3 py-1 font-bold">
             Agent v{nodeData.agent_version}
           </Badge>
        </div>
      </div>

      {/* Modern Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 flex-wrap h-auto gap-1 bg-muted/50 p-1 border">
          <TabsTrigger value="overview" className="gap-2 px-4"><Monitor className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="performance" className="gap-2 px-4"><TrendingUp className="h-4 w-4" /> Live Performance</TabsTrigger>
          <TabsTrigger value="hardware" className="gap-2 px-4"><Cpu className="h-4 w-4" /> Hardware</TabsTrigger>
          <TabsTrigger value="software" className="gap-2 px-4"><Package className="h-4 w-4" /> Software</TabsTrigger>
          <TabsTrigger value="security" className="gap-2 px-4"><Shield className="h-4 w-4" /> Security</TabsTrigger>
          <TabsTrigger value="network" className="gap-2 px-4"><Globe className="h-4 w-4" /> Network</TabsTrigger>
          <TabsTrigger value="browser" className="gap-2 px-4"><Cookie className="h-4 w-4" /> Browser</TabsTrigger>
          <TabsTrigger value="updates" className="gap-2 px-4"><HardDrive className="h-4 w-4" /> Updates</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          {/* Overview Tab */}
          <TabsContent value="overview" className="animate-in fade-in duration-300">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <Card className="shadow-lg border-primary/10 overflow-hidden">
                <div className="h-1 bg-primary" />
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Monitor className="h-4 w-4 text-primary" /> System Identity</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                  <InfoRow label="Operating System" value={`${nodeData.os_name || ''} ${nodeData.os_version || ''}`} icon={Globe} />
                  <InfoRow label="Build Version" value={nodeData.os_build} icon={Activity} />
                  <InfoRow label="Deployment" value={formatRelativeTime(nodeData.first_seen)} icon={Clock} />
                  <InfoRow label="Last Heartbeat" value={formatRelativeTime(nodeData.last_seen)} icon={Activity} />
                </CardContent>
              </Card>

              <Card className="shadow-lg border-green-500/10 overflow-hidden">
                <div className="h-1 bg-green-500" />
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Cpu className="h-4 w-4 text-green-500" /> Hardware Specs</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                  <InfoRow label="Processor" value={hardware?.cpu?.name} icon={Cpu} />
                  <InfoRow label="Total RAM" value={hardware?.ram?.totalGB ? `${hardware.ram.totalGB} GB` : (hardware?.ram?.totalGb ? `${hardware.ram.totalGb.toFixed(1)} GB` : null)} icon={Activity} />
                  <InfoRow label="GPU Units" value={hardware?.gpu?.length || 0} icon={Monitor} />
                </CardContent>
              </Card>

              <Card className={`shadow-lg overflow-hidden ${!nodeData.groups?.length ? "border-yellow-500/30" : "border-blue-500/10"}`}>
                <div className={`h-1 ${!nodeData.groups?.length ? "bg-yellow-500" : "bg-blue-500"}`} />
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-4 w-4 text-blue-500" />
                    Fleet Assignment
                    {!nodeData.groups?.length && (
                      <Badge variant="outline" className="text-yellow-500 border-yellow-500/50 bg-yellow-500/5 ml-auto text-[10px] font-black uppercase">
                        Unassigned
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {nodeData.groups?.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {nodeData.groups.map((g: any) => (
                        <Badge key={g.id} variant="secondary" className="px-3 py-1 font-bold">{g.name}</Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">This node is currently not part of any organizational group.</p>
                      <Button variant="outline" size="sm" className="w-full border-yellow-500/20 hover:bg-yellow-500/5 text-yellow-600">
                        Assign to Group
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Performance Tab */}
          <TabsContent value="performance" className="animate-in fade-in duration-300">
             <Card className="border-primary/10 shadow-xl overflow-hidden bg-gradient-to-br from-card to-primary/5">
                <CardHeader className="border-b bg-background/50">
                   <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Live Endpoint Telemetry</CardTitle>
                   <CardDescription>Real-time performance metrics streamed from the Octofleet Agent</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                   <PerformanceTab nodeId={nodeId} />
                </CardContent>
             </Card>
          </TabsContent>

          {/* Software Tab */}
          <TabsContent value="software" className="animate-in fade-in duration-300">
             <Card className="shadow-lg border-border/50">
               <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/20">
                 <div>
                   <CardTitle className="text-xl">Software Inventory</CardTitle>
                   <CardDescription>Full list of applications detected on this system</CardDescription>
                 </div>
                 <Badge variant="outline" className="bg-background font-black">{software.length} Packages</Badge>
               </CardHeader>
               <CardContent className="p-0">
                 <div className="max-h-[600px] overflow-y-auto">
                   <Table>
                     <TableHeader className="bg-muted/30 sticky top-0 z-10">
                       <TableRow>
                         <TableHead className="font-bold uppercase text-[10px] tracking-widest">Application Name</TableHead>
                         <TableHead className="font-bold uppercase text-[10px] tracking-widest">Version</TableHead>
                         <TableHead className="font-bold uppercase text-[10px] tracking-widest">Publisher</TableHead>
                       </TableRow>
                     </TableHeader>
                     <TableBody>
                       {software.map((sw: any, i: number) => (
                         <TableRow key={i} className="hover:bg-primary/5 transition-colors">
                           <TableCell className="font-bold text-sm">{sw.name}</TableCell>
                           <TableCell><Badge variant="outline" className="font-mono text-[10px] bg-background">{sw.version}</Badge></TableCell>
                           <TableCell className="text-muted-foreground text-xs">{sw.publisher}</TableCell>
                         </TableRow>
                       ))}
                     </TableBody>
                   </Table>
                 </div>
               </CardContent>
             </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="animate-in fade-in duration-300">
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="shadow-lg border-blue-500/10">
                <CardHeader className="pb-4 bg-blue-500/5 border-b"><CardTitle className="text-lg flex items-center gap-2"><Shield className="h-5 w-5 text-blue-500" /> Endpoint Protection</CardTitle></CardHeader>
                <CardContent className="pt-4 space-y-1">
                  <InfoRow label="Windows Defender" value={security?.defender?.antivirusEnabled ? "Protected" : "Vulnerable"} icon={security?.defender?.antivirusEnabled ? CheckCircle2 : XCircle} />
                  <InfoRow label="Real-time Defense" value={security?.defender?.realTimeProtection ? "Enabled" : "Disabled"} icon={Activity} />
                  <InfoRow label="Security Intel" value={security?.defender?.signatureVersion} icon={Package} />
                </CardContent>
              </Card>

              <Card className="shadow-lg border-orange-500/10">
                <CardHeader className="pb-4 bg-orange-500/5 border-b"><CardTitle className="text-lg flex items-center gap-2"><Activity className="h-5 w-5 text-orange-500" /> Perimeter Defense</CardTitle></CardHeader>
                <CardContent className="pt-4 space-y-1">
                   {security?.firewall?.profiles ? (
                    Array.isArray(security.firewall.profiles) 
                      ? security.firewall.profiles.map((p: any, i: number) => (
                          <InfoRow key={i} label={`${p.name} Profile`} value={p.enabled ? "Active" : "Bypassed"} icon={Shield} />
                        ))
                      : Object.entries(security.firewall.profiles).map(([name, data]: [string, any]) => (
                          <InfoRow key={name} label={`${name} Profile`} value={data?.enabled ? "Active" : "Bypassed"} icon={Shield} />
                        ))
                  ) : <p className="text-center py-4 text-muted-foreground italic">No data available</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          
          {/* Placeholder for other tabs to keep it clean */}
          <TabsContent value="hardware" className="animate-in fade-in duration-300">
             <div className="grid gap-4 md:grid-cols-2">
                <Card className="shadow-lg"><CardHeader><CardTitle>CPU Architecture</CardTitle></CardHeader><CardContent className="space-y-1"><InfoRow label="Model" value={hardware?.cpu?.name} /><InfoRow label="Cores" value={hardware?.cpu?.cores} /><InfoRow label="Logical" value={hardware?.cpu?.logicalProcessors} /></CardContent></Card>
                <Card className="shadow-lg"><CardHeader><CardTitle>Memory Configuration</CardTitle></CardHeader><CardContent className="space-y-1"><InfoRow label="Capacity" value={hardware?.ram?.totalGB ? `${hardware.ram.totalGB} GB` : null} /><InfoRow label="Slots" value={hardware?.ram?.modules?.length} /></CardContent></Card>
             </div>
          </TabsContent>
          
          <TabsContent value="network" className="animate-in fade-in duration-300">
             <div className="grid gap-4 md:grid-cols-2">
                {(hardware?.nics?.adapters || network?.adapters)?.map((nic: any, i: number) => (
                   <Card key={i} className="shadow-lg border-primary/5"><CardHeader><CardTitle className="text-md flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /> {nic.name || nic.description}</CardTitle></CardHeader><CardContent className="space-y-1"><InfoRow label="IPv4" value={nic.ipAddresses?.[0] || nic.ip} /><InfoRow label="Status" value={nic.status} /><InfoRow label="MAC" value={nic.macAddress} /></CardContent></Card>
                ))}
             </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
