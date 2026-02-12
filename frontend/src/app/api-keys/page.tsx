"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Breadcrumb, LoadingSpinner } from "@/components/ui-components";
import { getAuthHeader, useAuth } from "@/lib/auth-context";
import { Plus, Trash2, Key, Copy, Check, AlertTriangle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080";

interface ApiKey {
  id: string;
  user_id: string | null;
  username: string | null;
  name: string;
  permissions: string[];
  expires_at: string | null;
  last_used: string | null;
  created_at: string;
  is_active: boolean;
}

export default function ApiKeysPage() {
  const { user, isAdmin } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [expiresDays, setExpiresDays] = useState<number | "">("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchKeys();
  }, []);

  async function fetchKeys() {
    try {
      const res = await fetch(`${API_URL}/api/v1/api-keys`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || []);
      }
    } catch (e) {
      console.error("Failed to fetch API keys:", e);
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    try {
      const res = await fetch(`${API_URL}/api/v1/api-keys`, {
        method: "POST",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName,
          expires_days: expiresDays || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setNewKeyName("");
        setExpiresDays("");
        fetchKeys();
      }
    } catch (e) {
      console.error("Failed to create API key:", e);
    }
  }

  async function revokeKey(keyId: string) {
    if (!confirm("Revoke this API key?")) return;
    try {
      await fetch(`${API_URL}/api/v1/api-keys/${keyId}`, {
        method: "DELETE",
        headers: getAuthHeader(),
      });
      fetchKeys();
    } catch (e) {
      console.error("Failed to revoke API key:", e);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Breadcrumb items={[{ label: "Settings" }, { label: "API Keys" }]} />
        <h1 className="text-2xl font-bold mb-6">🔑 API Keys</h1>
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <Breadcrumb items={[{ label: "Settings" }, { label: "API Keys" }]} />
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">🔑 API Keys</h1>
          <p className="text-muted-foreground">Manage API access tokens</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Create Key
        </Button>
      </div>

      {/* Created Key Alert */}
      {createdKey && (
        <Card className="mb-6 border-yellow-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-yellow-500">
              <AlertTriangle className="h-5 w-5" />
              Save Your API Key Now!
            </CardTitle>
            <CardDescription>
              This key will only be shown once. Copy it now and store it securely.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-zinc-800 rounded font-mono text-sm break-all">
                {createdKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(createdKey)}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setCreatedKey(null)}
            >
              I've saved this key
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Key Form */}
      {showCreate && !createdKey && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create New API Key</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="e.g. CI Pipeline, External App..."
                />
              </div>
              <div>
                <label className="text-sm font-medium">Expires (days)</label>
                <input
                  type="number"
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value ? parseInt(e.target.value) : "")}
                  className="w-full mt-1 px-3 py-2 bg-secondary border border-input rounded-md"
                  placeholder="Leave empty for no expiration"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={createKey} disabled={!newKeyName}>
                Create Key
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys Table */}
      <Card>
        <CardContent className="pt-6">
          {keys.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Key className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>No API keys yet</p>
              <p className="text-sm mt-2">Create a key to access the API programmatically</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {isAdmin() && <TableHead>Owner</TableHead>}
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id} className={!key.is_active ? "opacity-50" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{key.name}</span>
                      </div>
                    </TableCell>
                    {isAdmin() && (
                      <TableCell className="text-muted-foreground">
                        {key.username || "System"}
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(key.created_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {key.expires_at ? (
                        new Date(key.expires_at) < new Date() ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : (
                          formatDate(key.expires_at)
                        )
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(key.last_used)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.is_active ? "default" : "destructive"}>
                        {key.is_active ? "Active" : "Revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {key.is_active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeKey(key.id)}
                          className="text-red-500 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
