/**
 * Dates, times and numbers in the language the user selected in the UI, with the user's
 * time format (12/24 hours) and date order.
 *
 * Format dates with the helpers below (formatDateTime, formatDate, formatTime); they follow
 * the language, the time format and the date order, and show "-" for missing or invalid
 * values. Where a locale has to be passed directly (Intl.NumberFormat, chart libraries …),
 * use `localeTag()` – never a fixed tag such as "de-DE". `localeTag()` carries the time
 * format, but not the date order.
 *
 * The I18nProvider keeps the settings here in step with the selected ones, so plain
 * functions (outside components) can use them too. Components that do not read the i18n
 * context pick up a change on their next render.
 */

export type UiLocale = "de" | "en" | "es";
/** "auto" follows the language (English: 12 hours, German and Spanish: 24 hours). */
export type TimeFormat = "auto" | "24h" | "12h";
/** Order of day, month and year in numeric dates; "auto" follows the language. */
export type DateOrder = "auto" | "dmy" | "mdy" | "ymd";

export const TIME_FORMATS: TimeFormat[] = ["auto", "24h", "12h"];
export const DATE_ORDERS: DateOrder[] = ["auto", "dmy", "mdy", "ymd"];

const LOCALE_TAGS: Record<UiLocale, string> = {
  de: "de-DE",
  en: "en-US",
  es: "es-ES",
};

// Separator between day, month and year when the user picks an order.
const DATE_SEPARATORS: Record<Exclude<DateOrder, "auto">, Record<UiLocale, string>> = {
  dmy: { de: ".", en: "/", es: "/" },
  mdy: { de: "/", en: "/", es: "/" },
  ymd: { de: "-", en: "-", es: "-" },
};

const ORDER_PARTS: Record<Exclude<DateOrder, "auto">, Intl.DateTimeFormatPartTypes[]> = {
  dmy: ["day", "month", "year"],
  mdy: ["month", "day", "year"],
  ymd: ["year", "month", "day"],
};

let currentLocale: UiLocale = "de";
let currentTimeFormat: TimeFormat = "auto";
let currentDateOrder: DateOrder = "auto";

/** Called by the I18nProvider whenever the UI language changes. */
export function setFormatLocale(locale: UiLocale): void {
  currentLocale = locale;
}

/** Called by the I18nProvider whenever the user changes the time format or date order. */
export function setFormatPreferences(timeFormat: TimeFormat, dateOrder: DateOrder): void {
  currentTimeFormat = timeFormat;
  currentDateOrder = dateOrder;
}

/** BCP 47 tag for the selected UI language and time format, e.g. "en-US" or "en-US-u-hc-h23". */
export function localeTag(): string {
  const tag = LOCALE_TAGS[currentLocale] ?? LOCALE_TAGS.en;
  if (currentTimeFormat === "24h") return `${tag}-u-hc-h23`;
  if (currentTimeFormat === "12h") return `${tag}-u-hc-h12`;
  return tag;
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const NUMERIC = new Set(["numeric", "2-digit"]);

/** Formats with Intl and, if the user picked a date order, rearranges a numeric date. */
function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  const formatter = new Intl.DateTimeFormat(localeTag(), options);
  if (currentDateOrder === "auto") return formatter.format(date);

  const parts = formatter.formatToParts(date);
  const dateTypes = new Set(["day", "month", "year"]);
  const indices = parts.map((p, i) => (dateTypes.has(p.type) ? i : -1)).filter((i) => i >= 0);
  const month = parts.find((p) => p.type === "month");
  // Only numeric dates with at least day and month; named months keep the language's order.
  if (indices.length < 2 || !month || !NUMERIC.has(options.month ?? "numeric") || !/^\d+$/.test(month.value)) {
    return formatter.format(date);
  }
  const first = indices[0];
  const last = indices[indices.length - 1];
  const values = new Map(parts.filter((p) => dateTypes.has(p.type)).map((p) => [p.type, p.value]));
  const ordered = ORDER_PARTS[currentDateOrder].filter((type) => values.has(type)).map((type) => values.get(type));
  const separator = DATE_SEPARATORS[currentDateOrder][currentLocale] ?? "/";
  const before = parts.slice(0, first).map((p) => p.value).join("");
  // German ends a date without year with a dot ("28.10."); it belongs to the old order.
  const after = parts.slice(last + 1).map((p) => p.value).join("").replace(/^\./, "");
  const trailing = separator === "." && !values.has("year") ? "." : "";
  return before + ordered.join(separator) + trailing + after;
}

// Like toLocaleString() and toLocaleDateString(), but with two-digit day and month
// ("07.03.2020", "03/07/2020"), so dates line up in tables.
const DEFAULT_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", second: "numeric",
};
const DEFAULT_DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
const DEFAULT_TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "numeric", second: "numeric" };

/** Date and time, e.g. "11/06/2026, 5:34:42 PM" (en) or "06.11.2026, 17:34:42" (de). */
export function formatDateTime(value: DateInput, options?: Intl.DateTimeFormatOptions, fallback = "-"): string {
  const date = toDate(value);
  return date ? format(date, options ?? DEFAULT_DATE_TIME) : fallback;
}

/** Date only. */
export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions, fallback = "-"): string {
  const date = toDate(value);
  return date ? format(date, options ?? DEFAULT_DATE) : fallback;
}

/** Time only. */
export function formatTime(value: DateInput, options?: Intl.DateTimeFormatOptions, fallback = "-"): string {
  const date = toDate(value);
  return date ? format(date, options ?? DEFAULT_TIME) : fallback;
}

/** Number with the language's grouping and decimal separators. */
export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions, fallback = "-"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat(localeTag(), options).format(value);
}
