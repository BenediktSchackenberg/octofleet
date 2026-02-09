"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";

const API_URL = "http://192.168.0.5:8080";

interface DetectionRule {
  id: string;
  order: number;
  type: string;
  config: Record<string, unknown>;
  operator: string;
}

interface PackageVersion {
  id: string;
  version: string;
  filename: string;
  fileSize: number | null;
  sha256Hash: string | null;
  installCommand: string | null;
  requiresReboot: boolean;
  requiresAdmin: boolean;
  silentInstall: boolean;
  isLatest: boolean;
  isActive: boolean;
  releaseDate: string | null;
  releaseNotes: string | null;
  detectionRules?: DetectionRule[];
}

interface Package {
  id: string;
  name: string;
  displayName: string;
  vendor: string | null;
  description: string | null;
  category: string | null;
  osType: string;
  architecture: string;
  homepageUrl: string | null;
  iconUrl: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  versions: PackageVersion[];
}

const ruleTypeLabels: Record<string, string> = {
  msi: "📦 MSI Product Code",
  registry: "📋 Registry Key",
  file: "📄 Datei",
  service: "⚙️ Windows Service",
  script: "📝 PowerShell Script",
};

function EditPackageDialog({ pkg, onClose, onUpdated }: { pkg: Package; onClose: () => void; onUpdated: () => void }) {
  const [displayName, setDisplayName] = useState(pkg.displayName);
  const [vendor, setVendor] = useState(pkg.vendor || "");
  const [description, setDescription] = useState(pkg.description || "");
  const [category, setCategory] = useState(pkg.category || "");
  const [homepageUrl, setHomepageUrl] = useState(pkg.homepageUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/v1/packages/${pkg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-API-Key": "openclaw-inventory-dev-key" },
        body: JSON.stringify({
          displayName,
          vendor: vendor || null,
          description: description || null,
          category: category || null,
          homepageUrl: homepageUrl || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to update package");
      }

      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">✏️ Paket bearbeiten</h2>

        {error && (
          <div className="mb-4 rounded bg-red-500/20 p-3 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400">Anzeigename *</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400">Hersteller</label>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">Kategorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
              >
                <option value="">-- Auswählen --</option>
                <option value="browser">🌐 Browser</option>
                <option value="runtime">⚙️ Runtime</option>
                <option value="utility">🔧 Utility</option>
                <option value="security">🔒 Security</option>
                <option value="office">📄 Office</option>
                <option value="communication">💬 Communication</option>
                <option value="development">💻 Development</option>
                <option value="media">🎬 Media</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Homepage URL</label>
            <input
              type="url"
              value={homepageUrl}
              onChange={(e) => setHomepageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Beschreibung</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500">
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading || !displayName}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Speichere..." : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditVersionDialog({ packageId, version, onClose, onUpdated }: { packageId: string; version: PackageVersion; onClose: () => void; onUpdated: () => void }) {
  const [installCommand, setInstallCommand] = useState(version.installCommand || "");
  const [uninstallCommand, setUninstallCommand] = useState("");
  const [silentInstall, setSilentInstall] = useState(version.silentInstall);
  const [requiresAdmin, setRequiresAdmin] = useState(version.requiresAdmin);
  const [requiresReboot, setRequiresReboot] = useState(version.requiresReboot);
  const [releaseNotes, setReleaseNotes] = useState(version.releaseNotes || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/v1/packages/${packageId}/versions/${version.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-API-Key": "openclaw-inventory-dev-key" },
        body: JSON.stringify({
          installCommand: installCommand || null,
          uninstallCommand: uninstallCommand || null,
          silentInstall,
          requiresAdmin,
          requiresReboot,
          releaseNotes: releaseNotes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to update version");
      }

      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">✏️ Version {version.version} bearbeiten</h2>

        {error && (
          <div className="mb-4 rounded bg-red-500/20 p-3 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400">Install Command</label>
            <input
              type="text"
              value={installCommand}
              onChange={(e) => setInstallCommand(e.target.value)}
              placeholder="{file} /S oder msiexec /i {file} /qn"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
            />
            <p className="mt-1 text-xs text-zinc-500">{"{file}"} wird durch den Pfad zur Datei ersetzt</p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Uninstall Command</label>
            <input
              type="text"
              value={uninstallCommand}
              onChange={(e) => setUninstallCommand(e.target.value)}
              placeholder="msiexec /x {productCode} /qn"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
            />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={silentInstall}
                onChange={(e) => setSilentInstall(e.target.checked)}
                className="rounded"
              />
              🔇 Silent Install
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={requiresAdmin}
                onChange={(e) => setRequiresAdmin(e.target.checked)}
                className="rounded"
              />
              🔐 Requires Admin
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={requiresReboot}
                onChange={(e) => setRequiresReboot(e.target.checked)}
                className="rounded"
              />
              🔄 Requires Reboot
            </label>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Release Notes</label>
            <textarea
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              rows={3}
              placeholder="Was ist neu in dieser Version..."
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500">
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Speichere..." : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddVersionDialog({ packageId, onClose, onCreated }: { packageId: string; onClose: () => void; onCreated: () => void }) {
  const [version, setVersion] = useState("");
  const [filename, setFilename] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const [sha256Hash, setSha256Hash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/v1/packages/${packageId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "openclaw-inventory-dev-key" },
        body: JSON.stringify({
          version,
          filename,
          downloadUrl: downloadUrl || null,
          installCommand: installCommand || null,
          sha256Hash: sha256Hash || null,
          isLatest: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to add version");
      }

      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">📦 Version hinzufügen</h2>

        {error && (
          <div className="mb-4 rounded bg-red-500/20 p-3 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400">Version *</label>
              <input
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="z.B. 25.01"
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">Dateiname *</label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="z.B. 7z2501-x64.msi"
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Download URL *</label>
            <input
              type="url"
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
              placeholder="https://www.7-zip.org/a/7z2501-x64.msi"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
              required
            />
            <p className="mt-1 text-xs text-zinc-500">Der Agent lädt die Datei von dieser URL herunter</p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">Install Command</label>
            <input
              type="text"
              value={installCommand}
              onChange={(e) => setInstallCommand(e.target.value)}
              placeholder="z.B. msiexec /i {file} /qn"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
            />
            <p className="mt-1 text-xs text-zinc-500">{"{file}"} wird durch den Pfad zur Datei ersetzt. Leer = automatisch (MSI/EXE)</p>
          </div>

          <div>
            <label className="block text-sm text-zinc-400">SHA256 Hash</label>
            <input
              type="text"
              value={sha256Hash}
              onChange={(e) => setSha256Hash(e.target.value)}
              placeholder="Optional: Hash für Verifikation"
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading || !version || !filename}
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-500 disabled:opacity-50"
            >
              {loading ? "Speichere..." : "Version hinzufügen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddRuleDialog({ packageId, versionId, onClose, onCreated }: { packageId: string; versionId: string; onClose: () => void; onCreated: () => void }) {
  const [ruleType, setRuleType] = useState("msi");
  const [config, setConfig] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch(`${API_URL}/api/v1/packages/${packageId}/versions/${versionId}/detection-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": "openclaw-inventory-dev-key" },
        body: JSON.stringify({ type: ruleType, config }),
      });
      onCreated();
      onClose();
    } catch (err) {
      console.error("Failed to add rule:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-zinc-800 p-6">
        <h2 className="mb-4 text-xl font-bold text-white">🔍 Detection Rule hinzufügen</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-zinc-400">Regel-Typ</label>
            <select
              value={ruleType}
              onChange={(e) => {
                setRuleType(e.target.value);
                setConfig({});
              }}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
            >
              <option value="msi">📦 MSI Product Code</option>
              <option value="registry">📋 Registry Key</option>
              <option value="file">📄 Datei existiert / Version</option>
              <option value="service">⚙️ Windows Service</option>
            </select>
          </div>

          {ruleType === "msi" && (
            <div>
              <label className="block text-sm text-zinc-400">MSI Product Code (GUID)</label>
              <input
                type="text"
                value={config.productCode || ""}
                onChange={(e) => setConfig({ productCode: e.target.value })}
                placeholder="{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}"
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono"
              />
            </div>
          )}

          {ruleType === "registry" && (
            <>
              <div>
                <label className="block text-sm text-zinc-400">Registry Path</label>
                <input
                  type="text"
                  value={config.path || ""}
                  onChange={(e) => setConfig({ ...config, path: e.target.value })}
                  placeholder="HKLM\SOFTWARE\Microsoft\..."
                  className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-zinc-400">Value Name</label>
                  <input
                    type="text"
                    value={config.valueName || ""}
                    onChange={(e) => setConfig({ ...config, valueName: e.target.value })}
                    placeholder="Version"
                    className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400">Erwarteter Wert</label>
                  <input
                    type="text"
                    value={config.value || ""}
                    onChange={(e) => setConfig({ ...config, value: e.target.value })}
                    placeholder="123.0"
                    className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                  />
                </div>
              </div>
            </>
          )}

          {ruleType === "file" && (
            <>
              <div>
                <label className="block text-sm text-zinc-400">Dateipfad</label>
                <input
                  type="text"
                  value={config.path || ""}
                  onChange={(e) => setConfig({ ...config, path: e.target.value })}
                  placeholder="C:\Program Files\App\app.exe"
                  className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400">Min. Version (optional)</label>
                <input
                  type="text"
                  value={config.minVersion || ""}
                  onChange={(e) => setConfig({ ...config, minVersion: e.target.value })}
                  placeholder="1.0.0.0"
                  className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                />
              </div>
            </>
          )}

          {ruleType === "service" && (
            <div>
              <label className="block text-sm text-zinc-400">Service Name</label>
              <input
                type="text"
                value={config.serviceName || ""}
                onChange={(e) => setConfig({ serviceName: e.target.value })}
                placeholder="wuauserv"
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded bg-zinc-600 px-4 py-2 text-white hover:bg-zinc-500">
              Abbrechen
            </button>
            <button type="submit" disabled={loading} className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500 disabled:opacity-50">
              {loading ? "Speichere..." : "Regel hinzufügen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PackageDetailPage() {
  const params = useParams();
  const packageId = params.id as string;
  
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [showAddRule, setShowAddRule] = useState<string | null>(null);
  const [showEditPackage, setShowEditPackage] = useState(false);
  const [showEditVersion, setShowEditVersion] = useState<PackageVersion | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [versionRules, setVersionRules] = useState<Record<string, DetectionRule[]>>({});

  const fetchPackage = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/packages/${packageId}`, {
        headers: { "X-API-Key": "openclaw-inventory-dev-key" },
      });
      if (res.ok) {
        const data = await res.json();
        setPkg(data);
      }
    } catch (err) {
      console.error("Failed to fetch package:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVersionRules = async (versionId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/packages/${packageId}/versions/${versionId}`, {
        headers: { "X-API-Key": "openclaw-inventory-dev-key" },
      });
      if (res.ok) {
        const data = await res.json();
        setVersionRules((prev) => ({ ...prev, [versionId]: data.detectionRules || [] }));
      }
    } catch (err) {
      console.error("Failed to fetch version rules:", err);
    }
  };

  const toggleVersion = (versionId: string) => {
    if (expandedVersion === versionId) {
      setExpandedVersion(null);
    } else {
      setExpandedVersion(versionId);
      if (!versionRules[versionId]) {
        fetchVersionRules(versionId);
      }
    }
  };

  useEffect(() => {
    fetchPackage();
  }, [packageId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-900 flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="min-h-screen bg-zinc-900 p-6">
        <div className="mx-auto max-w-5xl">
          <Breadcrumb items={[{ label: "Packages", href: "/packages" }, { label: "Nicht gefunden" }]} />
          <div className="text-center py-12">
            <div className="text-6xl mb-4">❌</div>
            <h1 className="text-xl font-bold text-white">Paket nicht gefunden</h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 p-6">
      <div className="mx-auto max-w-5xl">
        {/* Breadcrumb */}
        <Breadcrumb items={[{ label: "Packages", href: "/packages" }, { label: pkg.displayName || pkg.name }]} />
        
        {/* Header */}
        <div className="mb-6">
          <Link href="/packages" className="text-zinc-400 hover:text-white text-sm">
            ← Pakete
          </Link>
        </div>

        <div className="flex items-start gap-6 mb-8">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-4xl">
            {pkg.iconUrl ? <img src={pkg.iconUrl} alt="" className="h-12 w-12" /> : "📦"}
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white">{pkg.displayName}</h1>
                {pkg.vendor && <p className="text-zinc-400 mt-1">{pkg.vendor}</p>}
              </div>
              <button
                onClick={() => setShowEditPackage(true)}
                className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-white hover:bg-zinc-600"
              >
                ✏️ Bearbeiten
              </button>
            </div>
            {pkg.description && <p className="text-zinc-300 mt-2">{pkg.description}</p>}
            
            <div className="flex gap-2 mt-3">
              {pkg.category && (
                <span className="rounded-full bg-zinc-700 px-3 py-1 text-sm text-zinc-300">
                  {pkg.category}
                </span>
              )}
              <span className="rounded-full bg-zinc-700 px-3 py-1 text-sm text-zinc-300">
                {pkg.osType} / {pkg.architecture}
              </span>
              {pkg.homepageUrl && (
                <a href={pkg.homepageUrl} target="_blank" className="rounded-full bg-blue-600/20 px-3 py-1 text-sm text-blue-400 hover:bg-blue-600/30">
                  🔗 Homepage
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Versions */}
        <div className="rounded-lg bg-zinc-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">📦 Versionen ({pkg.versions.length})</h2>
            <button
              onClick={() => setShowAddVersion(true)}
              className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-500"
            >
              + Version hinzufügen
            </button>
          </div>

          {pkg.versions.length === 0 ? (
            <div className="text-center py-8 text-zinc-400">
              <p>Noch keine Versionen vorhanden.</p>
              <button
                onClick={() => setShowAddVersion(true)}
                className="mt-3 text-green-400 hover:underline"
              >
                Erste Version hinzufügen →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {pkg.versions.map((ver) => (
                <div key={ver.id} className="rounded-lg bg-zinc-700/50">
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-700/70"
                    onClick={() => toggleVersion(ver.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-white">v{ver.version}</span>
                      {ver.isLatest && (
                        <span className="rounded bg-green-600/30 px-2 py-0.5 text-xs text-green-400">
                          Latest
                        </span>
                      )}
                      {!ver.isActive && (
                        <span className="rounded bg-zinc-600 px-2 py-0.5 text-xs text-zinc-400">
                          Inaktiv
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-400">
                      <span>{ver.filename}</span>
                      {ver.releaseDate && <span>{new Date(ver.releaseDate).toLocaleDateString("de-DE")}</span>}
                      <span>{expandedVersion === ver.id ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {expandedVersion === ver.id && (
                    <div className="border-t border-zinc-600 p-4 space-y-4">
                      {/* Version Details */}
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-zinc-300">⚙️ Konfiguration</h4>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEditVersion(ver);
                          }}
                          className="text-xs text-blue-400 hover:underline"
                        >
                          ✏️ Bearbeiten
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-zinc-400">Install Command:</span>
                          <code className="ml-2 text-green-400">{ver.installCommand || "(nicht gesetzt)"}</code>
                        </div>
                        <div>
                          <span className="text-zinc-400">Flags:</span>
                          <span className="ml-2 text-white">
                            {ver.silentInstall && "🔇 Silent "}
                            {ver.requiresAdmin && "🔐 Admin "}
                            {ver.requiresReboot && "🔄 Reboot"}
                          </span>
                        </div>
                        {ver.sha256Hash && (
                          <div className="col-span-2">
                            <span className="text-zinc-400">SHA256:</span>
                            <code className="ml-2 text-xs text-zinc-300 break-all">{ver.sha256Hash}</code>
                          </div>
                        )}
                      </div>

                      {/* Detection Rules */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium text-zinc-300">🔍 Detection Rules</h4>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowAddRule(ver.id);
                            }}
                            className="text-xs text-blue-400 hover:underline"
                          >
                            + Regel hinzufügen
                          </button>
                        </div>

                        {versionRules[ver.id]?.length ? (
                          <div className="space-y-2">
                            {versionRules[ver.id].map((rule) => (
                              <div key={rule.id} className="flex items-center gap-2 rounded bg-zinc-600/50 px-3 py-2 text-sm">
                                <span>{ruleTypeLabels[rule.type] || rule.type}</span>
                                <code className="text-xs text-zinc-400">{JSON.stringify(rule.config)}</code>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-zinc-500">Keine Regeln definiert.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddVersion && (
        <AddVersionDialog
          packageId={packageId}
          onClose={() => setShowAddVersion(false)}
          onCreated={fetchPackage}
        />
      )}

      {showAddRule && (
        <AddRuleDialog
          packageId={packageId}
          versionId={showAddRule}
          onClose={() => setShowAddRule(null)}
          onCreated={() => {
            fetchVersionRules(showAddRule);
            setShowAddRule(null);
          }}
        />
      )}

      {showEditPackage && pkg && (
        <EditPackageDialog
          pkg={pkg}
          onClose={() => setShowEditPackage(false)}
          onUpdated={fetchPackage}
        />
      )}

      {showEditVersion && (
        <EditVersionDialog
          packageId={packageId}
          version={showEditVersion}
          onClose={() => setShowEditVersion(null)}
          onUpdated={fetchPackage}
        />
      )}
    </div>
  );
}
