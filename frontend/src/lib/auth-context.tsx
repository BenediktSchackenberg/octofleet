"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://192.168.0.5:8080";

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

// Permission mappings for roles
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
    
    // Get permissions from user's roles
    const userPermissions = new Set<string>();
    for (const role of user.roles || []) {
      const perms = ROLE_PERMISSIONS[role] || [];
      perms.forEach(p => userPermissions.add(p));
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

  // Show nothing while checking auth (prevents flash)
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // Allow login page without auth
  if (!token && pathname === "/login") {
    return <>{children}</>;
  }

  // Block other pages if not authenticated
  if (!token) {
    return null;
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasPermission, isAdmin }}>
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
export function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  
  const token = localStorage.getItem("token");
  if (token) {
    return { "Authorization": `Bearer ${token}` };
  }
  return {};
}
