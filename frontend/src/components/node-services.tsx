"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n-context";

/** One service, whichever agent reported it. */
export interface NodeService {
  name: string;
  /** Windows: display name; Linux: the unit's description */
  displayName?: string;
  description?: string;
  state: "running" | "stopped" | "failed" | "other";
  /** state as the agent reported it (Windows: Running/Stopped/…; Linux: activeState/subState) */
  rawState: string;
  /** Windows: Auto/Manual/Disabled; Linux: enabled/disabled */
  startType?: string;
  /** Windows only: the account the service runs as */
  account?: string;
}

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * The services of a node in one shape. Windows agent (SystemCollector, stored in system_current.services):
 * {total, running, services: [{name, displayName, state, startMode, startName, description}]}.
 * Linux agent (collect_services, stored in linux_data_current.services):
 * {services: [{name, loadState, activeState, subState, description}], enabledServices: [...]}.
 * Returns null when neither agent reported services (not collected), [] when it reported none.
 */
export function normalizeServices(windows: unknown, linux: unknown): NodeService[] | null {
  const linuxData = linux && typeof linux === "object" ? (linux as Raw) : null;
  if (linuxData && Array.isArray(linuxData.services)) {
    const enabled = new Set(Array.isArray(linuxData.enabledServices) ? (linuxData.enabledServices as string[]) : []);
    return (linuxData.services as Raw[]).map((s) => {
      const active = text(s.activeState) ?? "";
      const sub = text(s.subState);
      const name = text(s.name) ?? "?";
      return {
        name,
        description: text(s.description),
        state: active === "active" ? "running" : active === "failed" ? "failed" : active === "inactive" ? "stopped" : "other",
        rawState: sub ? `${active} (${sub})` : active,
        startType: enabled.size > 0 ? (enabled.has(name) ? "enabled" : "disabled") : undefined,
      };
    });
  }
  const windowsData = windows && typeof windows === "object" ? (windows as Raw) : null;
  const list = Array.isArray(windows) ? (windows as Raw[]) : windowsData && Array.isArray(windowsData.services) ? (windowsData.services as Raw[]) : null;
  // No list, or the bare empty list other agents leave in system_current.services: not collected
  if (!list || (Array.isArray(windows) && list.length === 0)) return null;
  return list.map((s) => {
    const state = text(s.state) ?? text(s.status) ?? "";
    const lower = state.toLowerCase();
    return {
      name: text(s.name) ?? "?",
      displayName: text(s.displayName),
      description: text(s.description),
      state: lower === "running" ? "running" : lower === "stopped" ? "stopped" : "other",
      rawState: state,
      startType: text(s.startMode) ?? text(s.startType),
      account: text(s.startName),
    };
  });
}

const STATE_FILTERS = ["all", "running", "stopped", "failed"] as const;

export function NodeServices({ windows, linux }: { windows: unknown; linux: unknown }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<(typeof STATE_FILTERS)[number]>("all");
  const services = useMemo(() => normalizeServices(windows, linux), [windows, linux]);

  if (services === null) {
    // Shown, not hidden: an empty tab could be mistaken for a node without services
    return (
      <Card>
        <CardHeader><CardTitle>⚙️ {t("nodeServices.title")}</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">{t("nodeServices.notCollected")}</p></CardContent>
      </Card>
    );
  }

  const count = (state: NodeService["state"]) => services.filter((s) => s.state === state).length;
  const needle = query.trim().toLowerCase();
  const shown = services
    .filter((s) => stateFilter === "all" || s.state === stateFilter)
    .filter((s) => !needle || [s.name, s.displayName, s.description].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => (a.state === "failed" ? 0 : 1) - (b.state === "failed" ? 0 : 1) || a.name.localeCompare(b.name));
  const showAccount = services.some((s) => s.account);
  const badge = (state: NodeService["state"]) =>
    state === "running" ? "default" : state === "failed" ? "destructive" : "secondary";

  return (
    <Card>
      <CardHeader>
        <CardTitle>⚙️ {t("nodeServices.titleCount", { count: services.length })}</CardTitle>
        <CardDescription>
          {t("nodeServices.summary", { running: count("running"), stopped: count("stopped"), failed: count("failed") })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("nodeServices.search")}
            className="flex-1 min-w-[200px] px-3 py-2 bg-card border border-border rounded-lg text-sm"
          />
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as (typeof STATE_FILTERS)[number])}
            className="px-3 py-2 bg-card border border-border rounded-lg text-sm"
          >
            {STATE_FILTERS.map((f) => (
              <option key={f} value={f}>{t(`nodeServices.filter.${f}`)}</option>
            ))}
          </select>
        </div>
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{services.length === 0 ? t("nodeServices.none") : t("nodeServices.noMatch")}</p>
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("nodeServices.col.name")}</TableHead>
                  <TableHead>{t("nodeServices.col.state")}</TableHead>
                  <TableHead>{t("nodeServices.col.startType")}</TableHead>
                  {showAccount && <TableHead>{t("nodeServices.col.account")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell>
                      <div className="font-mono text-sm">{s.name}</div>
                      {(s.displayName || s.description) && (
                        <div className="text-xs text-muted-foreground truncate max-w-[480px]" title={s.description ?? s.displayName}>
                          {s.displayName && s.displayName !== s.name ? s.displayName : s.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge(s.state)} title={s.rawState}>
                        {t(`nodeServices.state.${s.state}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{s.startType ?? "-"}</TableCell>
                    {showAccount && <TableCell className="text-sm text-muted-foreground">{s.account ?? "-"}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
