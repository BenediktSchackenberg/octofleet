"use client";

import React, { useState } from "react";
import { useSavedViews } from "@/hooks/useSavedViews";
import { X, Plus, Check } from "lucide-react";

interface SavedViewBarProps {
  page: string;
  currentFilters: Record<string, string>;
  onLoadView: (filters: Record<string, string>) => void;
}

export function SavedViewBar({ page, currentFilters, onLoadView }: SavedViewBarProps) {
  const { views, currentView, saveView, deleteView, loadView } = useSavedViews(page);
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState("");

  const handleSave = () => {
    if (!name.trim()) return;
    saveView({ name: name.trim(), page, filters: currentFilters });
    setName("");
    setIsNaming(false);
  };

  const handleLoad = (id: string) => {
    const view = loadView(id);
    if (view) onLoadView(view.filters);
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2">
      {views.map((view) => (
        <button
          key={view.id}
          onClick={() => handleLoad(view.id)}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors whitespace-nowrap ${
            currentView?.id === view.id
              ? "bg-cyan-500 text-white"
              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          {view.name}
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteView(view.id);
            }}
            className="ml-1 rounded-full p-0.5 hover:bg-black/20"
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      ))}

      {isNaming ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="View name…"
            className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-200 outline-none focus:border-cyan-500"
          />
          <button onClick={handleSave} className="rounded-full p-1 text-cyan-500 hover:bg-zinc-800">
            <Check className="h-4 w-4" />
          </button>
          <button onClick={() => setIsNaming(false)} className="rounded-full p-1 text-zinc-400 hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsNaming(true)}
          className="flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Save view
        </button>
      )}
    </div>
  );
}
