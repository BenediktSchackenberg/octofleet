"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_digit: boolean;
  require_symbol: boolean;
  max_age_days: number | null;
  history_count: number;
}

const initial: PasswordPolicy = {
  min_length: 12, require_uppercase: false, require_lowercase: false,
  require_digit: false, require_symbol: false, max_age_days: null, history_count: 0,
};

export default function SecuritySettingsPage() {
  const { hasPermission } = useAuth();
  const [policy, setPolicy] = useState<PasswordPolicy>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const allowed = hasPermission("settings:write");

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    apiClient.get<PasswordPolicy>("/security/password-policy", { showErrorToast: false })
      .then(data => { if (data) setPolicy(data); else toast.error("Could not load password policy"); })
      .finally(() => setLoading(false));
  }, [allowed]);

  async function save() {
    setSaving(true);
    try {
      const result = await apiClient.put<PasswordPolicy>("/security/password-policy", policy, { showErrorToast: false });
      if (result) { setPolicy(result); toast.success("Password policy saved"); }
      else toast.error("Could not save password policy");
    } finally { setSaving(false); }
  }

  if (!allowed) return <main className="p-6">You do not have permission to edit security settings.</main>;
  return (
    <main className="max-w-2xl p-6 space-y-6">
      <Link href="/settings" className="text-sm text-purple-400">← Settings</Link>
      <div>
        <h1 className="text-2xl font-bold">Security settings</h1>
        <p className="text-sm text-muted-foreground">Password policy for local accounts. Changes apply to new passwords and future sign-ins.</p>
      </div>
      {loading ? <p>Loading…</p> : <div className="space-y-5 rounded-lg border border-zinc-800 p-5">
        <label className="block space-y-1 text-sm">Minimum characters (12–72)
          <Input type="number" min={12} max={72} value={policy.min_length}
            onChange={e => setPolicy({ ...policy, min_length: Number(e.target.value) })} />
        </label>
        {([
          ["require_uppercase", "Require an uppercase letter"],
          ["require_lowercase", "Require a lowercase letter"],
          ["require_digit", "Require a digit"],
          ["require_symbol", "Require a symbol"],
        ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-3 text-sm">
          <Checkbox checked={policy[key]} onCheckedChange={checked => setPolicy({ ...policy, [key]: checked === true })} /> {label}
        </label>)}
        <label className="block space-y-1 text-sm">Maximum age in days (blank means no expiry)
          <Input type="number" min={1} max={3650} value={policy.max_age_days ?? ""}
            onChange={e => setPolicy({ ...policy, max_age_days: e.target.value ? Number(e.target.value) : null })} />
        </label>
        <label className="block space-y-1 text-sm">Previous passwords to block (0–10)
          <Input type="number" min={0} max={10} value={policy.history_count}
            onChange={e => setPolicy({ ...policy, history_count: Number(e.target.value) })} />
        </label>
        <Button onClick={save} disabled={saving || policy.min_length < 12 || policy.min_length > 72 || policy.history_count < 0 || policy.history_count > 10}>Save policy</Button>
      </div>}
    </main>
  );
}
