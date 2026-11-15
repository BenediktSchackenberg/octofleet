"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { formatDate, formatTime } from "@/lib/format";

/** What happens when an update needs a reboot (Windows and Linux) */
export type RebootPolicy = "no_reboot" | "schedule" | "force";

// The reboot time is chosen from two lists (day, time in 30-minute steps) labelled with the user's
// language, date and time format - a native datetime-local field uses the browser's instead.
const REBOOT_DAYS = 14;
const REBOOT_TIMES = Array.from({ length: 48 }, (_, i) => i * 30); // minutes after midnight

/** The day (0 = today) and minute of the default reboot: today 22:00, or tomorrow if that has passed */
function defaultReboot(): { day: number; minute: number } {
  const d = new Date();
  d.setHours(22, 0, 0, 0);
  return { day: d.getTime() < Date.now() + 5 * 60_000 ? 1 : 0, minute: 22 * 60 };
}

/** Local date of day `day` (0 = today) at `minute` after midnight */
function rebootDate(day: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + day);
  d.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return d;
}

/** State of the reboot choice; `payload(offer)` gives the job fields (no choice offered: never reboot) */
export function useRebootChoice() {
  const [policy, setPolicy] = useState<RebootPolicy>("no_reboot");
  const [day, setDay] = useState(() => defaultReboot().day);
  const [minute, setMinute] = useState(() => defaultReboot().minute);
  const at = rebootDate(day, minute);
  return {
    policy, setPolicy, day, setDay, minute, setMinute,
    /** A time that has passed would mean "reboot right after the installation" on the agent */
    inPast: (offer: boolean) => offer && policy === "schedule" && at.getTime() < Date.now() + 60_000,
    payload(offer: boolean): Record<string, unknown> {
      const p = offer ? policy : "no_reboot";
      // The agent compares the time with the current UTC time: send it with its offset (ISO, UTC)
      return p === "schedule" ? { reboot_policy: p, reboot_schedule_time: at.toISOString() } : { reboot_policy: p };
    },
  };
}

/** The reboot choice: no reboot, at a day and time, one minute after the installation */
export function RebootChoice({ choice, offer, windows }: {
  choice: ReturnType<typeof useRebootChoice>;
  /** Only shown when a reboot can be needed or is pending */
  offer: boolean;
  /** Note that Windows may restart by its own update policy */
  windows: boolean;
}) {
  const { t } = useI18n();
  if (!offer) return null;
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-medium mb-1">{t("nodes.updates.rebootLegend")}</legend>
      {(["no_reboot", "schedule", "force"] as RebootPolicy[]).map((policy) => (
        <label key={policy} className="flex items-center gap-2">
          <input type="radio" name="reboot" value={policy} checked={choice.policy === policy} onChange={() => choice.setPolicy(policy)} />
          {t(`nodes.updates.rebootOption.${policy}`)}
          {policy === "schedule" && choice.policy === "schedule" && (
            <>
              <select value={choice.day} onChange={(e) => choice.setDay(Number(e.target.value))}
                aria-label={t("nodes.updates.rebootDay")}
                className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white">
                {Array.from({ length: REBOOT_DAYS }, (_, day) => (
                  <option key={day} value={day}>
                    {day === 0 ? t("nodes.updates.today") : day === 1 ? t("nodes.updates.tomorrow")
                      : formatDate(rebootDate(day, 0), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                  </option>
                ))}
              </select>
              <select value={choice.minute} onChange={(e) => choice.setMinute(Number(e.target.value))}
                aria-label={t("nodes.updates.rebootAt")}
                className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-white">
                {REBOOT_TIMES.map((minute) => (
                  <option key={minute} value={minute}>{formatTime(rebootDate(0, minute), { hour: "2-digit", minute: "2-digit" })}</option>
                ))}
              </select>
            </>
          )}
        </label>
      ))}
      {choice.inPast(offer) && <p className="text-xs text-red-400">{t("nodes.updates.rebootPast")}</p>}
      {/* Windows can restart by its own update policy, whatever Octofleet does */}
      {windows && <p className="text-xs text-muted-foreground pt-1">{t("nodes.updates.windowsOwnRestart")}</p>}
    </fieldset>
  );
}
