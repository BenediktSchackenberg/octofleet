/**
 * Values agents report when the hardware does not provide one (WMI on virtual machines, empty
 * SMBIOS fields): "None", "Unknown", "Unspecified", "To be filled by O.E.M.", 0. Shown as if they
 * were data they mislead ("Socket: None", "0 MHz"), so the views treat them as missing.
 */
const PLACEHOLDERS = new Set(["", "none", "unknown", "unspecified", "not specified", "to be filled by o.e.m.", "n/a", "default string"]);

export function hwText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return PLACEHOLDERS.has(text.toLowerCase()) ? null : text;
}

/** A positive number, or null for missing values and the 0 placeholders. */
export function hwNumber(value: unknown, min = 0): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > min ? n : null;
}
