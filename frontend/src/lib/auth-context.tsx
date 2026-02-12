"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean;
  is_superuser: boolean;
  roles: string[];
  permissions?: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

  // Redirect to login if not authenticated (except for login page)
  useEffect(() => {
    if (!loading && !token && !pathname?.startsWith("/login")) {
      // For now, allow access without login (backwards compatible with API key)
      // Uncomment below to enforce login:
      // router.push("/login");
    }
  }, [loading, token, pathname, router]);

  function login(newToken: string, newUser: User) {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
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
    if (user.roles?.includes("admin")) return true;
    
    // Check permissions from JWT (if available)
    const perms = (user as any).permissions || [];
    if (perms.includes("*")) return true;
    
    const resource = permission.split(":")[0];
    return perms.includes(permission) || perms.includes(`${resource}:*`);
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasPermission }}>
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
    return { Authorization: `Bearer ${token}` };
  }
  // Fallback to API key for backwards compatibility
  return { "X-API-Key": "openclaw-inventory-dev-key" };
}
