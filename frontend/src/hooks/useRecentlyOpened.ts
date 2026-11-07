"use client";

import { useState, useEffect, useCallback } from "react";

export interface RecentItem {
  href: string;
  /** Kept for entries stored by older versions; labels are now built from href when shown. */
  label?: string;
  /** Name of the node, group … the page shows, reported by that page. */
  name?: string;
  timestamp: number;
}

const STORAGE_KEY = "octofleet-recently-opened";
const CHANGE_EVENT = "octofleet-recently-opened-changed";
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // storage unavailable: the list just is not kept
  }
  // other components of this tab (breadcrumb, dashboard, palette) update right away
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRecentlyOpened() {
  const [recent, setRecent] = useState<RecentItem[]>(loadRecent);

  useEffect(() => {
    const reload = () => setRecent(loadRecent());
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) reload();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, reload);
    };
  }, []);

  const trackPage = useCallback((href: string) => {
    const previous = loadRecent();
    const known = previous.find((r) => r.href === href);
    const next = [{ href, name: known?.name, timestamp: Date.now() }, ...previous.filter((r) => r.href !== href)].slice(0, MAX_ITEMS);
    saveRecent(next);
  }, []);

  /** A detail page reports the name of what it shows (e.g. a group's name instead of its id). */
  const nameRecent = useCallback((href: string, name: string) => {
    const previous = loadRecent();
    if (!previous.some((r) => r.href === href && r.name !== name)) return;
    saveRecent(previous.map((r) => (r.href === href ? { ...r, name } : r)));
  }, []);

  return { recent, trackPage, nameRecent };
}
