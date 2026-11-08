"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A tab (or view) that is kept in the URL (`?tab=…`), so a reload, a shared link or the
 * browser's Back button opens the same tab again.
 *
 * - The default tab is not written to the URL; unknown values fall back to the default.
 * - Switching tabs uses history.replaceState: it adds no history entries, so Back still
 *   leaves the page instead of stepping through its tabs.
 * - The URL is read after mounting (it is not known while rendering on the server), and
 *   again on popstate (Back/Forward to the same page with another tab).
 *
 * `param` lets nested tabs use their own parameter (e.g. a tab inside a node page tab).
 */
export function useTabParam<T extends string>(
  defaultTab: T,
  tabs: readonly T[],
  param = "tab",
): [T, (tab: string) => void] {
  const [tab, setTab] = useState<T>(defaultTab);

  const isTab = useCallback((value: string | null): value is T => value !== null && (tabs as readonly string[]).includes(value), [tabs]);

  useEffect(() => {
    const read = () => {
      const value = new URLSearchParams(window.location.search).get(param);
      setTab(isTab(value) ? value : defaultTab);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
    // tabs and defaultTab are constant for a page; reading once per param is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const select = useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      setTab(next);
      const url = new URL(window.location.href);
      if (next === defaultTab) url.searchParams.delete(param);
      else url.searchParams.set(param, next);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    },
    [defaultTab, isTab, param],
  );

  return [tab, select];
}
