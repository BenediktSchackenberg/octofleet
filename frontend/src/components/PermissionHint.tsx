"use client";

import React from "react";
import { Lock } from "lucide-react";

interface PermissionHintProps {
  permission: string;
  visible?: boolean;
}

export function PermissionHint({ permission, visible = true }: PermissionHintProps) {
  if (!visible) return null;

  return (
    <span className="group relative inline-flex items-center gap-1 text-xs text-zinc-500">
      <Lock className="h-3 w-3" />
      <span>Requires {permission} permission</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        Permission required: {permission}
      </span>
    </span>
  );
}
