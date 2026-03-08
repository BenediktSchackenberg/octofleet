"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { API_URL } from '@/lib/api-config';



interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
  roles: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// FALLBACK ONLY: Used when the backend /api/v1/auth/permissions endpoint is unreachable.
// The authoritative source is the backend ROLE_PERMISSIONS in auth.py.
// Do NOT rely on this for access control decisions — always prefer resolvedPermissions from the API.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ["*"],
  operator: [
    "nodes:read", "nodes:write", "nodes:assign",
    "groups:read", "groups:write",
    "jobs:read", "jobs:create", "jobs:execute", "jobs:cancel",
    "packages:read", "packages:write", "packages:deploy",
    "deployments:read", "deployments:write",
    "alerts:read", "alerts:write",
    "eventlog:read", "compliance:read",
    "settings:read"
  ],
  viewer: [
    "nodes:read", "groups:read", "jobs:read", "packages:read",
    "deployments:read", "alerts:read", "eventlog:read",
    "compliance:read", "settings:read"
  ],
  auditor: [
    "eventlog:read", "compliance:read", "nodes:read"
  ]
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedPermissions, setResolvedPermissions] = useState<string[] | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check for existing session
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);
      } catch (e) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      }
    }
    setLoading(false);
  }, []);

  // Fetch resolved permissions from backend when token is available
  useEffect(() => {
    if (!token) {
      setResolvedPermissions(null);
      return;
    }
    fetch(`${API_URL}/api/v1/auth/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.permissions) {
          setResolvedPermissions(data.permissions);
        }
      })
      .catch(() => {
        // Fallback: use local ROLE_PERMISSIONS matrix
        setResolvedPermissions(null);
      });
  }, [token]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !token && pathname !== "/login") {
      router.push("/login");
    }
  }, [loading, token, pathname, router]);

  async function login(username: string, password: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setToken(data.access_token);
      setUser(data.user);
      return true;
    } catch (e) {
      return false;
    }
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    router.push("/login");
  }

  function hasPermission(permission: string): boolean {
    if (!user) return false;
    if (user.is_superuser) return true;
    
    // Use backend-resolved permissions if available, else fall back to local matrix
    const userPermissions = new Set<string>();
    if (resolvedPermissions) {
      resolvedPermissions.forEach(p => userPermissions.add(p));
    } else {
      for (const role of user.roles || []) {
        const perms = ROLE_PERMISSIONS[role] || [];
        perms.forEach(p => userPermissions.add(p));
      }
    }
    
    if (userPermissions.has("*")) return true;
    if (userPermissions.has(permission)) return true;
    
    // Check wildcard (e.g., "nodes:*" covers "nodes:read")
    const resource = permission.split(":")[0];
    if (userPermissions.has(`${resource}:*`)) return true;
    
    return false;
  }

  function isAdmin(): boolean {
    return user?.is_superuser || user?.roles?.includes("admin") || false;
  }

    // Always wrap children in provider so useAuth() never crashes
  const contextValue = { user, token, loading, login, logout, hasPermission, isAdmin };

  // Show nothing while checking auth (prevents flash)
  if (loading) {
    return (
      <AuthContext.Provider value={contextValue}>
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </AuthContext.Provider>
    );
  }

  // Allow login page without auth
  if (!token && pathname === "/login") {
    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
  }

  // Block other pages if not authenticated
  if (!token) {
    return <AuthContext.Provider value={contextValue}>{null}</AuthContext.Provider>;
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Helper to get auth header for API calls
export function getApiBase(): string {
  return API_URL;
}

export function getAuthHeader(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) {
    return { "Authorization": `Bearer ${token}` };
  }
  return {};
}
