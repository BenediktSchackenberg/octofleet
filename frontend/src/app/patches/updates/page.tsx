"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format";
import { StandardPage } from "@/components/ui/StandardPage";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type FleetReboot = "pending" | "needed" | "maybe" | "unknown" | "none";

export interface FleetNode {
  id: string;
  node_id: string;
  hostname: string;
  os_name: string | null;
  os_family: "windows" | "linux";
  online: boolean;
  pending: number;
  security: number;
  definitions: number;
  reboot: FleetReboot;
  last_search: { at: string | null; status: string | null; source: string | null; server: string | null; error: string | null };
  running: "patch_scan" | "patch_install" | null;
}

type Counts = Record<"nodes" | "pending" | "security" | "reboot" | "failed" | "stale" | "offline", number>;

// Filters that the cards switch on and off; "stale" = no update search for STALE_DAYS days
const FLAGS = ["pending", "security", "reboot", "failed", "stale", "offline"] as const;
type Flag = (typeof FLAGS)[number];
const STALE_DAYS = 7;
const SORTS = ["hostname", "pending", "security", "reboot", "last_search", "os"] as const;
type Sort = (typeof SORTS)[number];
const DEFAULT_SORT: Sort = "pending";
const PAGE_SIZE = 100;

interface Filters { os: "" | "windows" | "linux"; q: string; flags: Flag[]; sort: Sort; dir: "" | "asc" | "desc" }
const EMPTY: Filters = { os: "", q: "", flags: [], sort: DEFAULT_SORT, dir: "" };

/** Filters from the URL (?os=&q=&pending=1&…&sort=&dir=); unknown values are ignored */
function filtersFromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const os = p.get("os");
  const sort = p.get("sort") as Sort | null;
  const dir = p.get("dir");
  return {
    os: os === "windows" || os === "linux" ? os : "",
    q: p.get("q") || "",
    flags: FLAGS.filter((f) => p.get(f) === "1"),
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_SORT,
    dir: dir === "asc" || dir === "desc" ? dir : "",
  };
}

/** The filters as URL; each change is a history entry (Back returns to the previous filters), typing in the
 *  search field replaces the entry instead */
function filtersToUrl(f: Filters, push: boolean) {
  const url = new URL(window.location.href);
  for (const key of ["os", "q", "sort", "dir", ...FLAGS]) url.searchParams.delete(key);
  if (f.os) url.searchParams.set("os", f.os);
  if (f.q) url.searchParams.set("q", f.q);
  for (const flag of f.flags) url.searchParams.set(flag, "1");
  if (f.sort !== DEFAULT_SORT) url.searchParams.set("sort", f.sort);
  if (f.dir) url.searchParams.set("dir", f.dir);
  if (url.toString() === window.location.href) return;
  if (push) window.history.pushState(window.history.state, "", url.toString());
  else window.history.replaceState(window.history.state, "", url.toString());
}

/** Badge of the reboot state: pending and needed stand out, "maybe" is quieter */
export function RebootBadge({ reboot }: { reboot: FleetReboot }) {
  const { t } = useI18n();
  if (reboot === "none") return <span className="text-muted-foreground">–</span>;
  const cls = reboot === "pending" ? "border-red-500/50 text-red-500"
    : reboot === "needed" ? "border-amber-500/50 text-amber-500"
    : "text-muted-foreground";
  return <Badge variant="outline" className={cls}>{t(`fleetUpdates.reboot.${reboot}`)}</Badge>;
}

/** The last update search: time, status, source; the error as tooltip */
export function LastSearch({ search }: { search: FleetNode["last_search"] }) {
  const { t } = useI18n();
  if (!search.at) return <span className="text-muted-foreground">{t("fleetUpdates.neverSearched")}</span>;
  const source = search.source === "wsus" ? t("patchScan.sourceWsus", { server: search.server ?? "" }).trim()
    : search.source === "windows_update" ? t("patchScan.sourceWindowsUpdate")
    : search.source ? t("patchScan.sourcePackageManager", { manager: search.source }) : "";
  return (
    <div className="space-y-0.5" title={search.error ?? undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span>{formatDateTime(search.at)}</span>
        {search.status && search.status !== "succeeded" && (
          <Badge variant={search.status === "failed" ? "destructive" : "outline"}
            className={search.status === "partial" ? "border-amber-500/50 text-amber-500" : undefined}>
            {t(`patchScan.status.${search.status}`)}
          </Badge>
        )}
      </div>
      {source && <div className="text-xs text-muted-foreground">{source}</div>}
    </div>
  );
}

/**
 * Fleet updates: every node, Windows and Linux, with its pending updates, the reboot outlook and the last
 * update search - which nodes need updating, which are stuck, which wait for a reboot. Each row leads to
 * the node's Updates tab.
 */
export default function FleetUpdatesPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters | null>(null);
  const [search, setSearch] = useState("");
  const [nodes, setNodes] = useState<FleetNode[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Filters from the URL after mounting, and again on Back / Forward
  useEffect(() => {
    const read = () => { const f = filtersFromUrl(); setFilters(f); setSearch(f.q); setOffset(0); };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const update = (change: Partial<Filters>, push = true) => {
    setFilters((current) => {
      const next = { ...(current ?? EMPTY), ...change };
      filtersToUrl(next, push);
      return next;
    });
    setOffset(0);
  };

  // Name search: applied 300 ms after the last keystroke
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => update({ q: value.trim() }, false), 300);
  };

  const load = useCallback(async () => {
    if (!filters) return;
    const params = new URLSearchParams({ sort: filters.sort, limit: String(PAGE_SIZE), offset: String(offset) });
    if (filters.dir) params.set("dir", filters.dir);
    if (filters.os) params.set("os", filters.os);
    if (filters.q) params.set("q", filters.q);
    for (const flag of filters.flags) {
      if (flag === "stale") params.set("stale_days", String(STALE_DAYS));
      else params.set(flag, "true");
    }
    try {
      const data = await apiClient.get<{ nodes: FleetNode[]; total: number; counts: Counts }>(
        `/patches/fleet?${params.toString()}`, { showErrorToast: false });
      setNodes(data?.nodes ?? []);
      setTotal(data?.total ?? 0);
      setCounts(data?.counts ?? null);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    if (!filters) return;
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [filters, load]);

  const f = filters ?? EMPTY;
  const filtered = !!(f.os || f.q || f.flags.length);
  const toggle = (flag: Flag) => update({ flags: f.flags.includes(flag) ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] });
  const sortBy = (sort: Sort) => update(f.sort === sort
    ? { dir: (f.dir || (["pending", "security", "last_search"].includes(sort) ? "desc" : "asc")) === "desc" ? "asc" : "desc" }
    : { sort, dir: "" });
  const arrow = (sort: Sort) => f.sort !== sort ? "" :
    (f.dir || (["pending", "security", "last_search"].includes(sort) ? "desc" : "asc")) === "desc" ? " ↓" : " ↑";
  const select = "rounded-md border border-input bg-background px-3 py-2 text-sm";

  const cards: { key: "nodes" | Flag; icon: string }[] = [
    { key: "nodes", icon: "🖥️" }, { key: "pending", icon: "⬇️" }, { key: "security", icon: "🛡️" },
    { key: "reboot", icon: "🔄" }, { key: "failed", icon: "❌" }, { key: "stale", icon: "⏳" }, { key: "offline", icon: "📴" },
  ];

  const Head = ({ sort, label, className }: { sort: Sort; label: string; className?: string }) => (
    <TableHead className={className} aria-sort={f.sort === sort ? (arrow(sort).includes("↓") ? "descending" : "ascending") : undefined}>
      <button type="button" className="hover:text-foreground" onClick={() => sortBy(sort)}>{label}{arrow(sort)}</button>
    </TableHead>
  );

  return (
    <StandardPage
      title={t("fleetUpdates.title")}
      description={t("fleetUpdates.description")}
      icon={<ListChecks className="h-6 w-6" />}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="space-y-4">
        {/* Cards: count over all nodes and switch the filters on and off */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {cards.map((card) => {
            const active = card.key === "nodes" ? !f.flags.length : f.flags.includes(card.key);
            return (
              <button key={card.key} type="button" aria-pressed={active}
                onClick={() => card.key === "nodes" ? update({ flags: [] }) : toggle(card.key)}
                title={t(`fleetUpdates.cardHint.${card.key}`, { days: STALE_DAYS })}
                className={`rounded-lg border bg-card p-3 text-left transition-colors ${active ? "border-primary" : "hover:border-muted-foreground/40"}`}>
                <div className="text-xl">{card.icon}</div>
                <div className="text-2xl font-bold">{counts?.[card.key] ?? 0}</div>
                <div className="text-sm text-muted-foreground">{t(`fleetUpdates.cards.${card.key}`, { days: STALE_DAYS })}</div>
              </button>
            );
          })}
        </div>

        {/* Filter bar - kept in the URL */}
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)}
            placeholder={t("fleetUpdates.search")} aria-label={t("fleetUpdates.search")} className={`${select} w-64`} />
          <select value={f.os} onChange={(e) => update({ os: e.target.value as Filters["os"] })} className={select}
            aria-label={t("fleetUpdates.os")}>
            <option value="">{t("fleetUpdates.allSystems")}</option>
            <option value="windows">Windows</option>{/* i18n-ignore */}
            <option value="linux">Linux</option>{/* i18n-ignore */}
          </select>
          {filtered && (
            <button type="button" className="text-sm text-muted-foreground underline hover:text-foreground"
              onClick={() => { setSearch(""); update({ ...EMPTY, sort: f.sort, dir: f.dir }); }}>
              {t("fleetUpdates.showAll")}
            </button>
          )}
          <span className="ml-auto text-sm text-muted-foreground">{t("fleetUpdates.shown", { count: total })}</span>
        </div>

        {nodes.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">{t(filtered ? "fleetUpdates.noMatches" : "fleetUpdates.empty")}</div>
        ) : (
          <div className="rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <Head sort="hostname" label={t("fleetUpdates.col.node")} className="w-[26%]" />
                  <Head sort="pending" label={t("fleetUpdates.col.pending")} className="w-[16%]" />
                  <Head sort="reboot" label={t("fleetUpdates.col.reboot")} className="w-[16%]" />
                  <Head sort="last_search" label={t("fleetUpdates.col.lastSearch")} className="w-[26%]" />
                  <TableHead className="w-[16%]">{t("fleetUpdates.col.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="whitespace-normal">
                      <Link href={`/nodes/${node.id}?tab=updates`} className="font-medium text-blue-500 hover:underline">
                        {node.hostname}
                      </Link>
                      <div className="text-xs text-muted-foreground">{node.os_name ?? node.os_family}</div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {node.pending ? (
                        <span className="font-medium text-amber-500">{node.pending}</span>
                      ) : <span className="text-muted-foreground">0</span>}
                      {node.security > 0 && (
                        <span className="ml-2 text-xs text-red-500">{t("fleetUpdates.security", { count: node.security })}</span>
                      )}
                      {node.definitions > 0 && (
                        <div className="text-xs text-muted-foreground">{t("patchScan.definitions", { count: node.definitions })}</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal"><RebootBadge reboot={node.reboot} /></TableCell>
                    <TableCell className="whitespace-normal"><LastSearch search={node.last_search} /></TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap gap-1">
                        {node.running && (
                          <Badge variant="outline" className="border-purple-500/50 text-purple-500">
                            ⏳ {t(`fleetUpdates.running.${node.running}`)}
                          </Badge>
                        )}
                        {!node.online && <Badge variant="outline" className="text-muted-foreground">{t("fleetUpdates.offline")}</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("fleetUpdates.range", { from: offset + 1, to: offset + nodes.length, total })}</span>
            <div className="flex gap-2">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded border px-3 py-1 disabled:opacity-40">{t("fleetUpdates.previous")}</button>
              <button type="button" disabled={offset + nodes.length >= total} onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded border px-3 py-1 disabled:opacity-40">{t("fleetUpdates.next")}</button>
            </div>
          </div>
        )}
      </div>
    </StandardPage>
  );
}
