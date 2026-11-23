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

export type RebootBehavior = "never" | "always" | "can" | "unknown";

/* Linux packages: the reboot estimate comes from the server (reboot_behavior per update, linux_reboot_behavior
   in backend/routers/patches.py), the same for the node page, the install dialog and the fleet view. */

/** The newest installation entry of a KB in the Windows Update history: a failed attempt followed by a
 *  successful one (e.g. a cumulative update installed again after its servicing stack) shows the success */
export function latestInstallEntry<T extends { kbId?: string; kb?: string; operation?: string; installedDate?: string; installedOn?: string }>(
  history: T[] | undefined, kb: string): T | undefined {
  const time = (u: T) => Date.parse(u.installedDate || u.installedOn || "") || 0;
  return (history ?? [])
    .filter((u) => (u.kbId || u.kb) === kb && (u.operation ?? "Installation") === "Installation")
    .reduce<T | undefined>((newest, u) => (!newest || time(u) > time(newest) ? u : newest), undefined);
}

/** Badge variant of an update result: successful stays quiet, failed stands out */
export function resultVariant(ok: boolean | undefined): "outline" | "destructive" {
  return ok === false ? "destructive" : "outline";
}
