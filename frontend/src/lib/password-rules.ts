"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

/** The server's password rules (GET /auth/password-rules), readable for every signed-in user. */
export interface PasswordRules {
  min_length: number;
  max_bytes: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_symbol: boolean;
  history_count: number;
}

/** Used until the rules are loaded, and if loading fails: the server's defaults. */
export const DEFAULT_PASSWORD_RULES: PasswordRules = {
  min_length: 12, max_bytes: 72, require_uppercase: false, require_lowercase: false,
  require_digit: false, require_symbol: false, history_count: 0,
};

export function usePasswordRules(): PasswordRules {
  const [rules, setRules] = useState(DEFAULT_PASSWORD_RULES);
  useEffect(() => {
    let active = true;
    apiClient.request<PasswordRules>("/auth/password-rules", { showErrorToast: false }).then((result) => {
      if (active && result.ok && result.data) setRules({ ...DEFAULT_PASSWORD_RULES, ...result.data });
    });
    return () => { active = false; };
  }, []);
  return rules;
}

/** One line of the rule list: `ok` is null for rules the browser cannot check (history). */
export interface PasswordRuleCheck {
  key: string;
  params?: Record<string, string | number>;
  ok: boolean | null;
}

export interface PasswordContext {
  username?: string;
  /** The current password, typed by the user; the rule is listed only when it is given. */
  current?: string;
  /** List the history rule (changes and resets; not for new users). */
  history?: boolean;
}

/** The same checks as the server's validate_password, in the same order. */
export function checkPassword(rules: PasswordRules, password: string, context: PasswordContext = {}): PasswordRuleCheck[] {
  const checks: PasswordRuleCheck[] = [
    // Python counts code points, not UTF-16 units
    { key: "account.ruleMinLength", params: { min: rules.min_length }, ok: [...password].length >= rules.min_length },
  ];
  if (new TextEncoder().encode(password).length > rules.max_bytes) {
    checks.push({ key: "account.ruleMaxBytes", params: { max: rules.max_bytes }, ok: false });
  }
  const classes: [boolean, RegExp, string][] = [
    [rules.require_uppercase, /[A-Z]/, "account.ruleUppercase"],
    [rules.require_lowercase, /[a-z]/, "account.ruleLowercase"],
    [rules.require_digit, /[0-9]/, "account.ruleDigit"],
    [rules.require_symbol, /[^A-Za-z0-9]/, "account.ruleSymbol"],
  ];
  for (const [required, pattern, key] of classes) {
    if (required) checks.push({ key, ok: pattern.test(password) });
  }
  if (context.username !== undefined) {
    checks.push({ key: "account.ruleNotUsername",
      ok: !password || password.toLowerCase() !== context.username.toLowerCase() });
  }
  if (context.current !== undefined) {
    checks.push({ key: "account.ruleNotCurrent", ok: !password || !context.current || password !== context.current });
  }
  if (context.history && rules.history_count > 0) {
    checks.push({ key: "account.ruleHistory", params: { count: rules.history_count }, ok: null });
  }
  return checks;
}

/** The first rule a password breaks, or null when the browser finds none. */
export function firstBrokenRule(checks: PasswordRuleCheck[]): PasswordRuleCheck | null {
  return checks.find((check) => check.ok === false) ?? null;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The server answers 400 with English text (password_policy.validate_password). Shown translated
 * when known; unknown text is shown as it came, so a new server rule is never hidden.
 */
export function translatePasswordError(t: Translate, error: string | null | undefined): string {
  const text = (error ?? "").trim();
  if (!text) return t("account.passwordError");
  const length = text.match(/^Password must be at least (\d+) characters and at most (\d+) bytes$/);
  if (length) return t("account.passwordLengthRange", { min: length[1], max: length[2] });
  const missing: Record<string, string> = {
    "uppercase letter": "account.ruleUppercase", "lowercase letter": "account.ruleLowercase",
    digit: "account.ruleDigit", symbol: "account.ruleSymbol",
  };
  const contain = text.match(/^Password must contain an? (.+)$/);
  if (contain && missing[contain[1]]) return t("account.passwordRuleBroken", { rule: t(missing[contain[1]]) });
  if (text === "Password must differ from username") {
    return t("account.passwordRuleBroken", { rule: t("account.ruleNotUsername") });
  }
  const known: Record<string, string> = {
    "Choose a different password": "account.passwordNotDifferent",
    "Password was used recently": "account.passwordUsedRecently",
  };
  return known[text] ? t(known[text]) : text;
}
