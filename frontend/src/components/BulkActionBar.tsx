"use client";

import React from "react";
import { X } from "lucide-react";

interface BulkAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
}

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  actions: BulkAction[];
}

export function BulkActionBar({ selectedCount, onClear, actions }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-700 bg-zinc-800 px-4 py-3 transition-transform duration-200 ease-out animate-in slide-in-from-bottom"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">
          {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
        </span>

        <div className="flex items-center gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                action.variant === "destructive"
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}

          <button
            onClick={onClear}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
            Clear selection
          </button>
        </div>
      </div>
    </div>
  );
}
