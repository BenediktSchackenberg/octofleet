"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function RequiredPasswordChangePage() {
  const { logout } = useAuth();
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || next !== confirm || next.length < 12) {
      toast.error(next !== confirm ? t("account.passwordMismatch") : t("account.passwordLength"));
      return;
    }
    setSaving(true);
    try {
      const result = await apiClient.request<{ status: string }>("/auth/me/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
        showErrorToast: false,
      });
      if (!result.ok) { toast.error(result.error || t("account.passwordError")); return; }
      setCurrent(""); setNext(""); setConfirm("");
      toast.success(t("account.passwordChanged"));
      await logout();
    } finally { setSaving(false); }
  }

  return <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("account.changePassword")}</CardTitle>
        <CardDescription>Your password must be changed before you can continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <label className="block space-y-1 text-sm">{t("account.currentPassword")}
            <Input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">{t("account.newPassword")}
            <Input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">{t("account.confirmPassword")}
            <Input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>{t("account.savePassword")}</Button>
            <Button type="button" variant="outline" onClick={() => logout()}>Sign out</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  </main>;
}
