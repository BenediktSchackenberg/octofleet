"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-context";

/** As stored by the backend (security_hardening.py); null for agents that do not report it yet. */
export interface AppControlData {
  kernelMode: State;
  userMode: State;
  vulnerableDriverBlocklist: "on" | "off" | "unknown";
  /** "citool": names and flags; "files": ids of the active policy files only */
  policySource?: string | null;
  policies?: {
    policyId?: string | null;
    name?: string | null;
    version?: string | null;
    systemPolicy?: boolean | null;
    signed?: boolean | null;
    enforced?: boolean | null;
    supplemental?: boolean | null;
  }[] | null;
  error?: string | null;
}

export interface AppLockerData {
  collections: { type: string; state: State; mode?: string | null; ruleCount?: number | null }[];
  appIdSvc: "running" | "stopped" | "unknown";
  error?: string | null;
}

export interface VbsData {
  status: State;
  services: Record<string, State>;
  error?: string | null;
}

type State = "enforced" | "audit" | "off" | "on" | "running" | "notRunning" | "unknown";

const GOOD = new Set(["enforced", "running", "on"]);
const PARTIAL = new Set(["audit", "notRunning"]);
const VBS_SERVICES = ["credentialGuard", "hvci", "systemGuard"];

function StateBadge({ state }: { state: string | undefined }) {
  const { t } = useI18n();
  const value = state || "unknown";
  if (GOOD.has(value)) return <Badge>{t(`nodeDetail.hardening.state.${value}`)}</Badge>;
  if (PARTIAL.has(value)) {
    return <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">{t(`nodeDetail.hardening.state.${value}`)}</Badge>;
  }
  if (value === "off") return <Badge variant="secondary">{t("nodeDetail.hardening.state.off")}</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{t("nodeDetail.hardening.state.unknown")}</Badge>;
}

function Row({ label, state, title }: { label: string; state: string | undefined; title?: string }) {
  return (
    <div className="flex justify-between items-center gap-4">
      <span className="text-muted-foreground" title={title}>{label}</span>
      <StateBadge state={state} />
    </div>
  );
}

function ErrorNote({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <p className="text-xs text-muted-foreground" title={error}>{t("nodeDetail.hardening.probeFailed")}</p>;
}

/** App Control for Business (WDAC), AppLocker and virtualization-based security of a Windows node (display only). */
export function NodeAppControl({ appControl, appLocker, vbs }: {
  appControl?: AppControlData | null;
  appLocker?: AppLockerData | null;
  vbs?: VbsData | null;
}) {
  const { t } = useI18n();
  const policies = appControl?.policies ?? null;
  const appLockerActive = appLocker?.collections.some((c) => c.state === "enforced" || c.state === "audit");

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader><CardTitle>🧩 {t("nodeDetail.hardening.appControl")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {appControl ? (
            <>
              <Row label={t("nodeDetail.hardening.kernelMode")} state={appControl.kernelMode} />
              <Row label={t("nodeDetail.hardening.userMode")} state={appControl.userMode} />
              <Row label={t("nodeDetail.hardening.driverBlocklist")} state={appControl.vulnerableDriverBlocklist} title="VulnerableDriverBlocklistEnable" />{/* i18n-ignore */}
              <div className="pt-2">
                <p className="text-sm text-muted-foreground mb-1">
                  {t("nodeDetail.hardening.activePolicies")}{policies ? ` (${policies.length})` : ""}
                </p>
                {policies === null ? (
                  <p className="text-sm text-muted-foreground">{t("nodeDetail.hardening.state.unknown")}</p>
                ) : policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("common.none")}</p>
                ) : (
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {policies.map((p, i) => (
                      <li key={p.policyId ?? i} className="flex flex-wrap items-center gap-1 text-sm">
                        <span className={p.name ? "" : "font-mono text-xs"} title={p.policyId ?? undefined}>{p.name || p.policyId}</span>
                        {p.version && <span className="text-xs text-muted-foreground">{p.version}</span>}
                        {p.systemPolicy && <Badge variant="outline">{t("nodeDetail.hardening.systemPolicy")}</Badge>}
                        {p.supplemental === true && <Badge variant="outline">{t("nodeDetail.hardening.supplemental")}</Badge>}
                        {p.supplemental === false && !p.systemPolicy && <Badge variant="outline">{t("nodeDetail.hardening.base")}</Badge>}
                        {p.signed && <Badge variant="outline">{t("nodeDetail.hardening.signed")}</Badge>}
                        {p.enforced === false && <Badge variant="secondary">{t("nodeDetail.hardening.notEnforced")}</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
                {appControl.policySource === "files" && (policies?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">{t("nodeDetail.hardening.policyFilesOnly")}</p>
                )}
              </div>
              <ErrorNote error={appControl.error} />
            </>
          ) : (
            <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>📋 AppLocker</CardTitle></CardHeader>{/* i18n-ignore */}
        <CardContent className="space-y-2">
          {appLocker ? (
            <>
              {appLocker.collections.map((c) => (
                <div key={c.type} className="flex justify-between items-center gap-4">
                  <span className="text-muted-foreground" title={c.mode ? `EnforcementMode = ${c.mode}` : undefined}>{/* i18n-ignore */}
                    {t(`nodeDetail.hardening.collection.${c.type}`)}
                  </span>
                  <span className="flex items-center gap-2">
                    {(c.ruleCount ?? 0) > 0 && (
                      <span className="text-xs text-muted-foreground">{t("nodeDetail.hardening.rules", { count: c.ruleCount ?? 0 })}</span>
                    )}
                    <StateBadge state={c.state} />
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center gap-4 pt-2">
                <span className="text-muted-foreground" title="AppIDSvc">{t("nodeDetail.hardening.appIdSvc")}</span>{/* i18n-ignore */}
                {appLocker.appIdSvc === "running" ? (
                  <Badge>{t("common.active")}</Badge>
                ) : appLocker.appIdSvc === "stopped" ? (
                  <Badge variant="secondary">{t("common.inactive")}</Badge>
                ) : (
                  <StateBadge state="unknown" />
                )}
              </div>
              {appLockerActive && appLocker.appIdSvc === "stopped" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t("nodeDetail.hardening.appIdSvcStopped")}</p>
              )}
              <ErrorNote error={appLocker.error} />
            </>
          ) : (
            <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>🧱 {t("nodeDetail.hardening.vbs")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {vbs ? (
            <>
              <Row label={t("nodeDetail.hardening.vbsStatus")} state={vbs.status} />
              {VBS_SERVICES.map((service) => (
                <Row key={service} label={t(`nodeDetail.hardening.service.${service}`)} state={vbs.services?.[service]} />
              ))}
              <ErrorNote error={vbs.error} />
            </>
          ) : (
            <p className="text-muted-foreground">{t("nodeDetail.noData")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
