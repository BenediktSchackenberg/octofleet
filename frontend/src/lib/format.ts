/**
 * Dates, times and numbers in the language the user selected in the UI.
 *
 * Use `localeTag()` wherever a locale is passed to `toLocaleString`, `toLocaleDateString`,
 * `toLocaleTimeString` or `Intl.*` – never a fixed tag such as "de-DE". The helpers below
 * cover the common cases and show "-" for missing or invalid values.
 *
 * The I18nProvider keeps the language here in step with the selected one, so plain
 * functions (outside components) can use it too. Components that do not read the i18n
 * context pick up a language change on their next render.
 */

export type UiLocale = "de" | "en" | "es";

const LOCALE_TAGS: Record<UiLocale, string> = {
  de: "de-DE",
  en: "en-US",
  es: "es-ES",
};

let currentLocale: UiLocale = "de";

/** Called by the I18nProvider whenever the UI language changes. */
export function setFormatLocale(locale: UiLocale): void {
  currentLocale = locale;
}

/** BCP 47 tag for the selected UI language, e.g. "en-US". */
export function localeTag(): string {
  return LOCALE_TAGS[currentLocale] ?? LOCALE_TAGS.en;
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date and time, e.g. "11/6/2026, 5:34:42 PM" (en) or "6.11.2026, 17:34:42" (de). */
export function formatDateTime(value: DateInput, options?: Intl.DateTimeFormatOptions, fallback = "-"): string {
  const date = toDate(value);
  return date ? date.toLocaleString(localeTag(), options) : fallback;
}

/** Date only. */
export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions, fallback = "-"): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString(localeTag(), options) : fallback;
}

/** Time only. */
export function formatTime(value: DateInput, options?: Intl.DateTimeFormatOptions, fallback = "-"): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString(localeTag(), options) : fallback;
}

/** Number with the language's grouping and decimal separators. */
export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions, fallback = "-"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat(localeTag(), options).format(value);
}
