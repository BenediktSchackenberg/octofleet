"use client";

import { useState, useEffect, useCallback } from "react";

export interface Favorite {
  type: string;
  id: string;
  label: string;
  href: string;
}

const STORAGE_KEY = "octofleet-favorites";

function loadFavorites(): Favorite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: Favorite[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);

  // Sync across tabs
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setFavorites(loadFavorites());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addFavorite = useCallback((fav: Favorite) => {
    setFavorites((prev) => {
      if (prev.some((f) => f.type === fav.type && f.id === fav.id)) return prev;
      const next = [...prev, fav];
      saveFavorites(next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((type: string, id: string) => {
    setFavorites((prev) => {
      const next = prev.filter((f) => !(f.type === type && f.id === id));
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (type: string, id: string) => favorites.some((f) => f.type === type && f.id === id),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (fav: Favorite) => {
      if (isFavorite(fav.type, fav.id)) {
        removeFavorite(fav.type, fav.id);
      } else {
        addFavorite(fav);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  return { favorites, addFavorite, removeFavorite, isFavorite, toggleFavorite };
}
