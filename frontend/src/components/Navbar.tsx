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
  color: string;
  items: NavItem[];
}

// Color mappings for each category - farbige Pills!
const colorClasses: Record<string, { active: string; inactive: string }> = {
  amber: { 
    active: "bg-amber-500 text-white border-amber-500", 
    inactive: "text-amber-400 border-amber-500/50 hover:bg-amber-500/20" 
  },
  emerald: { 
    active: "bg-emerald-500 text-white border-emerald-500", 
    inactive: "text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/20" 
  },
  blue: { 
    active: "bg-blue-500 text-white border-blue-500", 
    inactive: "text-blue-400 border-blue-500/50 hover:bg-blue-500/20" 
  },
  red: { 
    active: "bg-red-500 text-white border-red-500", 
    inactive: "text-red-400 border-red-500/50 hover:bg-red-500/20" 
  },
  purple: { 
    active: "bg-purple-500 text-white border-purple-500", 
    inactive: "text-purple-400 border-purple-500/50 hover:bg-purple-500/20" 
  },
};

// Grouped navigation structure with colors
const navGroups: NavGroup[] = [
  {
    label: "Inventar",
    icon: "📦",
    color: "emerald",
    items: [
      { href: "/nodes", labelKey: "nav.nodes", icon: "🖥️", permission: "nodes:read" },
      { href: "/groups", labelKey: "nav.groups", icon: "📁", permission: "groups:read" },
      { href: "/hardware", labelKey: "nav.hardware", icon: "🔧", permission: "nodes:read" },
      { href: "/software-compare", labelKey: "nav.compare", icon: "📊", permission: "nodes:read" },
    ]
  },
  {
    label: "Deployment",
    icon: "🚀",
    color: "blue",
    items: [
      { href: "/packages", labelKey: "nav.packages", icon: "📦", permission: "packages:read" },
      { href: "/jobs", labelKey: "nav.jobs", icon: "🚀", permission: "jobs:read" },
      { href: "/deployments", labelKey: "nav.deployments", icon: "🎯", permission: "deployments:read" },
    ]
  },
  {
    label: "Services",
    icon: "🔗",
    color: "amber",
    items: [
      { href: "/services", labelKey: "nav.services", icon: "🔗", permission: "services:read" },
    ]
  },
  {
    label: "Security",
    icon: "🛡️",
    color: "red",
    items: [
      { href: "/vulnerabilities", labelKey: "nav.vulnerabilities", icon: "🐛", permission: "vulnerabilities:read" },
      { href: "/remediation", labelKey: "nav.remediation", icon: "🔧", permission: "vulnerabilities:read" },
      { href: "/compliance", labelKey: "nav.compliance", icon: "🛡️", permission: "compliance:read" },
      { href: "/eventlog", labelKey: "nav.eventlog", icon: "📋", permission: "eventlog:read" },
      { href: "/alerts", labelKey: "nav.alerts", icon: "🔔", permission: "alerts:read" },
    ]
  },
  {
    label: "Admin",
    icon: "⚙️",
    color: "purple",
    items: [
      { href: "/users", labelKey: "nav.users", icon: "👥", permission: "users:read", adminOnly: true },
      { href: "/audit", labelKey: "nav.audit", icon: "📜", permission: "audit:read", adminOnly: true },
      { href: "/alerts", labelKey: "nav.alerts", icon: "🔔" },
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
  const colors = colorClasses[group.color] || colorClasses.blue;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
          isActive || open ? colors.active : colors.inactive
        }`}
      >
        <span>{group.icon}</span>
        <span className="hidden md:inline">{group.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl py-2 min-w-[200px] z-50">
          {visibleItems.map((item) => {
            const itemActive = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  itemActive
                    ? `${colors.active} mx-2 rounded-lg`
                    : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                <span className="text-base">{item.icon}</span>
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
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const dashboardColors = colorClasses.amber;

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

          {/* Navigation */}
          <div className="flex items-center gap-2 px-2">
            {/* Dashboard */}
            <Link
              href="/"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                pathname === "/" ? dashboardColors.active : dashboardColors.inactive
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

          {/* Right Side */}
          <div className="flex items-center gap-2 shrink-0">
            <ExportDropdown />
            <ThemeToggle />
            <LanguageSelector />
            
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
