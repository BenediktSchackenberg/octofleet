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
  Circle,
  FolderTree,
  Bug,
  Bell,
  FileText,
  Zap,
  BarChart3,
  Clock,
  Star,
  HelpCircle
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { API_URL } from '@/lib/api-config';
import { useRouter } from "next/navigation";
import { getAuthHeader } from "@/lib/auth-context";
import { useRecentlyOpened, RecentItem } from "@/hooks/useRecentlyOpened";
import { useFavorites } from "@/hooks/useFavorites";

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
  category: string;
  shortcut?: string;
}

type PaletteMode = "jump" | "action" | "knowledge";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [nodes, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const { recent } = useRecentlyOpened();
  const { favorites } = useFavorites();

  // Determine mode from prefix
  const mode: PaletteMode = useMemo(() => {
    if (query.startsWith(">")) return "action";
    if (query.startsWith("?")) return "knowledge";
    return "jump";
  }, [query]);

  const effectiveQuery = useMemo(() => {
    if (mode === "action" || mode === "knowledge") return query.slice(1).trim();
    return query;
  }, [query, mode]);

  // Navigation commands (jump mode)
  const navigationCommands: CommandItem[] = useMemo(() => [
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
      id: "nav-groups",
      title: "Go to Groups",
      subtitle: "Manage node groups and assignments",
      icon: <FolderTree className="h-4 w-4" />,
      action: () => router.push("/groups"),
      category: "Navigation"
    },
    {
      id: "nav-packages",
      title: "Go to Packages",
      subtitle: "Software packages and deployments",
      icon: <Package className="h-4 w-4" />,
      action: () => router.push("/packages"),
      category: "Navigation"
    },
    {
      id: "nav-vulnerabilities",
      title: "Go to Vulnerabilities",
      subtitle: "CVEs and security findings",
      icon: <Bug className="h-4 w-4" />,
      action: () => router.push("/vulnerabilities"),
      category: "Navigation"
    },
    {
      id: "nav-compliance",
      title: "Go to Compliance",
      subtitle: "Compliance policies and status",
      icon: <Shield className="h-4 w-4" />,
      action: () => router.push("/compliance"),
      category: "Navigation"
    },
    {
      id: "nav-alerts",
      title: "Go to Alerts",
      subtitle: "Alert rules and incident history",
      icon: <Bell className="h-4 w-4" />,
      action: () => router.push("/alerts"),
      category: "Navigation"
    },
    {
      id: "nav-reports",
      title: "Go to Reports",
      subtitle: "Generate and download fleet reports",
      icon: <FileText className="h-4 w-4" />,
      action: () => router.push("/reports"),
      category: "Navigation"
    },
    {
      id: "nav-query",
      title: "Go to Query Engine",
      subtitle: "Run queries across your fleet",
      icon: <Database className="h-4 w-4" />,
      action: () => router.push("/query"),
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
      id: "nav-performance",
      title: "Go to Performance",
      subtitle: "Fleet performance analytics",
      icon: <BarChart3 className="h-4 w-4" />,
      action: () => router.push("/performance"),
      category: "Navigation"
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

  // Action commands (> prefix)
  const actionCommands: CommandItem[] = useMemo(() => [
    {
      id: "action-add-node",
      title: "Add New Node",
      subtitle: "Generate onboarding script or token",
      icon: <Plus className="h-4 w-4" />,
      action: () => router.push("/settings?tab=onboarding"),
      category: "Actions"
    },
    {
      id: "action-create-job",
      title: "Create Job",
      subtitle: "Run a new job across your fleet",
      icon: <Zap className="h-4 w-4" />,
      action: () => router.push("/jobs?new=true"),
      category: "Actions"
    },
    {
      id: "action-create-group",
      title: "Create Group",
      subtitle: "Create a new node group",
      icon: <FolderTree className="h-4 w-4" />,
      action: () => router.push("/groups?new=true"),
      category: "Actions"
    },
    {
      id: "action-create-deployment",
      title: "Create Deployment",
      subtitle: "Deploy software to your fleet",
      icon: <Package className="h-4 w-4" />,
      action: () => router.push("/deployments?new=true"),
      category: "Actions"
    },
    {
      id: "action-run-query",
      title: "Run Query",
      subtitle: "Start a new fleet query",
      icon: <Database className="h-4 w-4" />,
      action: () => router.push("/query"),
      category: "Actions"
    },
    {
      id: "action-create-alert",
      title: "Create Alert Rule",
      subtitle: "Set up a new alert rule",
      icon: <Bell className="h-4 w-4" />,
      action: () => router.push("/alerts?new=true"),
      category: "Actions"
    },
    {
      id: "action-generate-report",
      title: "Generate Report",
      subtitle: "Create a fleet or security report",
      icon: <FileText className="h-4 w-4" />,
      action: () => router.push("/reports"),
      category: "Actions"
    },
    {
      id: "action-scan-vulns",
      title: "Scan Vulnerabilities",
      subtitle: "Start a fleet-wide vulnerability scan",
      icon: <Bug className="h-4 w-4" />,
      action: () => router.push("/vulnerabilities?scan=true"),
      category: "Actions"
    },
  ], [router]);

  // Knowledge commands (? prefix) - built from recent + favorites
  const knowledgeCommands: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];

    // Favorites
    favorites.forEach((fav) => {
      items.push({
        id: `fav-${fav.type}-${fav.id}`,
        title: fav.label,
        subtitle: `Favorite · ${fav.type}`,
        icon: <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />,
        action: () => router.push(fav.href),
        category: "Favorites"
      });
    });

    // Recent pages
    recent.slice(0, 10).forEach((item, i) => {
      items.push({
        id: `recent-${i}`,
        title: item.label,
        subtitle: `Visited ${formatRelativeTime(item.timestamp)}`,
        icon: <Clock className="h-4 w-4" />,
        action: () => router.push(item.href),
        category: "Recently Opened"
      });
    });

    return items;
  }, [favorites, recent, router]);

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

  // Search logic (only in jump mode)
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (mode !== "jump" || effectiveQuery.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/v1/nodes/search?q=${encodeURIComponent(effectiveQuery)}`,
          { headers: getAuthHeader() }
        );
        if (res.ok) {
          const data = await res.json();
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
  }, [effectiveQuery, open, mode]);

  // Compute visible items based on mode
  const allItems = useMemo(() => {
    if (mode === "action") {
      if (!effectiveQuery) return actionCommands;
      return actionCommands.filter(item =>
        item.title.toLowerCase().includes(effectiveQuery.toLowerCase())
      );
    }

    if (mode === "knowledge") {
      if (!effectiveQuery) return knowledgeCommands;
      return knowledgeCommands.filter(item =>
        item.title.toLowerCase().includes(effectiveQuery.toLowerCase())
      );
    }

    // Jump mode
    const filteredNav = effectiveQuery
      ? navigationCommands.filter(item =>
          item.title.toLowerCase().includes(effectiveQuery.toLowerCase()) ||
          item.subtitle?.toLowerCase().includes(effectiveQuery.toLowerCase())
        )
      : navigationCommands;

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

    return [...filteredNav, ...nodeItems];
  }, [mode, effectiveQuery, navigationCommands, actionCommands, knowledgeCommands, nodes, router]);

  // Get unique categories in order
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of allItems) {
      if (!seen.has(item.category)) {
        seen.add(item.category);
        result.push(item.category);
      }
    }
    return result;
  }, [allItems]);

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

  const placeholder = mode === "action"
    ? "Execute an action..."
    : mode === "knowledge"
    ? "Search favorites, recent pages..."
    : "Type a command or search nodes...";

  const modeHint = mode === "action"
    ? { label: "Actions", color: "text-blue-400 border-blue-400/30 bg-blue-400/10" }
    : mode === "knowledge"
    ? { label: "Knowledge", color: "text-purple-400 border-purple-400/30 bg-purple-400/10" }
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 gap-0 sm:max-w-[600px] border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl">
        <div className="flex items-center border-b border-zinc-800 px-4 py-3 bg-zinc-900/50">
          <Search className="h-5 w-5 text-zinc-400 mr-3 shrink-0" />
          {modeHint && (
            <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border mr-2 shrink-0", modeHint.color)}>
              {modeHint.label}
            </span>
          )}
          <input
            autoFocus
            placeholder={placeholder}
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
          {allItems.length === 0 && !loading && query && (
            <div className="py-12 text-center text-zinc-500">
              No results found for &ldquo;{effectiveQuery}&rdquo;
            </div>
          )}

          {allItems.length === 0 && !loading && !query && (
            <div className="py-8 text-center text-zinc-500 space-y-2">
              <p className="text-sm">Type to search, or use a prefix:</p>
              <div className="flex justify-center gap-3 text-xs">
                <span className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800"><kbd className="font-mono">&gt;</kbd> Actions</span>
                <span className="px-2 py-1 rounded border border-zinc-700 bg-zinc-800"><kbd className="font-mono">?</kbd> Knowledge</span>
              </div>
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
          {categories.map(category => {
            const categoryItems = allItems.filter(i => i.category === category);
            if (categoryItems.length === 0) return null;

            return (
              <div key={category} className="mb-2">
                <div className="px-3 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                  {category}
                </div>
                {categoryItems.map((item) => {
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
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">&gt;</kbd> actions
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700">?</kbd> knowledge
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

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
