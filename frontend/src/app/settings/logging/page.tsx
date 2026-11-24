"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ScrollText, Save } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";

type Level = "error" | "warning" | "info" | "debug";
type AccessLog = "all" | "errors_slow" | "off";
interface Setting { level: Level; access_log: AccessLog; slow_ms: number; components: Record<string, Level> }
interface Answer extends Setting { component_names: string[] }

const LEVELS: Level[] = ["error", "warning", "info", "debug"];
const ACCESS: AccessLog[] = ["all", "errors_slow", "off"];

function sameSetting(a: Setting, b: Setting) {
  const keys = new Set([...Object.keys(a.components), ...Object.keys(b.components)]);
  return a.level === b.level && a.access_log === b.access_log && a.slow_ms === b.slow_ms
    && [...keys].every((k) => a.components[k] === b.components[k]);
}

/**
 * Admin -> Settings -> Logging: the backend's log level, a level per component (#330) and which HTTP
 * requests get a line. Applies at once, without a restart; the default (info, every request) is how the
 * backend logged before.
 */
export default function LoggingSettingsPage() {
  const { t } = useI18n();
  const { token, hasPermission } = useAuth();
  const canEdit = hasPermission("settings:write");
  const [saved, setSaved] = useState<Setting | null>(null);
  const [draft, setDraft] = useState<Setting | null>(null);
  const [componentNames, setComponentNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiClient.get<Answer>("/settings/logging", { showErrorToast: false }).then((s) => {
      if (s) {
        const components = s.components ?? {};
        setSaved({ ...s, components });
        setComponentNames(s.component_names ?? []);
        setDraft({ level: s.level, access_log: s.access_log, slow_ms: s.slow_ms, components: { ...components } });
      }
    });
  }, [token]);

  function setComponentLevel(name: string, level: string) {
    if (!draft) return;
    const components = { ...draft.components };
    if (level) components[name] = level as Level; else delete components[name];
    setDraft({ ...draft, components });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    const res = await apiClient.request<Answer>("/settings/logging", {
      method: "PUT", body: JSON.stringify(draft), headers: { "Content-Type": "application/json" }, showErrorToast: false,
    });
    setSaving(false);
    if (res.ok && res.data) {
      setSaved(res.data);
      toast.success(t("loggingPage.saved"));
    } else {
      toast.error(t("loggingPage.saveFailed"), { description: res.error ?? undefined });
    }
  }

  const dirty = !!draft && !!saved && !sameSetting(draft, saved);
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <ScrollText className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold">{t("loggingPage.title")}</h1>
            <p className="text-zinc-400 text-sm">{t("loggingPage.subtitle")}</p>
          </div>
        </div>
        {!draft ? (
          <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-6 text-sm">
            <label className="block space-y-1">
              <span className="font-medium">{t("loggingPage.level")}</span>
              <select value={draft.level} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, level: e.target.value as Level })}
                className="block rounded border border-zinc-700 bg-zinc-800 px-2 py-1">
                {LEVELS.map((l) => <option key={l} value={l}>{t(`loggingPage.levels.${l}`)}</option>)}
              </select>
              <span className="block text-xs text-zinc-500">{t("loggingPage.levelHint")}</span>
            </label>

            {componentNames.length > 0 && (
              <div className="space-y-2">
                <div>
                  <span className="font-medium">{t("loggingPage.components")}</span>
                  <span className="block text-xs text-zinc-500">{t("loggingPage.componentsHint")}</span>
                </div>
                <table className="w-full">
                  <tbody>
                    {componentNames.map((c) => (
                      <tr key={c} className="border-t border-zinc-800">
                        <td className="py-1.5 pr-3 align-top"><code className="text-blue-300">[{c}]</code></td>
                        <td className="py-1.5 pr-3 text-zinc-400">{t(`loggingPage.componentInfo.${c}`)}</td>
                        <td className="py-1.5 text-right">
                          <select value={draft.components[c] ?? ""} disabled={!canEdit} aria-label={c}
                            onChange={(e) => setComponentLevel(c, e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1">
                            <option value="">{t("loggingPage.sameAsLevel")}</option>
                            {LEVELS.map((l) => <option key={l} value={l}>{t(`loggingPage.componentLevels.${l}`)}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="font-medium mb-1">{t("loggingPage.accessLog")}</legend>
              {ACCESS.map((a) => (
                <label key={a} className="flex items-center gap-2">
                  <input type="radio" name="access-log" value={a} checked={draft.access_log === a} disabled={!canEdit}
                    onChange={() => setDraft({ ...draft, access_log: a })} />
                  {t(`loggingPage.access.${a}`)}
                  {a === "errors_slow" && draft.access_log === "errors_slow" && (
                    <input type="number" min={10} max={600000} value={draft.slow_ms} disabled={!canEdit}
                      aria-label={t("loggingPage.slowMs")}
                      onChange={(e) => setDraft({ ...draft, slow_ms: Number(e.target.value) })}
                      className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1" />
                  )}
                  {a === "errors_slow" && draft.access_log === "errors_slow" && <span>{t("loggingPage.slowMsUnit")}</span>}
                </label>
              ))}
              <span className="block text-xs text-zinc-500">{t("loggingPage.accessHint")}</span>
            </fieldset>

            <p className="text-xs text-zinc-500">{t("loggingPage.rotationHint")}</p>
            {canEdit && (
              <button type="button" onClick={save} disabled={!dirty || saving}
                className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? t("loggingPage.saving") : t("common.save")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
