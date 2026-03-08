"use client";
import { apiClient } from "@/lib/api-client";

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
import { useRouter } from "next/navigation";



export function CreateTagDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#22c55e");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const data = await apiClient.post(`/tags`, {
          name: name.trim(),
          color: color,
        }, { showErrorToast: false });

      if (data) {
        setOpen(false);
        setName("");
        setColor("#22c55e");
        router.refresh();
      } else {
        alert(`Fehler: ${data.detail || 'Unbekannter Fehler'}`);
      }
    } catch (err) {
      alert(`Netzwerkfehler: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">+ Neuer Tag</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[350px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Neuen Tag erstellen</DialogTitle>
            <DialogDescription>
              Tags helfen bei der freien Kategorisierung von Geräten.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tag-name">Name *</Label>
              <Input
                id="tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. High-Performance"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tag-color">Farbe</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="tag-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-16 h-10 p-1 cursor-pointer"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#22c55e"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Erstelle..." : "Erstellen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
