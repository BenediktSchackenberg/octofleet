"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Monitor, Server, Laptop, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface NodeData {
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  status: "online" | "away" | "offline";
  last_seen: string | null;
}

interface TreeData {
  groups: Record<string, {
    id: string;
    os_families: Record<string, Record<string, NodeData[]>>;
  }>;
  unassigned: Record<string, Record<string, NodeData[]>>;
}

interface NodeTreeProps {
  onNodeSelect: (nodeId: string) => void;
  selectedNodeId?: string;
}

export function NodeTree({ onNodeSelect, selectedNodeId }: NodeTreeProps) {
  const [tree, setTree] = useState<TreeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["groups", "unassigned"]));

  useEffect(() => {
    fetchTree();
  }, []);

  async function fetchTree() {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
      const res = await fetch(`${apiUrl}/api/v1/nodes/tree`, {
        headers: { "X-API-Key": process.env.NEXT_PUBLIC_API_KEY || "octofleet-dev-key" }
      });
      if (res.ok) {
        const data = await res.json();
        setTree(data);
      }
    } catch (e) {
      console.error("Failed to fetch tree:", e);
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function getStatusColor(status: string) {
    switch (status) {
      case "online": return "text-green-500";
      case "away": return "text-yellow-500";
      default: return "text-gray-400";
    }
  }

  function countNodes(obj: Record<string, Record<string, NodeData[]>>): number {
    let count = 0;
    for (const os of Object.values(obj)) {
      for (const nodes of Object.values(os)) {
        count += nodes.length;
      }
    }
    return count;
  }

  function countNodesInVersion(nodes: NodeData[]): { online: number; total: number } {
    return {
      online: nodes.filter(n => n.status === "online").length,
      total: nodes.length
    };
  }

  if (loading) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        Failed to load
      </div>
    );
  }

  return (
    <div className="text-sm select-none">
      {/* Groups Section */}
      <TreeSection
        title="Gruppen"
        icon="📁"
        expanded={expanded.has("groups")}
        onToggle={() => toggleExpand("groups")}
        count={Object.keys(tree.groups).length}
      >
        {Object.entries(tree.groups).map(([groupName, group]) => (
          <TreeSection
            key={groupName}
            title={groupName}
            icon="📂"
            expanded={expanded.has(`group-${groupName}`)}
            onToggle={() => toggleExpand(`group-${groupName}`)}
            count={countNodes(group.os_families)}
            indent={1}
          >
            {Object.entries(group.os_families).map(([osFamily, versions]) => (
              <TreeSection
                key={`${groupName}-${osFamily}`}
                title={osFamily}
                icon={osFamily === "Windows" ? "🪟" : osFamily === "Linux" ? "🐧" : "💻"}
                expanded={expanded.has(`group-${groupName}-${osFamily}`)}
                onToggle={() => toggleExpand(`group-${groupName}-${osFamily}`)}
                count={Object.values(versions).flat().length}
                indent={2}
              >
                {Object.entries(versions).map(([version, nodes]) => (
                  <TreeSection
                    key={`${groupName}-${osFamily}-${version}`}
                    title={version}
                    expanded={expanded.has(`group-${groupName}-${osFamily}-${version}`)}
                    onToggle={() => toggleExpand(`group-${groupName}-${osFamily}-${version}`)}
                    count={nodes.length}
                    indent={3}
                  >
                    {nodes.map(node => (
                      <NodeItem
                        key={node.node_id}
                        node={node}
                        selected={selectedNodeId === node.node_id}
                        onClick={() => onNodeSelect(node.node_id)}
                        indent={4}
                      />
                    ))}
                  </TreeSection>
                ))}
              </TreeSection>
            ))}
          </TreeSection>
        ))}
      </TreeSection>

      {/* Unassigned Section */}
      {countNodes(tree.unassigned) > 0 && (
        <TreeSection
          title="Nicht zugeordnet"
          icon="⚠️"
          expanded={expanded.has("unassigned")}
          onToggle={() => toggleExpand("unassigned")}
          count={countNodes(tree.unassigned)}
          className="mt-2 border-t border-yellow-500/30 pt-2"
          warning={true}
        >
        {Object.entries(tree.unassigned).map(([osFamily, versions]) => (
          <TreeSection
            key={`unassigned-${osFamily}`}
            title={osFamily}
            icon={osFamily === "Windows" ? "🪟" : osFamily === "Linux" ? "🐧" : "💻"}
            expanded={expanded.has(`unassigned-${osFamily}`)}
            onToggle={() => toggleExpand(`unassigned-${osFamily}`)}
            count={Object.values(versions).flat().length}
            indent={1}
          >
            {Object.entries(versions).map(([version, nodes]) => (
              <TreeSection
                key={`unassigned-${osFamily}-${version}`}
                title={version}
                expanded={expanded.has(`unassigned-${osFamily}-${version}`)}
                onToggle={() => toggleExpand(`unassigned-${osFamily}-${version}`)}
                count={nodes.length}
                indent={2}
              >
                {nodes.map(node => (
                  <NodeItem
                    key={node.node_id}
                    node={node}
                    selected={selectedNodeId === node.node_id}
                    onClick={() => onNodeSelect(node.node_id)}
                    indent={3}
                  />
                ))}
              </TreeSection>
            ))}
          </TreeSection>
        ))}
      </TreeSection>
      )}
    </div>
  );
}

interface TreeSectionProps {
  title: string;
  icon?: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
  indent?: number;
  className?: string;
  warning?: boolean;
  children?: React.ReactNode;
}

function TreeSection({ title, icon, expanded, onToggle, count, indent = 0, className, warning, children }: TreeSectionProps) {
  return (
    <div className={className}>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-accent rounded-sm",
          "transition-colors",
          warning && "text-yellow-600 dark:text-yellow-500"
        )}
        style={{ paddingLeft: `${indent * 12 + 8}px` }}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        {icon && <span className="text-xs">{icon}</span>}
        <span className={cn("truncate", warning && "font-medium")}>{title}</span>
        {count !== undefined && (
          <span className={cn("text-xs ml-auto", warning ? "text-yellow-600 dark:text-yellow-500 font-semibold" : "text-muted-foreground")}>({count})</span>
        )}
      </div>
      {expanded && children}
    </div>
  );
}

interface NodeItemProps {
  node: NodeData;
  selected: boolean;
  onClick: () => void;
  indent: number;
}

function NodeItem({ node, selected, onClick, indent }: NodeItemProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 cursor-pointer rounded-sm",
        "hover:bg-accent transition-colors",
        selected && "bg-accent border-l-2 border-primary"
      )}
      style={{ paddingLeft: `${indent * 12 + 8}px` }}
      onClick={(e) => {
        e.stopPropagation();  // Prevent parent toggle
        onClick();
      }}
    >
      <Circle
        className={cn(
          "h-2 w-2 shrink-0 fill-current",
          node.status === "online" && "text-green-500",
          node.status === "away" && "text-yellow-500",
          node.status === "offline" && "text-gray-400"
        )}
      />
      <Monitor className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="truncate font-medium">{node.hostname}</span>
    </div>
  );
}
