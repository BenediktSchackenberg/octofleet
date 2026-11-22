"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { StandardPage } from "@/components/ui/StandardPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const SEVERITIES = ["Low", "Moderate", "Important", "Critical"] as const;

export interface LinuxRule {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  action: "approve" | "exclude";
  ring_ids: string[];
  group_id: string | null;
  releases: string[];
  security_only: boolean;
  min_severity: (typeof SEVERITIES)[number] | null;
  repositories: string[];
  packages: string[];
  min_age_hours: number;
  expedite: boolean;
  updated_by: string | null;
  updated_at: string;
}

interface Totals { nodes: number; approved: number; waiting: number; excluded: number; evaluating: number }
interface Release { release: string; package_manager: string | null; security_data: boolean; nodes: number }
interface Ring { id: string; name: string; delay_hours: number | null; node_group_id: string | null; paused?: boolean }
interface Group { id: string; name: string }
interface Preview { nodes: number; approved: number; waiting: number; excluded: number; nodes_without_security_data: number }

/** The editor's fields; patterns are edited as text (comma or space separated) */
interface Draft {
  name: string; description: string; enabled: boolean; action: "approve" | "exclude";
  ring_ids: string[]; group_id: string; releases: string; security_only: boolean; min_severity: string;
  repositories: string; packages: string; age: number; age_unit: "hours" | "days"; expedite: boolean;
}

const NEW_RULE: Draft = {
  name: "", description: "", enabled: true, action: "approve", ring_ids: [], group_id: "", releases: "",
  security_only: false, min_severity: "", repositories: "", packages: "", age: 0, age_unit: "days", expedite: false,
};

const EXAMPLE_NAME = "Security updates (example)";

const split = (text: string) => text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

function toDraft(rule: LinuxRule): Draft {
  const days = rule.min_age_hours % 24 === 0;
  return {
    name: rule.name, description: rule.description ?? "", enabled: rule.enabled, action: rule.action,
    ring_ids: rule.ring_ids, group_id: rule.group_id ?? "", releases: rule.releases.join(", "),
    security_only: rule.security_only, min_severity: rule.min_severity ?? "", repositories: rule.repositories.join(", "),
    packages: rule.packages.join(", "), age: days ? rule.min_age_hours / 24 : rule.min_age_hours,
    age_unit: days ? "days" : "hours", expedite: rule.expedite,
  };
}

function toBody(d: Draft) {
  const approve = d.action === "approve";
  return {
    name: d.name.trim(), description: d.description.trim() || null, enabled: d.enabled, action: d.action,
    ring_ids: d.ring_ids, group_id: d.group_id || null, releases: split(d.releases),
    security_only: approve && d.security_only, min_severity: approve && d.security_only && d.min_severity ? d.min_severity : null,
    repositories: split(d.repositories), packages: split(d.packages),
    min_age_hours: approve ? Math.max(0, Math.round(d.age * (d.age_unit === "days" ? 24 : 1))) : 0,
    expedite: approve && d.expedite,
  };
}

/** "3 days", "12 hours", "–" */
function useAge() {
  const { t } = useI18n();
  return (hours: number | null | undefined) => !hours ? "–"
    : hours % 24 === 0 ? t("linuxRules.days", { count: hours / 24 }) : t("linuxRules.hours", { count: hours });
}

/**
 * Linux approval rules (#271): which pending Linux package versions a bulk installation may install. A rule
 * approves or excludes versions for all Linux nodes or the nodes of deployment rings (with the ring's delay),
 * narrowed by a group and releases; an exclusion wins. The server evaluates them; this page edits them,
 * previews a rule before it is saved, and pauses rings.
 */
export default function LinuxRulesPage() {
  const { t } = useI18n();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("packages:write");
  const age = useAge();
  const [rules, setRules] = useState<LinuxRule[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [rings, setRings] = useState<Ring[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ data: Preview | null; error: string | null; loading: boolean }>(
    { data: null, error: null, loading: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, ringList, groupList] = await Promise.all([
        apiClient.request<{ rules: LinuxRule[]; totals: Totals; releases: Release[] }>("/patches/linux-rules", { showErrorToast: false }),
        apiClient.get<Ring[]>("/patches/rings", { showErrorToast: false }),
        apiClient.get<{ groups: Group[] }>("/groups", { showErrorToast: false }),
      ]);
      if (!list.ok || !list.data) throw new Error(list.error ?? t("linuxRules.loadFailed"));
      setRules(list.data.rules);
      setTotals(list.data.totals);
      setReleases(list.data.releases);
      setRings(ringList ?? []);
      setGroups(groupList?.groups ?? []);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  // While the counts are being updated (a rule changed a moment ago), refresh them
  useEffect(() => {
    if (!totals?.evaluating) return;
    const timer = setTimeout(load, 2000);
    return () => clearTimeout(timer);
  }, [totals, load]);

  // Preview of the rule being edited, 500 ms after the last change
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!editing) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreview((p) => ({ ...p, loading: true }));
      const res = await apiClient.request<Preview>("/patches/linux-rules/preview", {
        method: "POST", body: JSON.stringify({ ...toBody(editing.draft), name: editing.draft.name.trim() || "preview" }),
        headers: { "Content-Type": "application/json" }, showErrorToast: false });
      setPreview({ data: res.ok ? res.data : null, error: res.ok ? null : res.error, loading: false });
    }, 500);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [editing]);

  const ringName = (id: string) => rings.find((r) => r.id === id)?.name ?? t("linuxRules.deletedRing");
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? t("linuxRules.deletedGroup");
  const noSecurity = releases.filter((r) => !r.security_data);
  const example = rules.find((r) => r.name === EXAMPLE_NAME && !r.enabled);

  const set = (change: Partial<Draft>) => setEditing((e) => e && { ...e, draft: { ...e.draft, ...change } });

  async function save() {
    if (!editing) return;
    setBusy(true);
    setSaveError(null);
    const res = await apiClient.request<LinuxRule>(editing.id ? `/patches/linux-rules/${editing.id}` : "/patches/linux-rules", {
      method: editing.id ? "PUT" : "POST", body: JSON.stringify(toBody(editing.draft)),
      headers: { "Content-Type": "application/json" }, showErrorToast: false });
    setBusy(false);
    if (!res.ok) {
      setSaveError(res.error ?? t("linuxRules.saveFailed"));
      return;
    }
    toast.success(t(editing.id ? "linuxRules.saved" : "linuxRules.created", { name: res.data?.name ?? "" }));
    setEditing(null);
    await load();
  }

  async function toggle(rule: LinuxRule, enabled: boolean) {
    const res = await apiClient.request(`/patches/linux-rules/${rule.id}`, {
      method: "PUT", body: JSON.stringify({ enabled }), headers: { "Content-Type": "application/json" }, showErrorToast: false });
    if (!res.ok) toast.error(t("linuxRules.saveFailed"), { description: res.error ?? undefined });
    await load();
  }

  async function remove(rule: LinuxRule) {
    if (!window.confirm(t("linuxRules.confirmDelete", { name: rule.name }))) return;
    const res = await apiClient.request(`/patches/linux-rules/${rule.id}`, { method: "DELETE", showErrorToast: false });
    if (!res.ok) toast.error(t("linuxRules.deleteFailed"), { description: res.error ?? undefined });
    else toast.success(t("linuxRules.deleted", { name: rule.name }));
    await load();
  }

  async function pauseRing(ring: Ring, pause: boolean) {
    const res = await apiClient.request(`/patches/rings/${ring.id}/${pause ? "pause" : "resume"}`, {
      method: "POST", body: "{}", headers: { "Content-Type": "application/json" }, showErrorToast: false });
    if (!res.ok) toast.error(t("linuxRules.rings.failed"), { description: res.error ?? undefined });
    else toast.success(t(pause ? "linuxRules.rings.paused" : "linuxRules.rings.resumed", { name: ring.name }));
    await load();
  }

  /** What the rule covers, in words */
  const scope = (r: LinuxRule) => [
    r.ring_ids.length ? t("linuxRules.scope.rings", { rings: r.ring_ids.map(ringName).join(", ") }) : t("linuxRules.scope.all"),
    r.group_id ? t("linuxRules.scope.group", { group: groupName(r.group_id) }) : null,
    r.releases.length ? t("linuxRules.scope.releases", { releases: r.releases.join(", ") }) : null,
  ].filter(Boolean).join(" · ");
  const match = (r: LinuxRule) => [
    r.security_only ? (r.min_severity ? t("linuxRules.match.securityFrom", { severity: t(`linuxRules.severity.${r.min_severity}`) })
      : t("linuxRules.match.security")) : null,
    r.packages.length ? t("linuxRules.match.packages", { packages: r.packages.join(", ") }) : null,
    r.repositories.length ? t("linuxRules.match.repositories", { repositories: r.repositories.join(", ") }) : null,
  ].filter(Boolean).join(" · ") || t("linuxRules.match.all");

  const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  const d = editing?.draft;

  return (
    <StandardPage
      title={t("linuxRules.title")}
      description={t("linuxRules.description")}
      icon={<Scale className="h-6 w-6" />}
      loading={loading}
      error={error}
      onRetry={load}
      actions={canWrite ? (
        <Button onClick={() => { setSaveError(null); setPreview({ data: null, error: null, loading: false }); setEditing({ id: null, draft: NEW_RULE }); }}>
          {t("linuxRules.new")}
        </Button>
      ) : undefined}
    >
      <div className="space-y-6">
        {/* What the enabled rules approve now (from the server's cache) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["approved", "waiting", "excluded", "nodes"] as const).map((key) => (
            <div key={key} className="rounded-lg border bg-card p-3" title={t(`linuxRules.totalsHint.${key}`)}>
              <div className="text-2xl font-bold">{totals?.[key] ?? 0}</div>
              <div className="text-sm text-muted-foreground">{t(`linuxRules.totals.${key}`)}</div>
            </div>
          ))}
        </div>
        {!!totals?.evaluating && (
          <p className="text-sm text-muted-foreground">⏳ {t("linuxRules.evaluating", { count: totals.evaluating })}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("linuxRules.howItWorks")}{" "}
          <Link href="/patches/updates?os=linux" className="text-blue-500 hover:underline">{t("linuxRules.toFleet")}</Link>
        </p>
        {example && (
          <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-3 text-sm">{t("linuxRules.exampleHint", { name: example.name })}</div>
        )}
        {noSecurity.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-600 dark:text-amber-400">
            {t("linuxRules.noSecurityData", { releases: noSecurity.map((r) => `${r.release} (${r.package_manager ?? "?"})`).join(", ") })}
          </div>
        )}

        {/* The rules */}
        {rules.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">{t("linuxRules.empty")}</div>
        ) : (
          <div className="rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[8%]">{t("linuxRules.col.enabled")}</TableHead>
                  <TableHead className="w-[22%]">{t("linuxRules.col.rule")}</TableHead>
                  <TableHead className="w-[26%]">{t("linuxRules.col.scope")}</TableHead>
                  <TableHead className="w-[22%]">{t("linuxRules.col.match")}</TableHead>
                  <TableHead className="w-[10%]">{t("linuxRules.col.age")}</TableHead>
                  <TableHead className="w-[12%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id} className={rule.enabled ? undefined : "opacity-60"}>
                    <TableCell>
                      <Checkbox aria-label={t("linuxRules.enable", { name: rule.name })} checked={rule.enabled} disabled={!canWrite}
                        onCheckedChange={(checked) => toggle(rule, checked === true)} />
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{rule.name}</span>
                        <Badge variant="outline" className={rule.action === "exclude" ? "border-red-500/50 text-red-500" : "border-green-500/50 text-green-500"}>
                          {t(`linuxRules.action.${rule.action}`)}
                        </Badge>
                      </div>
                      {rule.description && <div className="text-xs text-muted-foreground">{rule.description}</div>}
                    </TableCell>
                    <TableCell className="whitespace-normal text-sm">{scope(rule)}</TableCell>
                    <TableCell className="whitespace-normal text-sm">{match(rule)}</TableCell>
                    <TableCell className="whitespace-normal text-sm">
                      {rule.action === "approve" ? age(rule.min_age_hours) : "–"}
                      {rule.expedite && <div><Badge variant="outline" className="border-amber-500/50 text-amber-500">{t("linuxRules.expedite")}</Badge></div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => {
                            setSaveError(null); setPreview({ data: null, error: null, loading: false }); setEditing({ id: rule.id, draft: toDraft(rule) });
                          }}>{t("common.edit")}</Button>
                          <Button size="sm" variant="outline" onClick={() => remove(rule)}>{t("common.delete")}</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Deployment rings: delay and pause for the rules */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{t("linuxRules.rings.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("linuxRules.rings.text")}{" "}
            <Link href="/patches?tab=rings" className="text-blue-500 hover:underline">{t("linuxRules.rings.manage")}</Link>
          </p>
          {rings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("linuxRules.rings.none")}</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("linuxRules.rings.name")}</TableHead>
                    <TableHead>{t("linuxRules.rings.nodes")}</TableHead>
                    <TableHead>{t("linuxRules.rings.delay")}</TableHead>
                    <TableHead>{t("linuxRules.rings.state")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rings.map((ring) => (
                    <TableRow key={ring.id}>
                      <TableCell className="font-medium">{ring.name}</TableCell>
                      <TableCell>{ring.node_group_id ? groupName(ring.node_group_id) : t("linuxRules.rings.allNodes")}</TableCell>
                      <TableCell>{age(ring.delay_hours)}</TableCell>
                      <TableCell>
                        {ring.paused
                          ? <Badge variant="outline" className="border-amber-500/50 text-amber-500">{t("linuxRules.rings.pausedState")}</Badge>
                          : <span className="text-muted-foreground">{t("linuxRules.rings.activeState")}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite && (
                          <Button size="sm" variant="outline" onClick={() => pauseRing(ring, !ring.paused)}>
                            {t(ring.paused ? "linuxRules.rings.resume" : "linuxRules.rings.pause")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Releases the agents report, and whether they have security data */}
        {releases.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t("linuxRules.releases.title")}</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              {releases.map((r) => (
                <Badge key={`${r.release}-${r.package_manager}`} variant="outline"
                  className={r.security_data ? undefined : "border-amber-500/50 text-amber-500"}
                  title={r.security_data ? undefined : t("linuxRules.releases.noSecurity")}>
                  {t("linuxRules.releases.item", { release: r.release, manager: r.package_manager ?? "?", count: r.nodes })}
                  {!r.security_data && ` · ${t("linuxRules.releases.noSecurityShort")}`}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Editor with a live preview */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(editing?.id ? "linuxRules.editTitle" : "linuxRules.newTitle")}</DialogTitle>
            <DialogDescription>{t("linuxRules.editText")}</DialogDescription>
          </DialogHeader>
          {d && (
            <div className="space-y-4 text-sm">
              <label className="block space-y-1">
                <span className="font-medium">{t("linuxRules.form.name")}</span>
                <input className={field} value={d.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="font-medium">{t("linuxRules.form.description")}</span>
                <input className={field} value={d.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} />
              </label>
              <fieldset className="space-y-1">
                <legend className="font-medium">{t("linuxRules.form.action")}</legend>
                {(["approve", "exclude"] as const).map((action) => (
                  <label key={action} className="flex items-center gap-2">
                    <input type="radio" name="action" checked={d.action === action} onChange={() => set({ action })} />
                    {t(`linuxRules.form.action_${action}`)}
                  </label>
                ))}
              </fieldset>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 font-medium">{t("linuxRules.form.scope")}</legend>
                <div className="space-y-1">
                  <span>{t("linuxRules.form.rings")}</span>
                  {rings.length === 0 && <p className="text-muted-foreground">{t("linuxRules.rings.none")}</p>}
                  {rings.map((ring) => (
                    <label key={ring.id} className="flex items-center gap-2">
                      <Checkbox checked={d.ring_ids.includes(ring.id)} onCheckedChange={(checked) => set({
                        ring_ids: checked === true ? [...d.ring_ids, ring.id] : d.ring_ids.filter((id) => id !== ring.id) })} />
                      {t("linuxRules.form.ringItem", {
                        name: ring.name, nodes: ring.node_group_id ? groupName(ring.node_group_id) : t("linuxRules.rings.allNodes"),
                        delay: age(ring.delay_hours) })}
                      {ring.paused && <Badge variant="outline" className="border-amber-500/50 text-amber-500">{t("linuxRules.rings.pausedState")}</Badge>}
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">{t("linuxRules.form.ringsHint")}</p>
                </div>
                <label className="block space-y-1">
                  <span>{t("linuxRules.form.group")}</span>
                  <select className={field} value={d.group_id} onChange={(e) => set({ group_id: e.target.value })}>
                    <option value="">{t("linuxRules.form.noGroup")}</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span>{t("linuxRules.form.releases")}</span>
                  <input className={field} value={d.releases} placeholder={t("linuxRules.form.releasesPlaceholder")}
                    onChange={(e) => set({ releases: e.target.value })} />
                </label>
              </fieldset>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 font-medium">{t("linuxRules.form.match")}</legend>
                {d.action === "approve" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2">
                      <Checkbox checked={d.security_only} onCheckedChange={(checked) => set({ security_only: checked === true })} />
                      {t("linuxRules.form.securityOnly")}
                    </label>
                    {d.security_only && (
                      <select className="rounded-md border border-input bg-background px-2 py-1" value={d.min_severity}
                        aria-label={t("linuxRules.form.minSeverity")} onChange={(e) => set({ min_severity: e.target.value })}>
                        <option value="">{t("linuxRules.form.anySeverity")}</option>
                        {SEVERITIES.map((s) => <option key={s} value={s}>{t("linuxRules.form.fromSeverity", { severity: t(`linuxRules.severity.${s}`) })}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <label className="block space-y-1">
                  <span>{t("linuxRules.form.packages")}</span>
                  <input className={field} value={d.packages} placeholder={t("linuxRules.form.packagesPlaceholder")}
                    onChange={(e) => set({ packages: e.target.value })} />
                </label>
                <label className="block space-y-1">
                  <span>{t("linuxRules.form.repositories")}</span>
                  <input className={field} value={d.repositories} placeholder={t("linuxRules.form.repositoriesPlaceholder")}
                    onChange={(e) => set({ repositories: e.target.value })} />
                </label>
                <p className="text-xs text-muted-foreground">{t("linuxRules.form.patternsHint")}</p>
              </fieldset>

              {d.action === "approve" && (
                <fieldset className="space-y-2 rounded-md border p-3">
                  <legend className="px-1 font-medium">{t("linuxRules.form.timing")}</legend>
                  <div className="flex items-center gap-2">
                    <span>{t("linuxRules.form.minAge")}</span>
                    <input type="number" min={0} className="w-24 rounded-md border border-input bg-background px-2 py-1" value={d.age}
                      aria-label={t("linuxRules.form.minAge")} onChange={(e) => set({ age: Math.max(0, Number(e.target.value) || 0) })} />
                    <select className="rounded-md border border-input bg-background px-2 py-1" value={d.age_unit}
                      aria-label={t("linuxRules.form.unit")} onChange={(e) => set({ age_unit: e.target.value as Draft["age_unit"] })}>
                      <option value="days">{t("linuxRules.form.unitDays")}</option>
                      <option value="hours">{t("linuxRules.form.unitHours")}</option>
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("linuxRules.form.minAgeHint")}</p>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={d.expedite} onCheckedChange={(checked) => set({ expedite: checked === true })} />
                    {t("linuxRules.form.expedite")}
                  </label>
                </fieldset>
              )}
              {d.action === "exclude" && <p className="text-muted-foreground">{t("linuxRules.form.excludeHint")}</p>}

              <label className="flex items-center gap-2">
                <Checkbox checked={d.enabled} onCheckedChange={(checked) => set({ enabled: checked === true })} />
                {t("linuxRules.form.enabled")}
              </label>

              {/* What this rule covers on its own, from the server */}
              <div className="rounded-md bg-muted/50 p-3" aria-live="polite">
                <div className="font-medium">{t("linuxRules.preview.title")}</div>
                {preview.error ? <div className="text-red-500">{preview.error}</div>
                  : preview.data ? (
                    <div>
                      {t(d.action === "exclude" ? "linuxRules.preview.exclude" : "linuxRules.preview.approve", {
                        nodes: preview.data.nodes, approved: preview.data.approved, waiting: preview.data.waiting, excluded: preview.data.excluded })}
                      {preview.data.nodes_without_security_data > 0 && (
                        <div className="text-amber-600 dark:text-amber-400">
                          {t("linuxRules.preview.noSecurity", { count: preview.data.nodes_without_security_data })}
                        </div>
                      )}
                    </div>
                  ) : <div className="text-muted-foreground">{t("common.loading")}</div>}
              </div>
              {saveError && <p className="text-red-500">{saveError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button disabled={busy || !d?.name.trim()} onClick={save}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StandardPage>
  );
}
