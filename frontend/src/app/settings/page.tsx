"use client";

import { useEffect, useState } from "react";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";

const API_URL = "http://192.168.0.5:8080";
const API_KEY = "openclaw-inventory-dev-key";

interface EnrollmentToken {
  id: string;
  token: string;
  description: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  createdBy: string;
  createdAt: string;
  revoked: boolean;
  status: "active" | "expired" | "exhausted" | "revoked";
}

interface SystemInfo {
  gatewayUrl: string;
  apiUrl: string;
  version: string;
}

export default function SettingsPage() {
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newToken, setNewToken] = useState<{token: string; installCommand: string} | null>(null);

  // Create token form
  const [description, setDescription] = useState("");
  const [expiresHours, setExpiresHours] = useState(24);
  const [maxUses, setMaxUses] = useState(10);

  useEffect(() => {
    fetchTokens();
  }, []);

  async function fetchTokens() {
    try {
      const res = await fetch(`${API_URL}/api/v1/enrollment-tokens`, {
        headers: { "X-API-Key": API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function createToken() {
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/enrollment-tokens`, {
        method: "POST",
        headers: { 
          "X-API-Key": API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          description,
          expiresHours,
          maxUses,
          createdBy: "admin"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setNewToken({ token: data.token, installCommand: data.installCommand });
        fetchTokens();
        setDescription("");
        setExpiresHours(24);
        setMaxUses(10);
      }
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(tokenId: string) {
    if (!confirm("Token wirklich widerrufen?")) return;
    
    await fetch(`${API_URL}/api/v1/enrollment-tokens/${tokenId}`, {
      method: "DELETE",
      headers: { "X-API-Key": API_KEY },
    });
    fetchTokens();
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      active: "bg-green-500/20 text-green-400",
      expired: "bg-yellow-500/20 text-yellow-400",
      exhausted: "bg-orange-500/20 text-orange-400",
      revoked: "bg-red-500/20 text-red-400",
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || "bg-zinc-500/20"}`}>
        {status}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto p-6">
        <Breadcrumb items={[{ label: "Settings" }]} />
        
        <h1 className="text-2xl font-bold mb-6">⚙️ Einstellungen</h1>

        {/* System Info */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3">System</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-zinc-500">Gateway URL:</span>
              <div className="font-mono">http://192.168.0.5:18789</div>
            </div>
            <div>
              <span className="text-zinc-500">API URL:</span>
              <div className="font-mono">http://192.168.0.5:8080</div>
            </div>
          </div>
        </div>

        {/* Enrollment Tokens */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold">🔑 Enrollment Tokens</h2>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
            >
              + Neuer Token
            </button>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : tokens.length === 0 ? (
            <div className="p-8 text-center text-zinc-500">
              <div className="text-4xl mb-2">🔐</div>
              <p>Keine Enrollment Tokens vorhanden.</p>
              <p className="text-sm mt-1">Erstelle einen Token um neue Geräte zu registrieren.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {tokens.map((token) => (
                <div key={token.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{token.token}</span>
                      {getStatusBadge(token.status)}
                    </div>
                    <div className="text-sm text-zinc-500 mt-1">
                      {token.description || "Keine Beschreibung"} • 
                      {token.useCount}/{token.maxUses} verwendet • 
                      Läuft ab: {new Date(token.expiresAt).toLocaleString("de-DE")}
                    </div>
                  </div>
                  {token.status === "active" && (
                    <button
                      onClick={() => revokeToken(token.id)}
                      className="px-2 py-1 text-red-400 hover:text-red-300 text-sm"
                    >
                      Widerrufen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Token Dialog */}
        {showCreateDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-zinc-800 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">Neuen Token erstellen</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1">Beschreibung</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="z.B. Abteilung IT"
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Gültig (Stunden)</label>
                    <input
                      type="number"
                      value={expiresHours}
                      onChange={(e) => setExpiresHours(parseInt(e.target.value))}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-400 mb-1">Max. Verwendungen</label>
                    <input
                      type="number"
                      value={maxUses}
                      onChange={(e) => setMaxUses(parseInt(e.target.value))}
                      className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => { setShowCreateDialog(false); setNewToken(null); }}
                  className="px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white rounded"
                >
                  Schließen
                </button>
                {!newToken && (
                  <button
                    onClick={createToken}
                    disabled={creating}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded"
                  >
                    {creating ? "Erstelle..." : "Token erstellen"}
                  </button>
                )}
              </div>

              {/* Show new token */}
              {newToken && (
                <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded">
                  <div className="text-green-400 font-semibold mb-2">✅ Token erstellt!</div>
                  <div className="text-sm text-zinc-400 mb-1">Token (einmalig sichtbar):</div>
                  <div className="font-mono text-sm bg-zinc-900 p-2 rounded break-all">
                    {newToken.token}
                  </div>
                  <div className="text-sm text-zinc-400 mt-3 mb-1">PowerShell Installationsbefehl:</div>
                  <pre className="font-mono text-xs bg-zinc-900 p-2 rounded overflow-x-auto">
                    {newToken.installCommand}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
