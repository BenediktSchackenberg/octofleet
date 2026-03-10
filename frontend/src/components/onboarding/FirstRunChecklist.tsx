"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X, Rocket } from "lucide-react";
import { apiClient } from "@/lib/api-client";

const DISMISSED_KEY = "octofleet-onboarding-dismissed";

interface ListResponse {
  total?: number;
  count?: number;
  items?: unknown[];
}

async function hasItems(endpoint: string): Promise<boolean> {
  try {
    const res = await apiClient.get<ListResponse>(endpoint, { showErrorToast: false });
    if (!res) return false;
    const c = res.total ?? res.count ?? (Array.isArray(res.items) ? res.items.length : 0);
    return c > 0;
  } catch {
    return false;
  }
}

interface Step {
  key: string;
  label: string;
  href: string;
  check: () => Promise<boolean>;
}

const steps: Step[] = [
  { key: "admin", label: "Create admin account", href: "#", check: async () => true },
  { key: "nodes", label: "Connect your first device", href: "/nodes", check: () => hasItems("/api/v1/nodes") },
  { key: "groups", label: "Create device groups", href: "/groups", check: () => hasItems("/api/v1/groups") },
  { key: "patches", label: "Set up patch rings", href: "/patches", check: () => hasItems("/api/v1/patch-rings") },
  { key: "security", label: "Enable security monitoring", href: "/security/profiles", check: () => hasItems("/api/v1/security/profiles") },
  { key: "alerts", label: "Configure alerting", href: "/alerts", check: () => hasItems("/api/v1/alerts/rules") },
];

export function FirstRunChecklist() {
  const [dismissed, setDismissed] = useState(true);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) === "true") {
      setDismissed(true);
      return;
    }
    setDismissed(false);

    let cancelled = false;
    (async () => {
      const results: Record<string, boolean> = {};
      for (const step of steps) {
        try {
          results[step.key] = await step.check();
        } catch {
          results[step.key] = false;
        }
      }
      if (!cancelled) setCompleted(results);
    })();
    return () => { cancelled = true; };
  }, []);

  if (dismissed) return null;

  const completedCount = Object.values(completed).filter(Boolean).length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Getting Started</h3>
          <span className="text-xs text-zinc-500">{completedCount}/{steps.length}</span>
        </div>
        <button
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, "true");
            setDismissed(true);
          }}
          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Dismiss checklist"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="space-y-2">
        {steps.map((step) => {
          const done = completed[step.key] ?? false;
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  done ? "text-zinc-500" : "text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-zinc-600 shrink-0" />
                )}
                <span className={done ? "line-through" : ""}>{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
