"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080") + "/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "octofleet-dev-key";

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
  const [maintenanceWindowOnly, setMaintenanceWindowOnly] = useState(false);
  const [rolloutStrategy, setRolloutStrategy] = useState<"immediate" | "staged" | "canary" | "percentage">("immediate");
  const [rolloutConfig, setRolloutConfig] = useState<Record<string, any>>({});
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
    if (nodeRes.ok) {
      const data = await nodeRes.json();
      setNodes(data.nodes || data || []);
    }
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
          maintenanceWindowOnly,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // Configure rollout strategy if not immediate
        if (rolloutStrategy !== "immediate" && data.id) {
          await fetch(`${API_BASE}/deployments/${data.id}/rollout`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
            body: JSON.stringify({
              strategy: rolloutStrategy,
              config: rolloutConfig,
            }),
          });
        }
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
    setMaintenanceWindowOnly(false);
    setRolloutStrategy("immediate");
    setRolloutConfig({});
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

          {/* Maintenance Window Only */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="maintenanceWindowOnly"
              checked={maintenanceWindowOnly}
              onChange={(e) => setMaintenanceWindowOnly(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="maintenanceWindowOnly" className="text-sm font-normal">
              🕐 Nur in Wartungsfenstern ausführen
            </Label>
          </div>

          {/* E9: Rollout Strategy */}
          <div className="space-y-2">
            <Label>Rollout-Strategie</Label>
            <Select value={rolloutStrategy} onValueChange={(v) => { setRolloutStrategy(v as any); setRolloutConfig({}); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">⚡ Sofort (alle gleichzeitig)</SelectItem>
                <SelectItem value="staged">📊 Gestaffelt (in Wellen)</SelectItem>
                <SelectItem value="canary">🐤 Canary (erst testen, dann alle)</SelectItem>
                <SelectItem value="percentage">📈 Prozentual (schrittweise erhöhen)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rollout Config based on strategy */}
          {rolloutStrategy === "staged" && (
            <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-blue-500/30">
              <div className="space-y-2">
                <Label>Geräte pro Welle</Label>
                <Input
                  type="number"
                  value={rolloutConfig.wave_size || 10}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, wave_size: parseInt(e.target.value) })}
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <Label>Wartezeit (Min.)</Label>
                <Input
                  type="number"
                  value={rolloutConfig.wave_delay_minutes || 60}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, wave_delay_minutes: parseInt(e.target.value) })}
                  min={1}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Min. Erfolgsrate (%)</Label>
                <Input
                  type="number"
                  value={rolloutConfig.success_threshold_percent || 90}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, success_threshold_percent: parseInt(e.target.value) })}
                  min={0}
                  max={100}
                />
              </div>
            </div>
          )}

          {rolloutStrategy === "canary" && (
            <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-yellow-500/30">
              <div className="space-y-2">
                <Label>Canary-Geräte</Label>
                <Input
                  type="number"
                  value={rolloutConfig.canary_count || 1}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, canary_count: parseInt(e.target.value) })}
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <Label>Beobachtungszeit (Std.)</Label>
                <Input
                  type="number"
                  value={rolloutConfig.canary_duration_hours || 24}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, canary_duration_hours: parseInt(e.target.value) })}
                  min={1}
                />
              </div>
              <div className="col-span-2 flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="autoProceed"
                  checked={rolloutConfig.auto_proceed || false}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, auto_proceed: e.target.checked })}
                  className="rounded"
                />
                <Label htmlFor="autoProceed" className="text-sm font-normal">
                  Automatisch fortfahren wenn Canary erfolgreich
                </Label>
              </div>
            </div>
          )}

          {rolloutStrategy === "percentage" && (
            <div className="grid grid-cols-3 gap-4 pl-4 border-l-2 border-green-500/30">
              <div className="space-y-2">
                <Label>Start (%)</Label>
                <Input
                  type="number"
                  value={rolloutConfig.initial_percent || 10}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, initial_percent: parseInt(e.target.value) })}
                  min={1}
                  max={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Erhöhung (%)</Label>
                <Input
                  type="number"
                  value={rolloutConfig.increment_percent || 20}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, increment_percent: parseInt(e.target.value) })}
                  min={1}
                  max={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Wartezeit (Std.)</Label>
                <Input
                  type="number"
                  value={rolloutConfig.step_delay_hours || 4}
                  onChange={(e) => setRolloutConfig({ ...rolloutConfig, step_delay_hours: parseInt(e.target.value) })}
                  min={1}
                />
              </div>
            </div>
          )}
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
