"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { ExportDropdown } from "./ExportButtons";
import { LanguageSelector } from "./LanguageSelector";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { LogOut, User, ChevronDown } from "lucide-react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  permission?: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  icon: string;
  items: NavItem[];
}

// Grouped navigation structure
const navGroups: NavGroup[] = [
  {
    label: "Inventar",
    icon: "📦",
    items: [
      { href: "/nodes", labelKey: "nav.nodes", icon: "🖥️", permission: "nodes:read" },
      { href: "/groups", labelKey: "nav.groups", icon: "📁", permission: "groups:read" },
      { href: "/software-compare", labelKey: "nav.compare", icon: "📊", permission: "nodes:read" },
    ]
  },
  {
    label: "Deployment",
    icon: "🚀",
    items: [
      { href: "/packages", labelKey: "nav.packages", icon: "📦", permission: "packages:read" },
      { href: "/jobs", labelKey: "nav.jobs", icon: "🚀", permission: "jobs:read" },
      { href: "/deployments", labelKey: "nav.deployments", icon: "🎯", permission: "deployments:read" },
    ]
  },
  {
    label: "Security",
    icon: "🛡️",
    items: [
      { href: "/vulnerabilities", labelKey: "nav.vulnerabilities", icon: "🐛", permission: "vulnerabilities:read" },
      { href: "/compliance", labelKey: "nav.compliance", icon: "🛡️", permission: "compliance:read" },
      { href: "/eventlog", labelKey: "nav.eventlog", icon: "📋", permission: "eventlog:read" },
      { href: "/alerts", labelKey: "nav.alerts", icon: "🔔", permission: "alerts:read" },
    ]
  },
  {
    label: "Admin",
    icon: "⚙️",
    items: [
      { href: "/users", labelKey: "nav.users", icon: "👥", permission: "users:read", adminOnly: true },
      { href: "/audit", labelKey: "nav.audit", icon: "📜", permission: "audit:read", adminOnly: true },
      { href: "/settings", labelKey: "nav.settings", icon: "⚙️" },
    ]
  }
];

function NavDropdown({ group, isActive }: { group: NavGroup; isActive: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const { hasPermission, isAdmin } = useAuth();
  const pathname = usePathname();

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter items based on permissions
  const visibleItems = group.items.filter(item => {
    if (item.adminOnly && !isAdmin()) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    return true;
  });

  if (visibleItems.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? "bg-blue-600 text-white"
            : "text-zinc-400 hover:text-white hover:bg-zinc-800"
        }`}
      >
        <span>{group.icon}</span>
        <span className="hidden md:inline">{group.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[180px] z-50">
          {visibleItems.map((item) => {
            const itemActive = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                  itemActive
                    ? "bg-blue-600/20 text-blue-400"
                    : "text-zinc-300 hover:bg-zinc-700 hover:text-white"
                }`}
              >
                <span>{item.icon}</span>
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const { user, logout, hasPermission, isAdmin } = useAuth();
  const { t } = useI18n();

  // Check if any item in a group is active
  function isGroupActive(group: NavGroup): boolean {
    return group.items.some(item => 
      item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href)
    );
  }

  return (
    <nav className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-50">
      <div className="max-w-[1920px] mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-white shrink-0">
            <span className="text-xl">🦎</span>
            <span className="hidden md:inline">OpenClaw Inventory</span>
          </Link>

          {/* Navigation - Dashboard + Grouped Dropdowns */}
          <div className="flex items-center gap-1 px-2">
            {/* Dashboard - always visible, not in dropdown */}
            <Link
              href="/"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
            >
              <span>🏠</span>
              <span className="hidden md:inline">{t("nav.dashboard")}</span>
            </Link>

            {/* Grouped Dropdowns */}
            {navGroups.map((group) => (
              <NavDropdown 
                key={group.label} 
                group={group} 
                isActive={isGroupActive(group)}
              />
            ))}
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
          </div>
        </div>
      </div>
    </nav>
  );
}
