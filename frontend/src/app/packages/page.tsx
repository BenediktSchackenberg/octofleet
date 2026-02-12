"use client";
import { getAuthHeader } from "@/lib/auth-context";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_URL = "http://192.168.0.5:8080";

interface Package {
  id: string;
  name: string;
  displayName: string;
  vendor: string | null;
  description: string | null;
  category: string | null;
  osType: string;
  iconUrl: string | null;
  tags: string[];
  isActive: boolean;
  latestVersion: string | null;
  versionCount: number;
}

interface Category {
  name: string;
  count: number;
}

const categoryIcons: Record<string, string> = {
  browser: "🌐",
  runtime: "⚙️",
  utility: "🔧",
  security: "🔒",
  office: "📄",
  communication: "💬",
  development: "💻",
  media: "🎬",
  default: "📦",
};

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const icon = categoryIcons[category.toLowerCase()] || categoryIcons.default;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
      {icon} {category}
    </span>
  );
}

function CreatePackageDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Generate name from displayName if not set
    const pkgName = name || displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    try {
      const res = await fetch(`${API_URL}/api/v1/packages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          name: pkgName,
          displayName: displayName || name,
          vendor: vendor || null,
          description: description || null,
          category: category || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to create package");
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
        <h2 className="mb-4 text-xl font-bold text-white">📦 Neues Paket erstellen</h2>
        
        {error && (
          <div className="mb-4 rounded bg-red-500/20 p-3 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400">Anzeigename *</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="z.B. Mozilla Firefox"
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400">Technischer Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. mozilla-firefox"
                className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white font-mono text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400">Hersteller</label>
              <input
                type="text"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="z.B. Mozilla Foundation"
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
            <label className="block text-sm text-zinc-400">Beschreibung</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kurze Beschreibung des Pakets..."
              rows={3}
              className="mt-1 w-full rounded bg-zinc-700 px-3 py-2 text-white"
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
              disabled={loading || !displayName}
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-500 disabled:opacity-50"
            >
              {loading ? "Erstelle..." : "Paket erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchPackages = async () => {
    try {
      let url = `${API_URL}/api/v1/packages?`;
      if (selectedCategory) url += `category=${selectedCategory}&`;
      if (search) url += `search=${encodeURIComponent(search)}`;

      const res = await fetch(url, {
        headers: { ...getAuthHeader() },
      });
      const data = await res.json();
      setPackages(data.packages || []);
    } catch (err) {
      console.error("Failed to fetch packages:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/package-categories`, {
        headers: { ...getAuthHeader() },
      });
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
  };

  useEffect(() => {
    fetchPackages();
    fetchCategories();
  }, [selectedCategory, search]);

  return (
    <div className="min-h-screen bg-zinc-900 p-6">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">📦 Pakete</h1>
            <p className="text-zinc-400">Software-Katalog für Deployment</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="rounded-lg bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600"
            >
              ← Dashboard
            </Link>
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-500"
            >
              + Neues Paket
            </button>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Sidebar - Categories */}
          <div className="w-56 shrink-0">
            <div className="rounded-lg bg-zinc-800 p-4">
              <h3 className="mb-3 text-sm font-medium text-zinc-400">KATEGORIEN</h3>
              <ul className="space-y-1">
                <li>
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`w-full rounded px-3 py-2 text-left text-sm ${
                      !selectedCategory ? "bg-zinc-700 text-white" : "text-zinc-300 hover:bg-zinc-700/50"
                    }`}
                  >
                    Alle ({packages.length})
                  </button>
                </li>
                {categories.map((cat) => (
                  <li key={cat.name}>
                    <button
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`w-full rounded px-3 py-2 text-left text-sm flex items-center justify-between ${
                        selectedCategory === cat.name ? "bg-zinc-700 text-white" : "text-zinc-300 hover:bg-zinc-700/50"
                      }`}
                    >
                      <span>
                        {categoryIcons[cat.name.toLowerCase()] || "📦"} {cat.name}
                      </span>
                      <span className="text-zinc-500">{cat.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Search */}
            <div className="mb-6">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Pakete suchen..."
                className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500"
              />
            </div>

            {/* Package Grid */}
            {loading ? (
              <div className="text-center text-zinc-400 py-12">Lade Pakete...</div>
            ) : packages.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📭</div>
                <h2 className="text-xl font-semibold text-white mb-2">Keine Pakete gefunden</h2>
                <p className="text-zinc-400 mb-4">
                  {search ? "Versuche eine andere Suche." : "Erstelle dein erstes Paket!"}
                </p>
                {!search && (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="rounded-lg bg-green-600 px-6 py-2 text-white hover:bg-green-500"
                  >
                    Erstes Paket erstellen
                  </button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {packages.map((pkg) => (
                  <Link
                    key={pkg.id}
                    href={`/packages/${pkg.id}`}
                    className="group rounded-lg bg-zinc-800 p-4 hover:bg-zinc-700/80 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-700 text-2xl">
                        {pkg.iconUrl ? (
                          <img src={pkg.iconUrl} alt="" className="h-8 w-8" />
                        ) : (
                          categoryIcons[pkg.category?.toLowerCase() || ""] || "📦"
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-white truncate group-hover:text-green-400">
                          {pkg.displayName}
                        </h3>
                        {pkg.vendor && (
                          <p className="text-sm text-zinc-400 truncate">{pkg.vendor}</p>
                        )}
                      </div>
                    </div>

                    {pkg.description && (
                      <p className="mt-3 text-sm text-zinc-400 line-clamp-2">{pkg.description}</p>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      <CategoryBadge category={pkg.category} />
                      {pkg.latestVersion && (
                        <span className="text-xs text-zinc-500">v{pkg.latestVersion}</span>
                      )}
                    </div>

                    <div className="mt-2 text-xs text-zinc-500">
                      {pkg.versionCount} Version{pkg.versionCount !== 1 ? "en" : ""}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreatePackageDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            fetchPackages();
            fetchCategories();
          }}
        />
      )}
    </div>
  );
}
