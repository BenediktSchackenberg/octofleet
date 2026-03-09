"use client";

import { useState, useEffect, useCallback } from "react";

export interface RecentItem {
  href: string;
  label: string;
  timestamp: number;
}

const STORAGE_KEY = "octofleet-recently-opened";
const MAX_ITEMS = 20;

function loadRecent(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: RecentItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useRecentlyOpened() {
  const [recent, setRecent] = useState<RecentItem[]>(loadRecent);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setRecent(loadRecent());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const trackPage = useCallback((href: string, label: string) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.href !== href);
      const next = [{ href, label, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      saveRecent(next);
      return next;
    });
  }, []);

  return { recent, trackPage };
}
