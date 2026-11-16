"use client";

import { Check, Circle, X } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import type { PasswordRuleCheck } from "@/lib/password-rules";

/** The password rules with a live mark per rule: met, broken, or (history) not checkable here. */
export function PasswordRuleList({ checks, typed }: { checks: PasswordRuleCheck[]; typed: boolean }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-1 text-xs" aria-label={t("account.passwordRules")} data-testid="password-rules">
      {checks.map((check) => {
        const state = !typed || check.ok === null ? "open" : check.ok ? "met" : "broken";
        const Icon = state === "met" ? Check : state === "broken" ? X : Circle;
        const color = state === "met" ? "text-green-500" : state === "broken" ? "text-red-400" : "text-zinc-400";
        return (
          <li key={check.key} className={`flex items-center gap-2 ${color}`} data-state={state}>
            <Icon className={state === "open" ? "h-2 w-2" : "h-3.5 w-3.5"} aria-hidden="true" />
            <span>{t(check.key, check.params)}</span>
          </li>
        );
      })}
    </ul>
  );
}
