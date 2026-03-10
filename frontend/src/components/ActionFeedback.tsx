"use client";

import { useState, useCallback } from "react";
import { showActionToast } from "./ActionToast";

type ActionStatus = "idle" | "running" | "success" | "failed";

interface ExecuteOptions {
  successMessage?: string;
  errorMessage?: string;
  undoFn?: () => Promise<void>;
  undoTimeoutMs?: number;
}

export function useActionFeedback() {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async <T,>(fn: () => Promise<T>, options?: ExecuteOptions): Promise<T | undefined> => {
      setStatus("running");
      setError(null);
      try {
        const result = await fn();
        setStatus("success");
        if (options?.successMessage) {
          showActionToast(options.successMessage, {
            type: "success",
            undoFn: options.undoFn ? () => { void options.undoFn?.(); } : undefined,
            undoTimeoutMs: options.undoTimeoutMs,
          });
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setStatus("failed");
        setError(msg);
        if (options?.errorMessage) {
          showActionToast(options.errorMessage, { type: "error", description: msg });
        }
        return undefined;
      }
    },
    []
  );

  return { execute, status, error };
}
