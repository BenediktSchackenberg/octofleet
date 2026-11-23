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

/**
 * Linux: whether upgrading a package usually needs a reboot, from its name - the kernel always, the C
 * library, systemd and dbus may (Debian/Ubuntu then write /var/run/reboot-required). An estimate:
 * the agent reports the real state after the installation.
 */
export function linuxRebootBehavior(name: string): RebootBehavior {
  if (/^(linux-(image|modules|headers|base)|kernel(-core|-modules)?)(\b|-|$)/.test(name)) return "always";
  // Arch and derivatives: the kernel package is linux, linux-lts, linux-zen, linux-cachyos, ...
  if (/^linux(-(lts|zen|hardened|rt|rt-lts|cachyos[a-z0-9-]*))?$/.test(name)) return "always";
  if (/^(libc6|glibc|systemd|libsystemd0|dbus|dbus-broker|libssl\d+(t64)?|openssl(-libs)?)(\b|-|:|$)/.test(name)) return "can";
  return "never";
}

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
