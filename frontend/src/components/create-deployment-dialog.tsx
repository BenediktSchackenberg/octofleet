"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

interface PackageVersion {
  id: string;
  package_name: string;
  display_name: string;
  version: string;
}

interface Group {
  id: string;
  name: string;
}

interface Node {
  id: string;
  node_id: string;
  hostname: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateDeploymentDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [packageVersionId, setPackageVersionId] = useState("");
  const [targetType, setTargetType] = useState<"all" | "group" | "node">("all");
  const [targetId, setTargetId] = useState("");
  const [mode, setMode] = useState<"required" | "available" | "uninstall">("required");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [packageVersions, setPackageVersions] = useState<PackageVersion[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  async function fetchData() {
    const headers = { "X-API-Key": API_KEY };
    const [pvRes, groupRes, nodeRes] = await Promise.all([
      fetch(`${API_BASE}/package-versions`, { headers }),
      fetch(`${API_BASE}/groups`, { headers }),
      fetch(`${API_BASE}/nodes`, { headers }),
    ]);
    if (pvRes.ok) setPackageVersions(await pvRes.json());
    if (groupRes.ok) setGroups(await groupRes.json());
    if (nodeRes.ok) setNodes(await nodeRes.json());
  }

  async function handleSubmit() {
    if (!name || !packageVersionId) return;
    if (targetType !== "all" && !targetId) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/deployments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        body: JSON.stringify({
          name,
          description: description || null,
          packageVersionId,
          targetType,
          targetId: targetType === "all" ? null : targetId,
          mode,
          scheduledStart: scheduledStart || null,
          scheduledEnd: scheduledEnd || null,
        }),
      });
      if (res.ok) {
        onCreated();
        onOpenChange(false);
        resetForm();
      }
    } catch (e) {
      console.error("Failed to create deployment:", e);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName("");
    setDescription("");
    setPackageVersionId("");
    setTargetType("all");
    setTargetId("");
    setMode("required");
    setScheduledStart("");
    setScheduledEnd("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Neues Deployment erstellen</DialogTitle>
          <DialogDescription>Software an Nodes oder Gruppen verteilen</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Chrome Update Q1"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beschreibung</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="package">Paket *</Label>
            <Select value={packageVersionId} onValueChange={setPackageVersionId}>
              <SelectTrigger>
                <SelectValue placeholder="Paket auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {packageVersions.map((pv) => (
                  <SelectItem key={pv.id} value={pv.id}>
                    {pv.display_name || pv.package_name} v{pv.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Ziel</Label>
            <Select value={targetType} onValueChange={(v) => { setTargetType(v as any); setTargetId(""); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Nodes</SelectItem>
                <SelectItem value="group">Gruppe</SelectItem>
                <SelectItem value="node">Einzelner Node</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {targetType === "group" && (
            <div className="space-y-2">
              <Label>Gruppe</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Gruppe auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {targetType === "node" && (
            <div className="space-y-2">
              <Label>Node</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Node auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.hostname || n.node_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Modus</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="required">Pflicht (automatische Installation)</SelectItem>
                <SelectItem value="available">Verfügbar (Self-Service)</SelectItem>
                <SelectItem value="uninstall">Deinstallation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* E5-05: Scheduling (optional) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduledStart">Startzeit (optional)</Label>
              <Input
                id="scheduledStart"
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduledEnd">Endzeit (optional)</Label>
              <Input
                id="scheduledEnd"
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !name || !packageVersionId}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Deployment erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
