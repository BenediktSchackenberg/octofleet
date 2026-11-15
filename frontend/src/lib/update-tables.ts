/**
 * The update tables of a node (available, installed, history; Linux packages) share their column
 * widths (table-fixed), so the columns line up from one table to the next.
 */
export const UPDATE_COLS = {
  select: "w-10",
  kb: "w-32",
  type: "w-40",
  date: "w-36",
  status: "w-36",
  version: "w-64",
  source: "w-48",
} as const;

/** Type of a Windows update from its title (history) or the hotfix description */
export function installedUpdateType(title: string | undefined, description?: string | undefined): string {
  const text = title ?? "";
  if (/\.NET/i.test(text)) return "dotnet";
  if (/Cumulative Update/i.test(text)) return "cumulative";
  if (/Servicing Stack/i.test(text)) return "servicingStack";
  if (/Security Update/i.test(text) || /Security Update/i.test(description ?? "")) return "security";
  return "update";
}

/** Badge variant of an update result: successful stays quiet, failed stands out */
export function resultVariant(ok: boolean | undefined): "outline" | "destructive" {
  return ok === false ? "destructive" : "outline";
}
