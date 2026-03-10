"use client";

import { useState, useCallback, useMemo } from "react";

export function useBulkSelection<T = string>() {
  const [selectedSet, setSelectedSet] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    setSelectedSet(new Set(ids));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedSet(new Set());
  }, []);

  const isSelected = useCallback(
    (id: T) => selectedSet.has(id),
    [selectedSet]
  );

  const selected = useMemo(() => selectedSet, [selectedSet]);

  return { selected, toggle, selectAll, clearAll, isSelected };
}
