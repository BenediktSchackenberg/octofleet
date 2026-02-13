"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { ExportDropdown } from "./ExportButtons";
import { LanguageSelector } from "./LanguageSelector";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { LogOut, User } from "lucide-react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  permission?: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", labelKey: "nav.dashboard", icon: "🏠" },
  { href: "/nodes", labelKey: "nav.nodes", icon: "🖥️", permission: "nodes:read" },
  { href: "/groups", labelKey: "nav.groups", icon: "📁", permission: "groups:read" },
  { href: "/jobs", labelKey: "nav.jobs", icon: "🚀", permission: "jobs:read" },
  { href: "/packages", labelKey: "nav.packages", icon: "📦", permission: "packages:read" },
  { href: "/deployments", labelKey: "nav.deployments", icon: "🎯", permission: "deployments:read" },
  { href: "/alerts", labelKey: "nav.alerts", icon: "🔔", permission: "alerts:read" },
  { href: "/vulnerabilities", labelKey: "nav.vulnerabilities", icon: "🐛", permission: "vulnerabilities:read" },
  { href: "/eventlog", labelKey: "nav.eventlog", icon: "📋", permission: "eventlog:read" },
  { href: "/compliance", labelKey: "nav.compliance", icon: "🛡️", permission: "compliance:read" },
  { href: "/software-compare", labelKey: "nav.compare", icon: "📊", permission: "nodes:read" },
  { href: "/users", labelKey: "nav.users", icon: "👥", permission: "users:read", adminOnly: true },
  { href: "/audit", labelKey: "nav.audit", icon: "📜", permission: "audit:read", adminOnly: true },
];

export function Navbar() {
  const pathname = usePathname();
  const { user, logout, hasPermission, isAdmin } = useAuth();
  const { t } = useI18n();

  // Filter nav items based on permissions
  const visibleNavItems = navItems.filter(item => {
    if (item.adminOnly && !isAdmin()) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    return true;
  });

  return (
    <nav className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-white shrink-0">
            <span className="text-xl">🦎</span>
            <span className="hidden md:inline">OpenClaw Inventory</span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1 overflow-x-auto px-2 scrollbar-hide">
            {visibleNavItems.map((item) => {
              const isActive = 
                item.href === "/" 
                  ? pathname === "/" 
                  : pathname?.startsWith(item.href);
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                >
                  <span className="mr-1.5">{item.icon}</span>
                  <span className="hidden lg:inline">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>

          {/* Right Side Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <ExportDropdown />
            <ThemeToggle />
            <LanguageSelector />
            
            {/* User Menu */}
            {user && (
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-zinc-700">
                <div className="hidden sm:flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-zinc-400" />
                  <span className="text-zinc-300">{user.display_name || user.username}</span>
                  {user.roles?.length > 0 && (
                    <span className="text-xs text-zinc-500">({user.roles[0]})</span>
                  )}
                </div>
                <button
                  onClick={logout}
                  className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg transition-colors"
                  title={t("nav.logout")}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
            
            <Link 
              href="/settings" 
              className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors"
              title={t("nav.settings")}
            >
              ⚙️
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
