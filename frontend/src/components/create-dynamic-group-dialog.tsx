"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Sparkles, Eye } from "lucide-react";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

interface Condition {
  id: string;
  field: string;
  op: string;
  value: string;
}

interface PreviewResult {
  matchingCount: number;
  totalNodes: number;
  matching: Array<{ id: string; hostname: string; os_name: string }>;
}

const FIELDS = [
  { value: "os_name", label: "Betriebssystem" },
  { value: "os_version", label: "OS Version" },
  { value: "os_build", label: "OS Build" },
  { value: "hostname", label: "Hostname" },
  { value: "agent_version", label: "Agent Version" },
  { value: "domain", label: "Domain" },
  { value: "is_domain_joined", label: "Domain-Mitglied" },
  { value: "tags", label: "🏷️ Hat Tag" },
];

const OPERATORS = [
  { value: "equals", label: "ist gleich" },
  { value: "not_equals", label: "ist nicht gleich" },
  { value: "contains", label: "enthält" },
  { value: "not_contains", label: "enthält nicht" },
  { value: "startswith", label: "beginnt mit" },
  { value: "endswith", label: "endet mit" },
  { value: "gte", label: "≥ (größer/gleich)" },
  { value: "lte", label: "≤ (kleiner/gleich)" },
  { value: "regex", label: "Regex" },
  { value: "has_tag", label: "hat Tag (exakt)" },
];

export function CreateDynamicGroupDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [logicOperator, setLogicOperator] = useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = useState<Condition[]>([
    { id: crypto.randomUUID(), field: "os_name", op: "contains", value: "Windows" },
  ]);

  // Preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const addCondition = () => {
    setConditions([
      ...conditions,
      { id: crypto.randomUUID(), field: "os_name", op: "equals", value: "" },
    ]);
  };

  const removeCondition = (id: string) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((c) => c.id !== id));
    }
  };

  const updateCondition = (id: string, field: keyof Condition, value: string) => {
    setConditions(
      conditions.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const buildRule = () => ({
    operator: logicOperator,
    conditions: conditions.map(({ field, op, value }) => ({ field, op, value })),
  });

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch(`${API_BASE}/groups/preview-rule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ rule: buildRule() }),
      });

      if (res.ok) {
        const data = await res.json();
        setPreview(data);
      } else {
        alert("Fehler bei der Vorschau");
      }
    } catch (err) {
      alert(`Netzwerkfehler: ${err}`);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || conditions.some((c) => !c.value.trim())) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          color: color,
          isDynamic: true,
          dynamicRule: buildRule(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Immediately evaluate the group to populate members
        await fetch(`${API_BASE}/groups/${data.group.id}/evaluate`, {
          method: "POST",
          headers: { "X-API-Key": API_KEY },
        });

        setOpen(false);
        resetForm();
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Fehler: ${data.detail || "Unbekannter Fehler"}`);
      }
    } catch (err) {
      alert(`Netzwerkfehler: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setColor("#8b5cf6");
    setLogicOperator("AND");
    setConditions([
      { id: crypto.randomUUID(), field: "os_name", op: "contains", value: "Windows" },
    ]);
    setPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Sparkles className="h-4 w-4" /> Dynamische Gruppe
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              Dynamische Gruppe erstellen
            </DialogTitle>
            <DialogDescription>
              Geräte werden automatisch basierend auf Regeln hinzugefügt/entfernt.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Windows 11 Workstations"
                required
              />
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional..."
                rows={2}
              />
            </div>

            {/* Color */}
            <div className="grid gap-2">
              <Label htmlFor="color">Farbe</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-12 h-10 p-1 cursor-pointer"
                />
                <span className="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>

            {/* Rules Section */}
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label>Regeln</Label>
                <Select
                  value={logicOperator}
                  onValueChange={(v) => setLogicOperator(v as "AND" | "OR")}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AND">Alle (UND)</SelectItem>
                    <SelectItem value="OR">Eine (ODER)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                {conditions.map((cond, idx) => (
                  <div key={cond.id} className="flex gap-2 items-center">
                    {idx > 0 && (
                      <Badge variant="outline" className="shrink-0">
                        {logicOperator}
                      </Badge>
                    )}
                    <Select
                      value={cond.field}
                      onValueChange={(v) => updateCondition(cond.id, "field", v)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELDS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={cond.op}
                      onValueChange={(v) => updateCondition(cond.id, "op", v)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={cond.value}
                      onChange={(e) => updateCondition(cond.id, "value", e.target.value)}
                      placeholder="Wert..."
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCondition(cond.id)}
                      disabled={conditions.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCondition}
                  className="mt-2 gap-1"
                >
                  <Plus className="h-4 w-4" /> Bedingung hinzufügen
                </Button>
              </div>
            </div>

            {/* Preview Button */}
            <Button
              type="button"
              variant="secondary"
              onClick={handlePreview}
              disabled={previewing || conditions.some((c) => !c.value.trim())}
              className="gap-2"
            >
              <Eye className="h-4 w-4" />
              {previewing ? "Prüfe..." : "Vorschau anzeigen"}
            </Button>

            {/* Preview Results */}
            {preview && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={preview.matchingCount > 0 ? "default" : "secondary"}>
                    {preview.matchingCount} von {preview.totalNodes} Geräten
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    würden dieser Gruppe beitreten
                  </span>
                </div>
                {preview.matching.length > 0 && (
                  <div className="space-y-1">
                    {preview.matching.slice(0, 5).map((node) => (
                      <div
                        key={node.id}
                        className="text-sm flex items-center gap-2"
                      >
                        <span className="text-green-500">✓</span>
                        <span className="font-medium">{node.hostname}</span>
                        <span className="text-muted-foreground">
                          {node.os_name}
                        </span>
                      </div>
                    ))}
                    {preview.matching.length > 5 && (
                      <p className="text-xs text-muted-foreground">
                        ... und {preview.matching.length - 5} weitere
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              disabled={
                loading || !name.trim() || conditions.some((c) => !c.value.trim())
              }
              className="gap-1"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? "Erstelle..." : "Gruppe erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
