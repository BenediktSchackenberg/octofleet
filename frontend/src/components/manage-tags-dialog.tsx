"use client";

import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Tag, Plus, X, Check } from "lucide-react";

const API_BASE = "http://192.168.0.5:8080/api/v1";
const API_KEY = "openclaw-inventory-dev-key";

interface TagInfo {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  nodeId: string;
  nodeTags: TagInfo[];
  onTagsChanged: () => void;
}

export function ManageTagsDialog({ nodeId, nodeTags, onTagsChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");
  const [creating, setCreating] = useState(false);

  const currentTagIds = new Set(nodeTags.map((t) => t.id));

  useEffect(() => {
    if (open) {
      fetchAllTags();
    }
  }, [open]);

  async function fetchAllTags() {
    try {
      const res = await fetch(`${API_BASE}/tags`, {
        headers: { "X-API-Key": API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        setAllTags(data.tags || []);
      }
    } catch (e) {
      console.error("Failed to fetch tags:", e);
    }
  }

  async function handleAddTag(tagId: string) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/devices/${nodeId}/tags`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ tagIds: [tagId] }),
      });
      if (res.ok) {
        onTagsChanged();
      }
    } catch (e) {
      console.error("Failed to add tag:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveTag(tagId: string) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/devices/${nodeId}/tags`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ tagIds: [tagId] }),
      });
      if (res.ok) {
        onTagsChanged();
      }
    } catch (e) {
      console.error("Failed to remove tag:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/tags`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({
          name: newTagName.trim(),
          color: newTagColor,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // Add the new tag to the node immediately
        await handleAddTag(data.tag.id);
        setNewTagName("");
        await fetchAllTags();
      }
    } catch (e) {
      console.error("Failed to create tag:", e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Tag className="h-4 w-4" /> Tags verwalten
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Tags verwalten
          </DialogTitle>
          <DialogDescription>
            Tags helfen bei der Kategorisierung und können in dynamischen Gruppen verwendet werden.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current tags */}
          <div>
            <h4 className="text-sm font-medium mb-2">Aktuelle Tags</h4>
            {nodeTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {nodeTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant="secondary"
                    className="gap-1 pr-1"
                    style={tag.color ? { backgroundColor: `${tag.color}20`, borderColor: tag.color, color: tag.color } : {}}
                  >
                    {tag.name}
                    <button
                      onClick={() => handleRemoveTag(tag.id)}
                      disabled={loading}
                      className="ml-1 hover:bg-destructive/20 rounded p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Keine Tags zugewiesen</p>
            )}
          </div>

          {/* Available tags */}
          <div>
            <h4 className="text-sm font-medium mb-2">Verfügbare Tags</h4>
            {allTags.filter((t) => !currentTagIds.has(t.id)).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {allTags
                  .filter((t) => !currentTagIds.has(t.id))
                  .map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="gap-1 cursor-pointer hover:bg-accent"
                      style={tag.color ? { borderColor: tag.color, color: tag.color } : {}}
                      onClick={() => handleAddTag(tag.id)}
                    >
                      <Plus className="h-3 w-3" />
                      {tag.name}
                    </Badge>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {allTags.length === 0 ? "Noch keine Tags erstellt" : "Alle Tags zugewiesen"}
              </p>
            )}
          </div>

          {/* Create new tag */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-2">Neuen Tag erstellen</h4>
            <div className="flex gap-2">
              <Input
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                type="color"
                className="w-12 h-10 p-1 cursor-pointer"
              />
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag-Name..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
              />
              <Button
                onClick={handleCreateTag}
                disabled={creating || !newTagName.trim()}
                size="icon"
              >
                {creating ? "..." : <Check className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fertig
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
