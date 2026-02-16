"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Bookmark, Plus, X, Edit2 } from "lucide-react";

interface SavedView {
  id: string;
  name: string;
  filter: {
    status?: string;
    os?: string;
    group?: string;
    query?: string;
  };
}

interface SavedViewsProps {
  onApplyFilter: (filter: SavedView['filter']) => void;
}

const DEFAULT_VIEWS: SavedView[] = [
  { id: "offline-7d", name: "Offline > 7 Tage", filter: { status: "offline" } },
  { id: "windows-server", name: "Windows Server", filter: { os: "Windows Server" } },
  { id: "no-group", name: "Ohne Gruppe", filter: { group: "unassigned" } },
  { id: "linux", name: "Linux", filter: { os: "Linux" } },
];

export function SavedViews({ onApplyFilter }: SavedViewsProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [activeView, setActiveView] = useState<string | null>(null);

  useEffect(() => {
    // Load from localStorage
    const stored = localStorage.getItem("octofleet-saved-views");
    if (stored) {
      try {
        setViews(JSON.parse(stored));
      } catch {
        setViews(DEFAULT_VIEWS);
      }
    } else {
      setViews(DEFAULT_VIEWS);
    }
  }, []);

  function saveViews(newViews: SavedView[]) {
    setViews(newViews);
    localStorage.setItem("octofleet-saved-views", JSON.stringify(newViews));
  }

  function addView() {
    if (!newName.trim()) return;
    const newView: SavedView = {
      id: `custom-${Date.now()}`,
      name: newName.trim(),
      filter: {}  // Would capture current filter state
    };
    saveViews([...views, newView]);
    setNewName("");
    setShowAdd(false);
  }

  function deleteView(id: string) {
    saveViews(views.filter(v => v.id !== id));
    if (activeView === id) {
      setActiveView(null);
      onApplyFilter({});
    }
  }

  function applyView(view: SavedView) {
    if (activeView === view.id) {
      setActiveView(null);
      onApplyFilter({});
    } else {
      setActiveView(view.id);
      onApplyFilter(view.filter);
    }
  }

  return (
    <div className="p-2 border-b">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
          <Bookmark className="h-3 w-3" /> Saved Views
        </h3>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      
      {showAdd && (
        <div className="flex gap-1 mb-2">
          <Input 
            placeholder="View name..." 
            className="h-7 text-xs" 
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addView()}
          />
          <Button size="sm" className="h-7 px-2" onClick={addView}>Save</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {views.map(view => (
          <Badge 
            key={view.id}
            variant={activeView === view.id ? "default" : "secondary"}
            className="cursor-pointer text-xs py-0.5 group"
            onClick={() => applyView(view)}
          >
            {view.name}
            {view.id.startsWith("custom-") && (
              <X 
                className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 hover:text-red-500" 
                onClick={(e) => { e.stopPropagation(); deleteView(view.id); }}
              />
            )}
          </Badge>
        ))}
      </div>
    </div>
  );
}
