"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useI18n } from "@/lib/i18n-context";
import { Lock, User, AlertCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || t("auth.loginError"));
      }

      const data = await res.json();
      
      // Store token and user info
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      
      // Force reload to reinitialize AuthContext with the new token
      // router.push doesn't work because AuthContext still has token=null in state
      // and will redirect back to /login before the state updates
      window.location.replace("/");
    } catch (err: any) {
      setError(err.message || t("auth.loginError"));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      {/* Language selector in corner */}
      <div className="absolute top-4 right-4">
        <LanguageSelector />
      </div>
      
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64" style={{imageRendering: "pixelated"}}>
              <rect x="12" y="4" width="8" height="2" fill="#9333ea"/>
              <rect x="10" y="6" width="12" height="2" fill="#9333ea"/>
              <rect x="9" y="8" width="14" height="4" fill="#9333ea"/>
              <rect x="10" y="12" width="12" height="2" fill="#9333ea"/>
              <rect x="11" y="9" width="2" height="2" fill="#ffffff"/>
              <rect x="19" y="9" width="2" height="2" fill="#ffffff"/>
              <rect x="12" y="10" width="1" height="1" fill="#000000"/>
              <rect x="20" y="10" width="1" height="1" fill="#000000"/>
              <rect x="8" y="14" width="2" height="4" fill="#a855f7"/>
              <rect x="6" y="18" width="2" height="4" fill="#a855f7"/>
              <rect x="11" y="14" width="2" height="4" fill="#a855f7"/>
              <rect x="10" y="18" width="2" height="4" fill="#a855f7"/>
              <rect x="14" y="14" width="4" height="4" fill="#a855f7"/>
              <rect x="14" y="18" width="4" height="4" fill="#a855f7"/>
              <rect x="19" y="14" width="2" height="4" fill="#a855f7"/>
              <rect x="20" y="18" width="2" height="4" fill="#a855f7"/>
              <rect x="22" y="14" width="2" height="4" fill="#a855f7"/>
              <rect x="24" y="18" width="2" height="4" fill="#a855f7"/>
            </svg>
          </div>
          <CardTitle className="text-2xl bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">Octofleet</CardTitle>
          <CardDescription>{t("auth.loginSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-md text-red-500 text-sm">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                {t("auth.username")}
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-secondary border border-input rounded-md"
                  placeholder="admin"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t("auth.password")}
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-secondary border border-input rounded-md"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("common.loading") : t("auth.loginButton")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
