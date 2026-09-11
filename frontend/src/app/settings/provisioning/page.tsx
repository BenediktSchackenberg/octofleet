"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Save } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

type Field = { key: string; label: string; help: string; placeholder?: string; type?: string };
const sections: { title: string; description: string; fields: Field[] }[] = [
  {
    title: "Server und Netzwerk",
    description: "Adressen, die von den zu installierenden Geräten erreichbar sein müssen.",
    fields: [
      { key: "pxe_server_url", label: "PXE-Basis-URL", help: "HTTP(S)-Adresse für Bootdateien, Images und Treiber, einschließlich Port und optionalem Basispfad.", placeholder: "http://pxe.example.net:9080", type: "url" },
      { key: "api_server_url", label: "Öffentliche API-Basis-URL", help: "Adresse für Agenten und Installationsrückmeldungen, ohne /api/v1.", placeholder: "https://octofleet.example.net", type: "url" },
      { key: "api_upstream_url", label: "API-Adresse für den PXE-Container", help: "Optional: intern erreichbare API-Adresse. Leer übernimmt die öffentliche API-Adresse.", placeholder: "http://backend:8080", type: "url" },
      { key: "dns_servers", label: "Standard-DNS-Server", help: "IP-Adressen durch Komma trennen. Leer verwendet keine fest vorgegebenen DNS-Server; einzelne Aufträge können dies überschreiben.", placeholder: "10.20.0.10, 10.20.0.11" },
      { key: "http_port", label: "HTTP-Port des PXE-Containers", help: "Lokaler Listener-Port. Bei vorgeschaltetem HTTPS-Proxy kann er von der öffentlichen URL abweichen.", type: "number" },
      { key: "pxe_interface", label: "PXE-Netzwerkschnittstelle", help: "Optional, z. B. eth0 oder br0. Leer bindet alle Schnittstellen.", placeholder: "eth0" },
      { key: "proxy_dhcp_subnet", label: "ProxyDHCP-Netzadresse", help: "Optional, z. B. 10.20.0.0. Leer deaktiviert ProxyDHCP; dann Bootserver und Bootdatei im vorhandenen DHCP konfigurieren.", placeholder: "10.20.0.0" },
    ],
  },
  {
    title: "Ubuntu und NFS",
    description: "Die Ubuntu-Live-Umgebung wird über einen vorhandenen NFS-Export bereitgestellt.",
    fields: [
      { key: "nfs_server", label: "NFS-Server", help: "Hostname oder IP-Adresse des Servers, der die Live-Umgebung exportiert.", placeholder: "nfs.example.net" },
      { key: "nfs_export_path", label: "NFS-Exportpfad", help: "Absoluter Pfad auf dem NFS-Server. {version} wird beispielsweise durch 24.04 ersetzt.", placeholder: "/exports/ubuntu-{version}" },
    ],
  },
  {
    title: "Windows-Netzwerkfreigaben",
    description: "Optional für Installationen über SMB. Die Freigaben werden auf dem Dateiserver eingerichtet.",
    fields: [
      { key: "smb_images_share", label: "SMB-Freigabe für Images", help: "UNC-Pfad für deploy.cmd, beispielsweise \\\\fileserver\\images." },
      { key: "smb_install_share", label: "SMB-Installationsfreigabe", help: "UNC-Pfad mit Windows-Setup und Antwortdateien, beispielsweise \\\\fileserver\\wininstall." },
    ],
  },
  {
    title: "Virtuelle Maschinen",
    description: "Standardverzeichnisse auf dem jeweiligen Hypervisor. Ein Auftrag kann einen eigenen Speicherpfad angeben.",
    fields: [
      { key: "hyperv_storage_path", label: "Hyper-V-Speicherpfad", help: "Absoluter Windows-Pfad oder UNC-Freigabe für VM-Dateien und virtuelle Festplatten." },
      { key: "kvm_storage_path", label: "KVM-Speicherpfad", help: "Absolutes Linux-Verzeichnis für QCOW2-Festplatten." },
    ],
  },
  {
    title: "Verzeichnisse und Werkzeuge",
    description: "Absolute Linux-Pfade. Die Verzeichnisse müssen auf dem jeweiligen Host bzw. im Container vorhanden und eingebunden sein. Speichern verschiebt keine Dateien.",
    fields: [
      { key: "iso_path", label: "ISO-Verzeichnis", help: "Standardverzeichnis für die ISO-Suche des Backends." },
      { key: "images_path", label: "Image-Verzeichnis", help: "Ziel für importierte Images; öffentlich unter /images/ erreichbar." },
      { key: "answers_path", label: "Antwortdateien", help: "Speicherort für generierte Windows-Antwortdateien." },
      { key: "boot_path", label: "Gerätespezifische Bootskripte", help: "Speicherort für bereits generierte MAC-spezifische Skripte." },
      { key: "drivers_path", label: "Treiber-Verzeichnis", help: "Vom PXE-Container unter /drivers/ bereitgestellt." },
      { key: "scripts_path", label: "Installationsskripte", help: "Vom PXE-Container unter /scripts/ bereitgestellt." },
      { key: "tftp_root", label: "TFTP-Verzeichnis", help: "Enthält iPXE-/GRUB-Bootloader. Bootloader müssen separat vorhanden sein." },
      { key: "windows_install_path", label: "Windows-Installationsquelle", help: "Entpackte Windows-Installationsdateien für /wininstall/." },
      { key: "mount_base", label: "Basis für ISO-Mounts", help: "Neue ISO-Mounts werden darunter angelegt. Bestehende Mounts bleiben bestehen." },
      { key: "iso_manager_script", label: "ISO-Manager-Skript", help: "Absoluter Pfad zu iso-manager.sh auf dem Backend-Host. Erforderliche Werkzeuge und sudo-Berechtigungen müssen eingerichtet sein." },
    ],
  },
];

type Configuration = Record<string, string | number | string[]>;
type Form = Record<string, string>;
const toForm = (config: Configuration): Form => Object.fromEntries(
  Object.entries(config).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)])
);

function errorText(error: unknown, fallback: string): string {
  if (Array.isArray(error)) {
    return error.map(item => typeof item?.msg === "string" ? item.msg : String(item)).join("; ");
  }
  return typeof error === "string" && error ? error : fallback;
}

export default function ProvisioningSettingsPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("settings:read");
  const canWrite = hasPermission("settings:write");
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFile, setExportFile] = useState<{ filename: string; content: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const dirty = form !== null && JSON.stringify(form) !== saved;

  useEffect(() => () => { if (exportFile) URL.revokeObjectURL(exportFile.url); }, [exportFile]);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    apiClient.richGet<Configuration>("/provisioning/config", { showErrorToast: false }).then(result => {
      if (!active) return;
      if (result.ok && result.data) {
        const next = toForm(result.data);
        setForm(next);
        setSaved(JSON.stringify(next));
        setError("");
      } else {
        setError(errorText(result.error, "Die Konfiguration konnte nicht geladen werden."));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [canRead, reload]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setExportFile(null);
    setError("");
    setMessage("");
    const payload = { ...form, http_port: Number(form.http_port), dns_servers: form.dns_servers.split(",").map(v => v.trim()).filter(Boolean) };
    const result = await apiClient.request<Configuration>("/provisioning/config", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), showErrorToast: false,
    });
    if (result.ok && result.data) {
      const next = toForm(result.data);
      setForm(next);
      setSaved(JSON.stringify(next));
      setMessage("Gespeichert. Neue Bootskripte und Aufträge verwenden diese Einstellungen. Änderungen am PXE-Container über den Export übernehmen.");
    } else {
      setError(errorText(result.error, "Speichern fehlgeschlagen."));
    }
    setSaving(false);
  }

  async function download(kind: "pxe" | "winpe") {
    setExporting(true);
    setError("");
    const endpoint = kind === "winpe" ? "/provisioning/config/export/winpe" : "/provisioning/config/export";
    const result = await apiClient.richGet<{ filename: string; content: string }>(endpoint, { showErrorToast: false });
    if (result.ok && result.data) {
      const url = URL.createObjectURL(new Blob([result.data.content], { type: "text/plain;charset=utf-8" }));
      setExportFile({ ...result.data, url });
    } else setError(errorText(result.error, "Export fehlgeschlagen."));
    setExporting(false);
  }

  if (!canRead) return <p className="p-6">Keine Berechtigung zum Lesen der Einstellungen.</p>;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} /> Einstellungen</Link>
      <div>
        <h1 className="text-2xl font-semibold">Provisioning</h1>
        <p className="text-zinc-400 mt-2">Bootserver, Netzwerk und Speicher zentral konfigurieren.</p>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-green-300">{message}</div>}
      {loading ? <p role="status" className="flex items-center gap-2"><Loader2 className="animate-spin" size={18} /> Einstellungen werden geladen…</p> : !form ? (
        <button onClick={() => { setLoading(true); setReload(value => value + 1); }} className="rounded bg-zinc-800 px-4 py-2">Erneut laden</button>
      ) : (
        <form onSubmit={save} className="space-y-6">
          {sections.map(section => (
            <fieldset key={section.title} disabled={!canWrite || saving} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 disabled:opacity-70">
              <legend className="px-2 font-semibold">{section.title}</legend>
              <p className="text-sm text-zinc-400 mb-5">{section.description}</p>
              <div className="grid gap-5 md:grid-cols-2">
                {section.fields.map(field => (
                  <div key={field.key}>
                    <label htmlFor={field.key} className="block text-sm font-medium mb-2">{field.label}</label>
                    <input id={field.key} type={field.type || "text"} value={form[field.key] || ""} placeholder={field.placeholder}
                      min={field.type === "number" ? 1 : undefined} max={field.type === "number" ? 65535 : undefined}
                      aria-describedby={`${field.key}-help`} onChange={event => { setForm({ ...form, [field.key]: event.target.value }); setMessage(""); setExportFile(null); }}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p id={`${field.key}-help`} className="text-xs text-zinc-400 mt-2">{field.help}</p>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-3 items-center">
            <button type="submit" disabled={!canWrite || !dirty || saving} className="inline-flex gap-2 items-center rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Speichern
            </button>
            <button type="button" onClick={() => void download("pxe")} disabled={!canWrite || dirty || saving || exporting} className="inline-flex gap-2 items-center rounded-md border border-zinc-700 px-4 py-2 disabled:opacity-50">
              <Download size={16} /> PXE-Konfiguration exportieren
            </button>
            <button type="button" onClick={() => void download("winpe")} disabled={!canWrite || dirty || saving || exporting} className="inline-flex gap-2 items-center rounded-md border border-zinc-700 px-4 py-2 disabled:opacity-50">
              <Download size={16} /> WinPE-Konfiguration exportieren
            </button>
            {dirty && <span className="text-sm text-amber-300">Ungespeicherte Änderungen</span>}
          </div>
          {exportFile && <div className="rounded-lg border border-zinc-700 p-4 space-y-3">
            <p role="status">Export erstellt: <a href={exportFile.url} download={exportFile.filename} className="text-blue-400 underline">{exportFile.filename} herunterladen</a></p>
            <details>
              <summary className="cursor-pointer text-sm text-zinc-400">Inhalt anzeigen / manuell kopieren</summary>
              <textarea aria-label="Exportierte Konfiguration" readOnly value={exportFile.content} rows={12} className="mt-3 w-full rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs" />
            </details>
          </div>}
          <p className="text-sm text-zinc-400">Für den PXE-Container die exportierte Datei als <code>provisioning/pxe.env</code> ablegen und mit <code>docker compose --env-file pxe.env up -d --build --force-recreate</code> übernehmen. Bestehende statische Bootskripte bei Bedarf neu erzeugen.</p>
          <p className="text-sm text-zinc-400">Für bestehende WinPE-Images <code>octofleet-config.cmd</code> neben <code>startnet.cmd</code> in das Image einbinden. Die mitgelieferten Windows-Skripte lesen diese Datei beim Start.</p>
        </form>
      )}
    </div>
  );
}
