"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n-context";
import { formatDateTime, formatNumber } from "@/lib/format";

/**
 * JSON data (job command data, audit log details) as readable fields:
 * "Action: reboot · At: 23.11.2026, 22:42 · Message: –", with the raw JSON behind "Show raw".
 *
 * Known keys have a label in `jsonDetails.keys`; other keys are spelled out ("deleteAfter" →
 * "Delete after"). Times are shown in local time, job and node IDs link to their pages.
 */

type T = (key: string, params?: Record<string, string | number>) => string;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Older servers sent JSON text inside JSON; parse it (twice at most) */
export function parseJsonValue(value: unknown): unknown {
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) break;
    try {
      value = JSON.parse(text);
    } catch {
      break;
    }
  }
  return value;
}

/** "deleteAfter" / "delete_after" → "Delete after"; "job_id" → "Job ID" */
function spellOut(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase()
    .replace(/\b(id|ip|url|kb|cve|os)\b/g, (w) => w.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function keyLabel(t: T, key: string): string {
  const id = `jsonDetails.keys.${key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}`;
  const label = t(id);
  return label === id ? spellOut(key) : label;
}

/** A value as text: "–" for empty, local time for ISO times, compact JSON for nested data */
export function formatJsonValue(t: T, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return ISO_DATE_TIME.test(value) ? formatDateTime(value) : value;
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== "object")) {
    return value.length ? value.map((v) => formatJsonValue(t, v)).join(", ") : "–";
  }
  return JSON.stringify(value);
}

function linkFor(key: string, value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  const k = key.toLowerCase().replace(/_/g, "");
  if (k === "jobid") return `/jobs/${value}`;
  if (k === "nodeid" || k === "nodeuuid") return `/nodes/${value}`;
  return null;
}

/** One line for tables: "Action: reboot · Message: –" (the first `max` fields) */
export function summarizeJson(t: T, raw: unknown, max = 3): string {
  const value = parseJsonValue(raw);
  if (value === null || value === undefined) return "–";
  if (typeof value !== "object" || Array.isArray(value)) return formatJsonValue(t, value);
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "–";
  const shown = entries.slice(0, max).map(([k, v]) => `${keyLabel(t, k)}: ${formatJsonValue(t, v)}`);
  return shown.join(" · ") + (entries.length > max ? " · …" : "");
}

export function JsonDetails({ value: raw, className = "" }: { value: unknown; className?: string }) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);
  const value = parseJsonValue(raw);
  if (value === null || value === undefined || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length)) {
    return <span className="text-muted-foreground">–</span>;
  }
  const isObject = typeof value === "object" && !Array.isArray(value);

  return (
    <div className={`space-y-2 ${className}`}>
      {isObject ? (
        <dl className="grid grid-cols-[minmax(7rem,max-content)_1fr] gap-x-4 gap-y-1 text-sm">
          {Object.entries(value as Record<string, unknown>).map(([k, v]) => {
            const href = linkFor(k, v);
            const text = formatJsonValue(t, v);
            const nested = v !== null && typeof v === "object" && text.startsWith("{");
            return (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{keyLabel(t, k)}</dt>
                <dd className={`break-words ${nested ? "font-mono text-xs" : ""}`}>
                  {href ? <Link href={href} className="text-blue-400 hover:underline font-mono">{text}</Link> : text}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="text-sm break-words">{formatJsonValue(t, value)}</div>
      )}
      <button type="button" onClick={() => setShowRaw(!showRaw)} className="text-xs text-blue-400 hover:underline">
        {showRaw ? t("jsonDetails.hideRaw") : t("jsonDetails.showRaw")}
      </button>
      {showRaw && (
        <pre className="bg-zinc-950 rounded p-3 text-xs overflow-x-auto max-h-64">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
