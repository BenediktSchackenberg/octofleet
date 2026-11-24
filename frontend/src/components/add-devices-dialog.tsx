"use client";
import { apiClient } from "@/lib/api-client";

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
import { useI18n } from "@/lib/i18n-context";

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
  onMembersAdded?: () => void;
}

export function AddDevicesDialog({ groupId, existingMemberIds, onMembersAdded }: AddDevicesDialogProps) {
  const { t } = useI18n();
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
      const data = await apiClient.get<{ nodes: Node[] }>(`/nodes`, { showErrorToast: false });
      if (data) {
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
      const data = await apiClient.post(`/groups/${groupId}/members`, {
          nodeIds: selectedIds,
          assigned_by: 'admin',
        }, { showErrorToast: false });

      if (data) {
        setOpen(false);
        setSelectedIds([]);
        onMembersAdded?.();
        router.refresh();
      } else {
        alert(t("addDevices.failed", { error: (data as any)?.detail || t("addDevices.unknownError") }));
      }
    } catch (err) {
      alert(t("addDevices.networkError", { error: String(err) }));
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (lastSeen: string) => {
    const diffMinutes = (Date.now() - new Date(lastSeen).getTime()) / 1000 / 60;
    if (diffMinutes < 5) return "bg-green-600";
    if (diffMinutes < 60) return "bg-yellow-600";
    return "bg-zinc-500";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">+ {t("addDevices.button")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("addDevices.title")}</DialogTitle>
          <DialogDescription>
            {t("addDevices.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 max-h-[400px] overflow-y-auto">
          {nodes.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {t("addDevices.none")}
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
                          {node.os_name.includes('Server') ? `🖥️ ${t("addDevices.server")}` : `💻 ${t("addDevices.client")}`}
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
            {t("common.cancel")}
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || selectedIds.length === 0}
          >
            {loading ? t("addDevices.adding") : t(selectedIds.length === 1 ? "addDevices.submitOne" : "addDevices.submit", { count: selectedIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
