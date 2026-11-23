"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingSpinner } from "@/components/ui-components";
import { JsonDetails, summarizeJson } from "@/components/JsonDetails";
import { ChevronRight, Download, RefreshCw, X } from "lucide-react";

/**
 * The audit log (`audit_log`): who did what to which resource. One page for everything;
 * other pages link here with filters in the URL, e.g. /audit?resource_type=user,role
 * (Access management) or /audit?resource_type=node&resource_id=<uuid>.
 */

interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  details: unknown;
  ip_address: string | null;
}

interface Filters {
  action: string;
  user: string;
  resource_type: string;
  resource_id: string;
  date_from: string;
  date_to: string;
}

const FILTER_KEYS: (keyof Filters)[] = ["action", "user", "resource_type", "resource_id", "date_from", "date_to"];
const EMPTY: Filters = { action: "", user: "", resource_type: "", resource_id: "", date_from: "", date_to: "" };
const RESOURCE_TYPES = ["node", "user", "user,role", "role", "job", "group", "system_settings"];
const LIMIT = 50;

const ACTION_COLORS: [string, string][] = [
  ["fail", "bg-red-500/20 text-red-400"],
  ["delete", "bg-red-500/20 text-red-400"],
  ["login", "bg-green-500/20 text-green-400"],
  ["create", "bg-blue-500/20 text-blue-400"],
  ["update", "bg-yellow-500/20 text-yellow-400"],
  ["changed", "bg-yellow-500/20 text-yellow-400"],
  ["reboot", "bg-orange-500/20 text-orange-400"],
  ["uninstall", "bg-purple-500/20 text-purple-400"],
];

function actionColor(action: string): string {
  const a = action.toLowerCase();
  return ACTION_COLORS.find(([key]) => a.includes(key))?.[1] ?? "bg-zinc-500/20 text-zinc-400";
}

/** Where a resource's page is, if it has one */
function resourceHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "node": return `/nodes/${id}`;
    case "job": return `/jobs/${id}`;
    case "group": return `/groups/${id}`;
    case "user": return "/users";
    case "role": return "/users?tab=roles";
    default: return null;
  }
}

function readFilters(): Filters {
  const q = new URLSearchParams(window.location.search);
  const f = { ...EMPTY };
  for (const k of FILTER_KEYS) f[k] = q.get(k) ?? (k === "user" ? q.get("user_id") ?? "" : "");
  return f;
}

/** "2026-11-23" from a date input → start or end of that local day as ISO */
function dayBound(day: string, end: boolean): string {
  const d = new Date(`${day}T${end ? "23:59:59.999" : "00:00:00"}`);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function AuditPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Filters come from the URL (links from other pages), and go back into it
  useEffect(() => {
    const read = () => { setFilters(readFilters()); setPage(0); };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const update = (change: Partial<Filters>) => {
    const next = { ...(filters ?? EMPTY), ...change };
    const q = new URLSearchParams();
    for (const k of FILTER_KEYS) if (next[k]) q.set(k, next[k]);
    window.history.replaceState(null, "", q.toString() ? `?${q}` : window.location.pathname);
    setFilters(next);
    setPage(0);
  };

  const load = useCallback(async () => {
    if (!filters) return;
    const q = new URLSearchParams({ limit: String(LIMIT), offset: String(page * LIMIT) });
    for (const k of ["action", "user", "resource_type", "resource_id"] as const) if (filters[k]) q.set(k, filters[k]);
    if (filters.date_from) q.set("date_from", dayBound(filters.date_from, false));
    if (filters.date_to) q.set("date_to", dayBound(filters.date_to, true));
    try {
      const data = await apiClient.get<{ entries: AuditEntry[]; total: number; total_capped?: boolean }>(
        `/audit?${q}`, { showErrorToast: false });
      if (data) {
        setEntries(data.entries || []);
        setTotal(data.total || 0);
        setCapped(!!data.total_capped);
      }
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, [autoRefresh, load]);

  function exportCsv() {
    const header = ["timestamp", "user", "action", "resource_type", "resource_id", "resource_name", "ip_address", "details"];
    const rows = entries.map((e) => [e.timestamp, e.username || "", e.action, e.resource_type, e.resource_id,
      e.resource_name, e.ip_address, e.details].map(csvCell).join(","));
    const blob = new Blob([header.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "audit-log.csv";
    a.click();
  }

  const f = filters ?? EMPTY;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const showIp = entries.some((e) => e.ip_address);
  const columns = showIp ? 7 : 6;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t("audit.title")}</h1>
          <p className="text-muted-foreground text-sm">{t("audit.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? t("audit.autoRefreshOn") : t("audit.autoRefreshOff")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!entries.length}>
            <Download className="h-4 w-4 mr-1" /> {t("audit.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> {t("common.refresh")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t("audit.action")}</label>
              <Input value={f.action} onChange={(e) => update({ action: e.target.value })} placeholder={t("audit.actionPlaceholder")} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t("audit.user")}</label>
              <Input value={f.user} onChange={(e) => update({ user: e.target.value })} placeholder={t("audit.userPlaceholder")} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t("audit.resourceType")}</label>
              <select value={f.resource_type} onChange={(e) => update({ resource_type: e.target.value, resource_id: "" })}
                className="w-full h-9 px-3 bg-background border border-input rounded-md text-sm">
                <option value="">{t("common.all")}</option>
                {!RESOURCE_TYPES.includes(f.resource_type) && f.resource_type && <option value={f.resource_type}>{f.resource_type}</option>}
                {RESOURCE_TYPES.map((rt) => <option key={rt} value={rt}>{t(`audit.resourceTypes.${rt.replace(",", "_")}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t("audit.from")}</label>
              <Input type="date" value={f.date_from} onChange={(e) => update({ date_from: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t("audit.to")}</label>
              <Input type="date" value={f.date_to} onChange={(e) => update({ date_to: e.target.value })} />
            </div>
          </div>
          {f.resource_id && (
            <div className="mt-3">
              <Badge variant="secondary" className="gap-1">
                {t("audit.onlyResource", { name: entries[0]?.resource_id === f.resource_id && entries[0]?.resource_name ? entries[0].resource_name : f.resource_id })}
                <button type="button" onClick={() => update({ resource_id: "" })} aria-label={t("audit.clearResource")}><X className="h-3 w-3" /></button>
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading && !entries.length ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
          ) : !entries.length ? (
            <div className="text-center py-12 text-muted-foreground">{t("audit.noEntries")}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">{t("audit.timestamp")}</TableHead>
                    <TableHead>{t("audit.user")}</TableHead>
                    <TableHead>{t("audit.action")}</TableHead>
                    <TableHead>{t("audit.resource")}</TableHead>
                    <TableHead>{t("audit.details")}</TableHead>
                    {showIp && <TableHead>{t("audit.ipAddress")}</TableHead>}
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => {
                    const href = resourceHref(e.resource_type, e.resource_id);
                    const name = e.resource_name || e.resource_id?.slice(0, 8);
                    return (
                      <Fragment key={e.id}>
                        <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                          <TableCell className="text-sm whitespace-nowrap">{formatDateTime(e.timestamp)}</TableCell>
                          <TableCell className="text-sm">{e.username || <span className="text-muted-foreground">{t("audit.system")}</span>}</TableCell>
                          <TableCell><Badge className={`${actionColor(e.action)} text-xs`}>{e.action}</Badge></TableCell>
                          <TableCell className="text-sm">
                            {e.resource_type && (
                              <span title={e.resource_id ?? undefined}>
                                <span className="text-muted-foreground">{t(`audit.resourceTypes.${e.resource_type}`) === `audit.resourceTypes.${e.resource_type}` ? e.resource_type : t(`audit.resourceTypes.${e.resource_type}`)}:</span>{" "}
                                {href && name ? (
                                  <Link href={href} className="text-blue-400 hover:underline" onClick={(ev) => ev.stopPropagation()}>{name}</Link>
                                ) : (name || "–")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-md truncate">{summarizeJson(t, e.details)}</TableCell>
                          {showIp && <TableCell className="text-xs text-muted-foreground font-mono">{e.ip_address || "–"}</TableCell>}
                          <TableCell><ChevronRight className={`h-4 w-4 transition-transform ${expanded === e.id ? "rotate-90" : ""}`} /></TableCell>
                        </TableRow>
                        {expanded === e.id && (
                          <TableRow>
                            <TableCell colSpan={columns} className="bg-muted/30">
                              <JsonDetails value={e.details} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <span className="text-sm text-muted-foreground">
                  {capped ? t("audit.entriesCapped", { count: formatNumber(total) }) : t("audit.entries", { count: formatNumber(total) })}
                  {" · "}{t("audit.page", { page: page + 1, pages: totalPages })}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("common.previous")}</Button>
                  <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>{t("common.next")}</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
