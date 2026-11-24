"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, Download, Shield } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";

interface Rule {
  rule_name: string;
  rule_type: string;
  expected_value: Record<string, string>;
  severity: string;
  enabled: boolean;
}

interface Template {
  id: string;
  name: string;
  description: string;
  baseline_type: string;
  rule_count: number;
}

const TYPES = ["software", "service", "registry", "firewall", "custom"];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];

export default function CreateBaseline() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baselineType, setBaselineType] = useState("software");
  const [rules, setRules] = useState<Rule[]>([]);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<Template[]>(`/baselines/templates`, { showErrorToast: false })
      .then(r => r || [])
      .then(setTemplates)
      .catch(() => {});
  }, []);

  const importTemplate = async (templateId: string) => {
    setImporting(templateId);
    try {
      const data = await apiClient.post<{ id: string }>(`/baselines/templates/${templateId}/import`, {}, { showErrorToast: false });
      if (data) {
        router.push(`/compliance/baselines/${data.id}`);
      }
    } finally {
      setImporting(null);
    }
  };

  const addRule = () => {
    setRules([...rules, { rule_name: "", rule_type: baselineType, expected_value: {}, severity: "medium", enabled: true }]);
  };

  const updateRule = (idx: number, field: string, value: any) => {
    const updated = [...rules];
    (updated[idx] as any)[field] = value;
    setRules(updated);
  };

  const updateExpected = (idx: number, key: string, value: string) => {
    const updated = [...rules];
    updated[idx].expected_value = { ...updated[idx].expected_value, [key]: value };
    setRules(updated);
  };

  const removeRule = (idx: number) => setRules(rules.filter((_, i) => i !== idx));

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiClient.post<{ id: string }>(`/baselines`, { name, description, baseline_type: baselineType, rules }, { showErrorToast: false });
      if (data) {
        router.push(`/compliance/baselines/${data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const renderRuleFields = (rule: Rule, idx: number) => {
    const ev = rule.expected_value;
    switch (rule.rule_type || baselineType) {
      case "software":
        return (
          <div className="flex gap-2 flex-wrap">
            <input placeholder={t("baselineNew.fields.package")} value={ev.package || ""} onChange={(e) => updateExpected(idx, "package", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm" />
            <select value={ev.operator || "installed"} onChange={(e) => updateExpected(idx, "operator", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm">
              <option value="installed">{t("baselineNew.fields.installed")}</option>
              <option value="not_installed">{t("baselineNew.fields.notInstalled")}</option>
              <option value="version_eq">{t("compliance.columns.version")} ==</option>
              <option value="version_gte">{t("compliance.columns.version")} &gt;=</option>
            </select>
            {(ev.operator === "version_eq" || ev.operator === "version_gte") && (
              <input placeholder={t("compliance.columns.version")} value={ev.version || ""} onChange={(e) => updateExpected(idx, "version", e.target.value)}
                className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm" />
            )}
          </div>
        );
      case "service":
        return (
          <div className="flex gap-2">
            <input placeholder={t("baselineNew.fields.service")} value={ev.service || ""} onChange={(e) => updateExpected(idx, "service", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm" />
            <select value={ev.state || "running"} onChange={(e) => updateExpected(idx, "state", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm">
              <option value="running">{t("baselineNew.fields.running")}</option>
              <option value="stopped">{t("baselineNew.fields.stopped")}</option>
              <option value="disabled">{t("baselineNew.fields.disabled")}</option>
            </select>
          </div>
        );
      case "registry":
        return (
          <div className="flex gap-2 flex-wrap">
            <input placeholder={t("baselineNew.fields.keyPath")} value={ev.key_path || ""} onChange={(e) => updateExpected(idx, "key_path", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm flex-1" />
            <input placeholder={t("baselineNew.fields.valueName")} value={ev.value_name || ""} onChange={(e) => updateExpected(idx, "value_name", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm" />
            <input placeholder={t("baselineNew.fields.expectedValue")} value={ev.expected || ""} onChange={(e) => updateExpected(idx, "expected", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm" />
          </div>
        );
      case "firewall":
        return (
          <div className="flex gap-2 flex-wrap">
            <input placeholder={t("baselineNew.fields.firewallRule")} value={ev.rule_name || ""} onChange={(e) => updateExpected(idx, "rule_name", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm" />
            <select value={ev.direction || "inbound"} onChange={(e) => updateExpected(idx, "direction", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm">
              <option value="inbound">{t("baselineNew.fields.inbound")}</option>
              <option value="outbound">{t("baselineNew.fields.outbound")}</option>
            </select>
            <select value={ev.action || "allow"} onChange={(e) => updateExpected(idx, "action", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm">
              <option value="allow">{t("baselineNew.fields.allow")}</option>
              <option value="block">{t("baselineNew.fields.block")}</option>
            </select>
            <input placeholder={t("baselineNew.fields.port")} value={ev.port || ""} onChange={(e) => updateExpected(idx, "port", e.target.value)}
              className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm w-20" />
          </div>
        );
      default:
        return (
          <input placeholder={t("baselineNew.fields.customJson")} value={JSON.stringify(ev)} onChange={(e) => { try { updateRule(idx, "expected_value", JSON.parse(e.target.value)); } catch {} }}
            className="px-2 py-1 border rounded dark:bg-zinc-800 dark:border-zinc-600 dark:text-white text-sm w-full" />
        );
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold dark:text-white">{t("baselineNew.title")}</h1>

      {/* CIS Templates */}
      {templates.length > 0 && (
        <Card className="dark:bg-zinc-900 dark:border-zinc-700">
          <CardHeader>
            <CardTitle className="dark:text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-500" /> {t("baselineNew.importTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("baselineNew.importText")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((tpl) => (
                <div key={tpl.id} className="border rounded-lg p-4 dark:border-zinc-700 dark:bg-zinc-800 flex flex-col gap-2">
                  <div className="font-medium dark:text-white">{tpl.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex-1">{tpl.description}</div>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="outline" className="dark:border-zinc-600 dark:text-gray-300 text-xs">
                      {t(tpl.rule_count === 1 ? "baselineNew.ruleCountOne" : "baselineNew.ruleCount", { count: tpl.rule_count })}
                    </Badge>
                    <button
                      onClick={() => importTemplate(tpl.id)}
                      disabled={!!importing}
                      className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
                    >
                      <Download className="w-3 h-3" />
                      {importing === tpl.id ? t("baselineNew.importing") : t("baselineNew.import")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative flex items-center justify-center py-2">
        <div className="border-t dark:border-zinc-700 w-full absolute" />
        <span className="bg-white dark:bg-zinc-950 px-4 text-sm text-gray-500 dark:text-gray-400 relative">{t("baselineNew.orManually")}</span>
      </div>

      <Card className="dark:bg-zinc-900 dark:border-zinc-700">
        <CardHeader><CardTitle className="dark:text-white">{t("baselineNew.details")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium dark:text-gray-300 mb-1">{t("common.name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-600 dark:text-white" placeholder={t("baselineNew.namePlaceholder")} />
          </div>
          <div>
            <label className="block text-sm font-medium dark:text-gray-300 mb-1">{t("common.description")}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-600 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium dark:text-gray-300 mb-1">{t("compliance.columns.type")}</label>
            <select value={baselineType} onChange={(e) => setBaselineType(e.target.value)}
              className="px-3 py-2 border rounded-lg dark:bg-zinc-800 dark:border-zinc-600 dark:text-white">
              {TYPES.map((type) => <option key={type} value={type}>{t(`compliance.types.${type}`)}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="dark:bg-zinc-900 dark:border-zinc-700">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="dark:text-white">{t("compliance.columns.rules")}</CardTitle>
          <button onClick={addRule} className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm">
            <Plus className="w-3 h-3" /> {t("baselineNew.addRule")}
          </button>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.length === 0 && <p className="text-gray-500 dark:text-gray-400 text-center py-4">{t("baselineNew.noRules")}</p>}
          {rules.map((rule, idx) => (
            <div key={idx} className="border rounded-lg p-3 dark:border-zinc-700 dark:bg-zinc-800 space-y-2">
              <div className="flex items-center gap-2">
                <input placeholder={t("baselineNew.ruleName")} value={rule.rule_name} onChange={(e) => updateRule(idx, "rule_name", e.target.value)}
                  className="flex-1 px-2 py-1 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white text-sm" />
                <select value={rule.severity} onChange={(e) => updateRule(idx, "severity", e.target.value)}
                  className="px-2 py-1 border rounded dark:bg-zinc-700 dark:border-zinc-600 dark:text-white text-sm">
                  {SEVERITIES.map((s) => <option key={s} value={s}>{t(`compliance.severity.${s}`)}</option>)}
                </select>
                <button onClick={() => removeRule(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
              </div>
              {renderRuleFields(rule, idx)}
            </div>
          ))}
        </CardContent>
      </Card>

      <button onClick={save} disabled={saving || !name}
        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
        <Save className="w-4 h-4" /> {saving ? t("baselineNew.saving") : t("baselineNew.save")}
      </button>
    </div>
  );
}
