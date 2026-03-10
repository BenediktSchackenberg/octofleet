"use client";

import { toast } from "sonner";

interface ActionToastOptions {
  type?: "success" | "error" | "info";
  undoFn?: () => void;
  undoTimeoutMs?: number;
  description?: string;
}

export function showActionToast(message: string, options?: ActionToastOptions) {
  const { type = "info", undoFn, undoTimeoutMs = 5000, description } = options ?? {};

  const toastFn = type === "success" ? toast.success : type === "error" ? toast.error : toast.info;

  toastFn(message, {
    description,
    duration: undoFn ? undoTimeoutMs : undefined,
    action: undoFn
      ? {
          label: "Undo",
          onClick: undoFn,
        }
      : undefined,
  });
}
