"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Circle, Monitor } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchResult {
  node_id: string;
  hostname: string;
  os_name: string;
  os_version: string;
  status: "online" | "away" | "offline";
  last_seen: string | null;
}

interface GlobalSearchProps {
  onNodeSelect: (nodeId: string) => void;
}

export function GlobalSearch({ onNodeSelect }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setShowResults(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `http://192.168.0.5:8080/api/v1/nodes/search?q=${encodeURIComponent(query)}`,
          { headers: { "X-API-Key": "openclaw-inventory-dev-key" } }
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.nodes || []);
          setShowResults(true);
          setSelectedIndex(0);
        }
      } catch (e) {
        console.error("Search failed:", e);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showResults || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = results[selectedIndex];
      if (selected) {
        onNodeSelect(selected.node_id);
        setShowResults(false);
        setQuery("");
      }
    }
  }

  function handleSelect(nodeId: string) {
    onNodeSelect(nodeId);
    setShowResults(false);
    setQuery("");
  }

  function formatLastSeen(lastSeen: string | null) {
    if (!lastSeen) return "Never";
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMinutes = (now.getTime() - date.getTime()) / 1000 / 60;
    
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${Math.floor(diffMinutes)}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          placeholder="Search nodes... (press /)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          onKeyDown={handleKeyDown}
          className="pl-9 pr-4"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 max-h-80 overflow-y-auto">
          {results.map((result, index) => (
            <div
              key={result.node_id}
              className={cn(
                "flex items-center gap-3 px-3 py-2 cursor-pointer",
                "hover:bg-accent transition-colors",
                index === selectedIndex && "bg-accent"
              )}
              onClick={() => handleSelect(result.node_id)}
            >
              <Circle
                className={cn(
                  "h-2 w-2 shrink-0 fill-current",
                  result.status === "online" && "text-green-500",
                  result.status === "away" && "text-yellow-500",
                  result.status === "offline" && "text-gray-400"
                )}
              />
              <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{result.hostname}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {result.os_name} {result.os_version}
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {formatLastSeen(result.last_seen)}
              </div>
            </div>
          ))}
        </div>
      )}

      {showResults && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 p-4 text-center text-muted-foreground">
          No nodes found for "{query}"
        </div>
      )}
    </div>
  );
}
