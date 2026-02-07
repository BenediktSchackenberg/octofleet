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
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";

const API_BASE = 'http://192.168.0.5:8080/api/v1';
const API_KEY = 'openclaw-inventory-dev-key';

interface Node {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string | null;
  last_seen: string;
}

interface AddDevicesDialogProps {
  groupId: string;
  existingMemberIds: string[];
}

export function AddDevicesDialog({ groupId, existingMemberIds }: AddDevicesDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const router = useRouter();

  // Fetch all nodes when dialog opens
  useEffect(() => {
    if (open) {
      fetchNodes();
    }
  }, [open]);

  const fetchNodes = async () => {
    try {
      const res = await fetch(`${API_BASE}/nodes`, {
        headers: { 'X-API-Key': API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        // Filter out nodes that are already members
        const available = (data.nodes || []).filter(
          (n: Node) => !existingMemberIds.includes(n.id)
        );
        setNodes(available);
      }
    } catch (err) {
      console.error('Failed to fetch nodes:', err);
    }
  };

  const toggleNode = (nodeId: string) => {
    setSelectedIds(prev => 
      prev.includes(nodeId) 
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    );
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
        body: JSON.stringify({
          nodeIds: selectedIds,
          assigned_by: 'admin',
        }),
      });

      if (res.ok) {
        setOpen(false);
        setSelectedIds([]);
        router.refresh();
      } else {
        const data = await res.json();
        alert(`Fehler: ${data.detail || 'Unbekannter Fehler'}`);
      }
    } catch (err) {
      alert(`Netzwerkfehler: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (lastSeen: string) => {
    const diffMinutes = (Date.now() - new Date(lastSeen).getTime()) / 1000 / 60;
    if (diffMinutes < 5) return "bg-green-600";
    if (diffMinutes < 60) return "bg-yellow-600";
    return "bg-gray-400";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">+ Geräte hinzufügen</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Geräte zur Gruppe hinzufügen</DialogTitle>
          <DialogDescription>
            Wähle Geräte aus, die dieser Gruppe zugewiesen werden sollen.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 max-h-[400px] overflow-y-auto">
          {nodes.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              Keine verfügbaren Geräte gefunden
            </p>
          ) : (
            <div className="space-y-2">
              {nodes.map((node) => (
                <div
                  key={node.id}
                  onClick={() => toggleNode(node.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedIds.includes(node.id)
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(node.last_seen)}`} />
                      <div>
                        <p className="font-medium">{node.hostname}</p>
                        <p className="text-xs text-muted-foreground">{node.node_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {node.os_name && (
                        <Badge variant="outline" className="text-xs">
                          {node.os_name.includes('Server') ? '🖥️ Server' : '💻 Client'}
                        </Badge>
                      )}
                      {selectedIds.includes(node.id) && (
                        <Badge className="bg-primary">✓</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Abbrechen
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || selectedIds.length === 0}
          >
            {loading ? "Füge hinzu..." : `${selectedIds.length} Gerät(e) hinzufügen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
