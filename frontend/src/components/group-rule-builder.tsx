"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/search-select";

export interface RuleCondition { field: string; op: string; value: string | boolean }
export interface GroupRule { operator: "AND" | "OR"; conditions: RuleCondition[] }

/** The fields the rule evaluator fills (backend RULE_FIELDS) and the operators that make sense for each */
const TEXT_OPS = ["equals", "not_equals", "contains", "not_contains", "startswith", "endswith", "regex"];
const VERSION_OPS = [...TEXT_OPS, "gte", "lte", "gt", "lt"];
export const RULE_FIELDS: Record<string, string[]> = {
  hostname: TEXT_OPS,
  os_name: TEXT_OPS,
  os_version: VERSION_OPS,
  os_build: VERSION_OPS,
  agent_version: VERSION_OPS,
  domain: TEXT_OPS,
  is_domain_joined: ["equals"],
  tags: ["has_tag"],
};

export const EMPTY_RULE: GroupRule = { operator: "AND", conditions: [{ field: "hostname", op: "startswith", value: "" }] };

/** Whether every condition has a value (an empty text would match everything or nothing) */
export function ruleComplete(rule: GroupRule): boolean {
  return rule.conditions.length > 0 && rule.conditions.every((c) => typeof c.value === "boolean" || String(c.value).trim() !== "");
}

interface Preview { matchingCount: number; totalNodes: number; matching: Array<{ id: string; hostname: string }> }

/** Rule builder for a dynamic group: all or any of the conditions, one row per condition, and a live
 *  preview of the nodes it matches (POST /groups/preview-rule, a moment after the last change). */
export function GroupRuleBuilder({ rule, onChange }: { rule: GroupRule; onChange: (rule: GroupRule) => void }) {
  const { t } = useI18n();
  const r = (key: string, params?: Record<string, string | number>) => t(`groupRule.${key}`, params);
  const [tags, setTags] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<{ tags: Array<{ name: string }> }>("/tags", { showErrorToast: false }).then((res) => setTags((res?.tags ?? []).map((x) => x.name)));
  }, []);

  useEffect(() => {
    if (!ruleComplete(rule)) { setPreview(null); return; }
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const res = await apiClient.request<Preview>("/groups/preview-rule", {
        method: "POST", body: JSON.stringify({ rule }), headers: { "Content-Type": "application/json" }, showErrorToast: false });
      setPreviewing(false);
      if (res.ok && res.data) { setPreview(res.data); setError(null); } else { setPreview(null); setError(res.error); }
    }, 400);
    return () => clearTimeout(timer);
  }, [JSON.stringify(rule)]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (i: number, patch: Partial<RuleCondition>) =>
    onChange({ ...rule, conditions: rule.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setField = (i: number, field: string) => {
    const op = RULE_FIELDS[field][0];
    set(i, { field, op: field === "tags" ? "has_tag" : RULE_FIELDS[field].includes(rule.conditions[i].op) ? rule.conditions[i].op : op,
             value: field === "is_domain_joined" ? true : "" });
  };
  const input = "h-8 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span>{r("match")}</span>
        <select value={rule.operator} onChange={(e) => onChange({ ...rule, operator: e.target.value as "AND" | "OR" })}
          aria-label={r("operator")} className={input}>
          <option value="AND">{r("all")}</option>
          <option value="OR">{r("any")}</option>
        </select>
        <span>{r("ofTheseConditions")}</span>
      </div>
      <div className="space-y-2">
        {rule.conditions.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={c.field} onChange={(e) => setField(i, e.target.value)} aria-label={r("field", { n: i + 1 })} className={input}>
              {Object.keys(RULE_FIELDS).map((f) => <option key={f} value={f}>{r(`fields.${f}`)}</option>)}
            </select>
            <select value={c.op} onChange={(e) => set(i, { op: e.target.value })} aria-label={r("op", { n: i + 1 })} className={input}>
              {RULE_FIELDS[c.field].map((o) => <option key={o} value={o}>{r(`ops.${o}`)}</option>)}
            </select>
            {c.field === "is_domain_joined" ? (
              <select value={String(c.value)} onChange={(e) => set(i, { value: e.target.value === "true" })} aria-label={r("value", { n: i + 1 })} className={input}>
                <option value="true">{r("yes")}</option>
                <option value="false">{r("no")}</option>
              </select>
            ) : c.field === "tags" ? (
              <div className="w-56">
                <SearchSelect options={tags.map((tag) => ({ id: tag, label: tag }))} value={c.value ? String(c.value) : null}
                  onChange={(id) => set(i, { value: id ?? "" })} label={r("value", { n: i + 1 })} placeholder={r("chooseTag")} />
              </div>
            ) : (
              <input value={String(c.value)} onChange={(e) => set(i, { value: e.target.value })} aria-label={r("value", { n: i + 1 })}
                placeholder={r(`placeholders.${c.field}`)} className={`${input} w-56`} />
            )}
            <Button type="button" size="sm" variant="ghost" aria-label={r("remove", { n: i + 1 })} disabled={rule.conditions.length === 1}
              onClick={() => onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline"
        onClick={() => onChange({ ...rule, conditions: [...rule.conditions, { field: "os_name", op: "contains", value: "" }] })}>
        <Plus aria-hidden="true" />{r("add")}
      </Button>
      {/* what the rule matches now - the members the group gets when saved */}
      <div role="status" className="text-sm">
        {!ruleComplete(rule) ? <span className="text-muted-foreground">{r("incomplete")}</span>
          : previewing && !preview ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{r("previewing")}</span>
          : error ? <span className="text-red-500">{error}</span>
          : preview ? (
            <span>
              {r("matches", { count: preview.matchingCount, total: preview.totalNodes })}
              {preview.matching.length > 0 && (
                <span className="text-muted-foreground"> {preview.matching.slice(0, 8).map((n) => n.hostname).join(", ")}{preview.matching.length > 8 ? ", …" : ""}</span>
              )}
            </span>
          ) : null}
      </div>
    </div>
  );
}
