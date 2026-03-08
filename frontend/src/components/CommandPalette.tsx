"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { 
  Search, 
  Monitor, 
  Settings, 
  Server, 
  Terminal, 
  Shield, 
  Package, 
  Database,
  LayoutDashboard,
  Plus,
  ArrowRight,
  Command as CommandIcon,
  Circle
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { API_URL } from '@/lib/api-config';
import { useRouter } from "next/navigation";
import { getAuthHeader } from "@/lib/auth-context";

interface SearchResult {
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  status: "online" | "away" | "offline";
  last_seen: string | null;
}

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
  category: "Navigation" | "Actions" | "Nodes";
  shortcut?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [nodes, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Define static commands
  const staticCommands: CommandItem[] = useMemo(() => [
    {
      id: "nav-dashboard",
      title: "Go to Dashboard",
      subtitle: "Overview of your entire fleet",
      icon: <LayoutDashboard className="h-4 w-4" />,
      action: () => router.push("/"),
      category: "Navigation",
      shortcut: "G D"
    },
    {
      id: "nav-nodes",
      title: "Go to Nodes",
      subtitle: "List and manage all registered devices",
      icon: <Server className="h-4 w-4" />,
      action: () => router.push("/nodes"),
      category: "Navigation"
    },
    {
      id: "nav-provisioning",
      title: "Go to Provisioning",
      subtitle: "OS deployment and automated setups",
      icon: <Terminal className="h-4 w-4" />,
      action: () => router.push("/provisioning"),
      category: "Navigation"
    },
    {
      id: "nav-mssql",
      title: "Go to SQL Manager",
      subtitle: "Fleet-wide SQL Server management",
      icon: <Database className="h-4 w-4" />,
      action: () => router.push("/sql"),
      category: "Navigation"
    },
    {
      id: "nav-security",
      title: "Go to Security Center",
      subtitle: "Vulnerabilities and compliance",
      icon: <Shield className="h-4 w-4" />,
      action: () => router.push("/security"),
      category: "Navigation"
    },
    {
      id: "action-add-node",
      title: "Add New Node",
      subtitle: "Generate onboarding script or token",
      icon: <Plus className="h-4 w-4" />,
      action: () => router.push("/settings?tab=onboarding"),
      category: "Actions"
    },
    {
      id: "nav-settings",
      title: "Settings",
      subtitle: "System configuration and users",
      icon: <Settings className="h-4 w-4" />,
      action: () => router.push("/settings"),
      category: "Navigation"
    }
  ], [router]);

  // Keyboard shortcut: Ctrl+K to toggle
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    function handleCustomOpen() {
      setOpen(prev => !prev);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("openclaw:command-palette", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("openclaw:command-palette", handleCustomOpen);
    };
  }, []);

  // Search logic
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetch(
          `${API_URL}/api/v1/nodes/search?q=${encodeURIComponent(query)}`,
          { headers: getAuthHeader() }
        );
        if (data) {
          setResults(data.nodes || []);
        }
      } catch (e) {
        console.error("Palette search failed:", e);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // Filtered items
  const filteredStaticItems = useMemo(() => {
    if (!query) return staticCommands;
    return staticCommands.filter(item => 
      item.title.toLowerCase().includes(query.toLowerCase()) || 
      item.category.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, staticCommands]);

  const allItems = useMemo(() => {
    const nodeItems: CommandItem[] = nodes.map(node => ({
      id: `node-${node.node_id}`,
      title: node.hostname,
      subtitle: `${node.os_name} ${node.os_version}`,
      icon: (
        <div className="relative">
          <Monitor className="h-4 w-4" />
          <Circle 
            className={cn(
              "absolute -top-1 -right-1 h-2 w-2 fill-current",
              node.status === "online" ? "text-green-500" : 
              node.status === "away" ? "text-yellow-500" : "text-zinc-500"
            )} 
          />
        </div>
      ),
      action: () => router.push(`/nodes/${node.node_id}`),
      category: "Nodes"
    }));

    return [...filteredStaticItems, ...nodeItems];
  }, [filteredStaticItems, nodes, router]);

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = allItems[selectedIndex];
      if (selected) {
        selected.action();
        setOpen(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 gap-0 sm:max-w-[600px] border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl">
        <div className="flex items-center border-b border-zinc-800 px-4 py-3 bg-zinc-900/50">
          <Search className="h-5 w-5 text-zinc-400 mr-3 shrink-0" />
          <input
            autoFocus
            placeholder="Type a command or search nodes..."
            className="flex-1 bg-transparent border-none outline-none text-zinc-100 placeholder:text-zinc-500 text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex items-center gap-1 shrink-0 ml-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-[10px] text-zinc-400 font-medium">ESC</kbd>
          </div>
        </div>

        <div className="max-h-[450px] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-zinc-800">
          {allItems.length === 0 && !loading && (
            <div className="py-12 text-center text-zinc-500">
              No results found for "{query}"
            </div>
          )}

          {loading && allItems.length === 0 && (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 w-full bg-zinc-900/50 rounded-md animate-pulse" />
              ))}
            </div>
          )}

          {/* Grouped results */}
          {["Navigation", "Actions", "Nodes"].map(category => {
            const categoryItems = allItems.filter(i => i.category === category);
            if (categoryItems.length === 0) return null;

            return (
              <div key={category} className="mb-2">
                <div className="px-3 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  {category}
                </div>
                {categoryItems.map((item) => {
                  // Find global index for selection
                  const globalIndex = allItems.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "group flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-all",
                        isSelected ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      onClick={() => {
                        item.action();
                        setOpen(false);
                      }}
                    >
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded border",
                        isSelected ? "border-zinc-600 bg-zinc-700" : "border-zinc-800 bg-zinc-900 group-hover:border-zinc-700"
                      )}>
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-xs text-zinc-500 truncate group-hover:text-zinc-400">{item.subtitle}</div>
                        )}
                      </div>
                      {item.shortcut && !query && (
                        <div className="hidden sm:flex items-center gap-1 ml-auto">
                          {item.shortcut.split(" ").map(s => (
                            <kbd key={s} className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/50 text-[10px] text-zinc-500 font-medium">{s}</kbd>
                          ))}
                        </div>
                      )}
                      {isSelected && (
                        <ArrowRight className="h-4 w-4 ml-auto text-zinc-500 animate-in slide-in-from-left-1" />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 bg-zinc-900/30 text-[10px] text-zinc-500">
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">↵</kbd> to select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">↑↓</kbd> to navigate
            </span>
          </div>
          <div className="flex items-center gap-1 italic">
            Octofleet Search
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
