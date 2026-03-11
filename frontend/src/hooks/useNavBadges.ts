"use client";

import { useState, useEffect, useRef } from "react";
import { apiClient } from "@/lib/api-client";

interface NavBadges {
  findings: number;
  unpatched: number;
  pendingApprovals: number;
  failedJobs: number;
  alerts: number;
}

const EMPTY: NavBadges = { findings: 0, unpatched: 0, pendingApprovals: 0, failedJobs: 0, alerts: 0 };

interface ListLike {
  total?: number;
  count?: number;
  items?: unknown[];
}

async function safeCount(endpoint: string, extract?: (d: ListLike) => number): Promise<number> {
  try {
    const res = await apiClient.get<ListLike>(endpoint, { showErrorToast: false });
    if (!res) return 0;
    if (extract) return extract(res) || 0;
    return res.total ?? res.count ?? (Array.isArray(res.items) ? res.items.length : 0);
  } catch {
    return 0;
  }
}

interface VulnSummary {
  unpatched?: number;
  unpatchedCount?: number;
  total?: number;
}

async function fetchBadges(): Promise<NavBadges> {
  const [findings, unpatched, failedJobs, alerts] = await Promise.all([
    safeCount("/security/findings"),
    (async () => {
      try {
        const res = await apiClient.get<VulnSummary>("/vulnerabilities/summary", { showErrorToast: false });
        if (!res) return 0;
        return res.unpatched ?? res.unpatchedCount ?? res.total ?? 0;
      } catch { return 0; }
    })(),
    safeCount("/jobs?status=failed"),
    safeCount("/alerts/rules"),
  ]);
  return { findings, unpatched, pendingApprovals: 0, failedJobs, alerts };
}

export function useNavBadges(): NavBadges {
  const [badges, setBadges] = useState<NavBadges>(EMPTY);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const b = await fetchBadges();
      if (!cancelled) setBadges(b);
    };
    run();
    intervalRef.current = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return badges;
}
