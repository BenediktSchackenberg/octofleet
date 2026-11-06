"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface RemediationPackageForm {
  id?: number;
  name: string;
  description: string;
  target_software: string;
  min_fixed_version: string;
  fix_method: "winget" | "choco" | "script" | "package";
  fix_command: string;
  package_id: string;
  enabled: boolean;
}

export interface RemediationRuleForm {
  id?: number;
  name: string;
  description: string;
  min_severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  software_pattern: string;
  auto_remediate: boolean;
  require_approval: boolean;
  maintenance_window_only: boolean;
  enabled: boolean;
}

const EMPTY_PACKAGE: RemediationPackageForm = {
  name: "", description: "", target_software: "", min_fixed_version: "",
  fix_method: "winget", fix_command: "", package_id: "", enabled: true,
};

// Approval stays required by default (#197); nothing is fixed automatically unless chosen.
const EMPTY_RULE: RemediationRuleForm = {
  name: "", description: "", min_severity: "HIGH", software_pattern: "",
  auto_remediate: false, require_approval: true, maintenance_window_only: true, enabled: true,
};

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

/** Create (POST, with the server's error message) or update (PATCH); apiClient returns null on errors instead of throwing. */
async function saveEntity(path: string, id: number | undefined, body: unknown): Promise<string | null> {
  if (id) {
    const updated = await apiClient.patch(`${path}/${id}`, body, { showErrorToast: false });
    return updated ? null : "";
  }
  const created = await apiClient.richPost(path, body, { showErrorToast: false });
  return created.ok ? null : (created.error || "");
}

/** Delete button that asks for a second click instead of a browser confirm dialog. */
function DeleteButton({ onDelete, busy }: { onDelete: () => void; busy: boolean }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  return armed ? (
    <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
      {t("remediation.form.confirmDelete")}
    </Button>
  ) : (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setArmed(true)}>
      {t("remediation.form.delete")}
    </Button>
  );
}

/** Create or edit a fix package (what to run for which software). */
export function PackageDialog({ open, initial, onClose, onSaved }: {
  open: boolean; initial: RemediationPackageForm | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<RemediationPackageForm>(EMPTY_PACKAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(initial ?? EMPTY_PACKAGE); setError(null); } }, [open, initial]);
  const set = <K extends keyof RemediationPackageForm>(key: K, value: RemediationPackageForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const needsCommand = form.fix_method !== "package";
  const valid = form.name.trim() && form.target_software.trim()
    && (needsCommand ? form.fix_command.trim() : form.package_id.trim());

  const save = async () => {
    setBusy(true); setError(null);
    const body = {
      name: form.name.trim(), description: form.description.trim() || null,
      target_software: form.target_software.trim(), min_fixed_version: form.min_fixed_version.trim() || null,
      fix_method: form.fix_method,
      fix_command: needsCommand ? form.fix_command.trim() : null,
      package_id: needsCommand ? null : form.package_id.trim(),
      enabled: form.enabled,
    };
    const failure = await saveEntity("/remediation/packages", form.id, body);
    setBusy(false);
    if (failure !== null) { setError(failure || t("remediation.form.saveFailed")); return; }
    onSaved(); onClose();
  };

  const remove = async () => {
    if (!form.id) return;
    setBusy(true); setError(null);
    const deleted = await apiClient.delete(`/remediation/packages/${form.id}`, { showErrorToast: false });
    setBusy(false);
    // A package with jobs cannot be deleted yet (job history references it); disabling keeps the history.
    if (!deleted) { setError(t("remediation.form.deleteFailedInUse")); return; }
    onSaved(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? t("remediation.package.editTitle") : t("remediation.package.createTitle")}</DialogTitle>
          <DialogDescription>{t("remediation.package.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pkg-name">{t("remediation.package.name")}</Label>
            <Input id="pkg-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="7-Zip (winget)" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pkg-target">{t("remediation.package.targetSoftware")}</Label>
            <Input id="pkg-target" value={form.target_software} onChange={(e) => set("target_software", e.target.value)} placeholder="7-Zip" />
            <p className="text-xs text-muted-foreground">{t("remediation.package.targetSoftwareHelp")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pkg-method">{t("remediation.package.method")}</Label>
            <select id="pkg-method" className={selectClass} value={form.fix_method}
              onChange={(e) => set("fix_method", e.target.value as RemediationPackageForm["fix_method"])}>
              <option value="winget">winget</option>
              <option value="choco">Chocolatey</option>
              <option value="script">{t("remediation.package.methodScript")}</option>
              <option value="package">{t("remediation.package.methodPackage")}</option>
            </select>
          </div>
          {needsCommand ? (
            <div className="space-y-1">
              <Label htmlFor="pkg-command">{t("remediation.package.command")}</Label>
              <Textarea id="pkg-command" rows={2} className="font-mono text-xs" value={form.fix_command}
                onChange={(e) => set("fix_command", e.target.value)}
                placeholder={form.fix_method === "choco" ? "choco upgrade 7zip -y"
                  : "winget upgrade --id 7zip.7zip --exact --silent --accept-source-agreements --accept-package-agreements"} />
              {form.fix_method === "script" && (
                <p className="text-xs text-amber-400">{t("remediation.package.scriptWarning")}</p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="pkg-package">{t("remediation.package.packageId")}</Label>
              <Input id="pkg-package" value={form.package_id} onChange={(e) => set("package_id", e.target.value)} className="font-mono text-xs" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="pkg-min">{t("remediation.package.minFixedVersion")}</Label>
            <Input id="pkg-min" value={form.min_fixed_version} onChange={(e) => set("min_fixed_version", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pkg-desc">{t("remediation.form.descriptionField")}</Label>
            <Input id="pkg-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} /> {t("remediation.form.enabled")}
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>{form.id && <DeleteButton onDelete={remove} busy={busy} />}</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t("remediation.form.cancel")}</Button>
            <Button type="button" onClick={save} disabled={busy || !valid}>{t("remediation.form.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Create or edit a rule (which vulnerabilities become remediation jobs, and whether they need approval). */
export function RuleDialog({ open, initial, onClose, onSaved }: {
  open: boolean; initial: RemediationRuleForm | null; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<RemediationRuleForm>(EMPTY_RULE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(initial ?? EMPTY_RULE); setError(null); } }, [open, initial]);
  const set = <K extends keyof RemediationRuleForm>(key: K, value: RemediationRuleForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true); setError(null);
    const body = {
      name: form.name.trim(), description: form.description.trim() || null,
      min_severity: form.min_severity, software_pattern: form.software_pattern.trim() || null,
      auto_remediate: form.auto_remediate, require_approval: form.require_approval,
      maintenance_window_only: form.maintenance_window_only, enabled: form.enabled,
    };
    const failure = await saveEntity("/remediation/rules", form.id, body);
    setBusy(false);
    if (failure !== null) { setError(failure || t("remediation.form.saveFailed")); return; }
    onSaved(); onClose();
  };

  const remove = async () => {
    if (!form.id) return;
    setBusy(true); setError(null);
    const deleted = await apiClient.delete(`/remediation/rules/${form.id}`, { showErrorToast: false });
    setBusy(false);
    if (!deleted) { setError(t("remediation.form.deleteFailedInUse")); return; }
    onSaved(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? t("remediation.rule.editTitle") : t("remediation.rule.createTitle")}</DialogTitle>
          <DialogDescription>{t("remediation.rule.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rule-name">{t("remediation.rule.name")}</Label>
            <Input id="rule-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-sev">{t("remediation.rule.minSeverity")}</Label>
            <select id="rule-sev" className={selectClass} value={form.min_severity}
              onChange={(e) => set("min_severity", e.target.value as RemediationRuleForm["min_severity"])}>
              {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((s) => (
                <option key={s} value={s}>{t(`nodes.vulnerabilities.severity.${s.toLowerCase()}`)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-pattern">{t("remediation.rule.softwarePattern")}</Label>
            <Input id="rule-pattern" value={form.software_pattern} onChange={(e) => set("software_pattern", e.target.value)} placeholder="7-Zip" />
            <p className="text-xs text-muted-foreground">{t("remediation.rule.softwarePatternHelp")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rule-desc">{t("remediation.form.descriptionField")}</Label>
            <Input id="rule-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.require_approval} onCheckedChange={(v) => set("require_approval", v)} /> {t("remediation.rule.requireApproval")}
          </label>
          {!form.require_approval && <p className="text-xs text-amber-400">{t("remediation.rule.noApprovalWarning")}</p>}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.auto_remediate} onCheckedChange={(v) => set("auto_remediate", v)} /> {t("remediation.rule.autoRemediate")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.maintenance_window_only} onCheckedChange={(v) => set("maintenance_window_only", v)} /> {t("remediation.rule.maintenanceWindowOnly")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} /> {t("remediation.form.enabled")}
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>{form.id && <DeleteButton onDelete={remove} busy={busy} />}</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t("remediation.form.cancel")}</Button>
            <Button type="button" onClick={save} disabled={busy || !form.name.trim()}>{t("remediation.form.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
