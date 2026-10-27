"use client";

import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ChangePasswordDialog() {
  const { logout } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (next !== confirm) {
      toast.error(t("account.passwordMismatch"));
      return;
    }
    if (next.length < 12) {
      toast.error(t("account.passwordLength"));
      return;
    }
    setSaving(true);
    try {
      const result = await apiClient.request<{ status: string }>("/api/v1/auth/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
        showErrorToast: false,
      });
      if (!result.ok) {
        toast.error(result.error || t("account.passwordError"));
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setOpen(false);
      toast.success(t("account.passwordChanged"));
      logout(); // The server revoked this and every other access token.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="p-1.5 text-zinc-400 hover:text-white transition-colors"
          title={t("account.changePassword")} aria-label={t("account.changePassword")}>
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("account.changePassword")}</DialogTitle>
          <DialogDescription>{t("account.passwordHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            {t("account.currentPassword")}
            <input type="password" autoComplete="current-password" required value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2" />
          </label>
          <label className="block text-sm">
            {t("account.newPassword")}
            <input type="password" autoComplete="new-password" required minLength={12} value={next}
              onChange={(event) => setNext(event.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2" />
          </label>
          <label className="block text-sm">
            {t("account.confirmPassword")}
            <input type="password" autoComplete="new-password" required value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2" />
          </label>
          <Button type="submit" disabled={saving}>{t("account.savePassword")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
