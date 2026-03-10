"use client";

import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      <div className="flex flex-col items-center gap-4 max-w-md rounded-xl border border-dashed border-zinc-700 bg-zinc-900/50 p-10">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-zinc-800">
          <Icon className="w-6 h-6 text-zinc-400" />
        </div>
        <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
        {description && (
          <p className="text-sm text-zinc-400 text-center leading-relaxed">{description}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
