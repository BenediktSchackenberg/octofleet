"use client";

import { useState, useCallback, useEffect } from "react";

export interface SavedView {
  id: string;
  name: string;
  page: string;
  filters: Record<string, string>;
  sorting?: { field: string; direction: "asc" | "desc" };
  columns?: string[];
  groupBy?: string;
  timeRange?: string;
  isDefault?: boolean;
  createdAt: string;
}

const STORAGE_KEY = "octofleet-saved-views";

function loadAll(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistAll(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

export function useSavedViews(page: string) {
  const [allViews, setAllViews] = useState<SavedView[]>([]);
  const [currentView, setCurrentView] = useState<SavedView | null>(null);

  useEffect(() => {
    setAllViews(loadAll());
  }, []);

  const views = allViews.filter((v) => v.page === page);

  const saveView = useCallback(
    (view: Omit<SavedView, "id" | "createdAt">) => {
      const newView: SavedView = {
        ...view,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const updated = [...loadAll(), newView];
      persistAll(updated);
      setAllViews(updated);
      setCurrentView(newView);
      return newView;
    },
    []
  );

  const deleteView = useCallback(
    (id: string) => {
      const updated = loadAll().filter((v) => v.id !== id);
      persistAll(updated);
      setAllViews(updated);
      if (currentView?.id === id) setCurrentView(null);
    },
    [currentView]
  );

  const loadView = useCallback(
    (id: string) => {
      const view = loadAll().find((v) => v.id === id) ?? null;
      setCurrentView(view);
      return view;
    },
    []
  );

  const setDefaultView = useCallback(
    (forPage: string, id: string) => {
      const all = loadAll().map((v) => ({
        ...v,
        isDefault: v.page === forPage ? v.id === id : v.isDefault,
      }));
      persistAll(all);
      setAllViews(all);
    },
    []
  );

  const listViews = useCallback(
    (forPage: string) => loadAll().filter((v) => v.page === forPage),
    []
  );

  return { views, currentView, saveView, deleteView, loadView, listViews, setDefaultView };
}
