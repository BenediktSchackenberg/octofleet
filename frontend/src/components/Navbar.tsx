"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { ExportDropdown } from "./ExportButtons";
import { LanguageSelector } from "./LanguageSelector";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { 
  LogOut, 
  User, 
  ChevronDown,
  LayoutDashboard,
  // Fleet
  Server,
  FolderTree,
  HardDrive,
  // Software
  Package,
  Rocket,
  Zap,
  GitCompare,
  // Infrastructure
  Database,
  Link as LinkIcon,
  // Security
  Bug,
  Wrench,
  ShieldCheck,
  // Operations
  Activity,
  Bell,
  FileText,
  // Admin
  Users,
  ScrollText,
  KeyRound,
  Settings,
  type LucideIcon
} from "lucide-react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  permission?: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  labelKey: string;
  icon: LucideIcon;
  color: string;
  items: NavItem[];
}

// Color mappings for each category
const colorClasses: Record<string, { active: string; inactive: string; dropdown: string }> = {
  emerald: { 
    active: "bg-emerald-500 text-white border-emerald-500", 
    inactive: "text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/20",
    dropdown: "text-emerald-500"
  },
  blue: { 
    active: "bg-blue-500 text-white border-blue-500", 
    inactive: "text-blue-400 border-blue-500/50 hover:bg-blue-500/20",
    dropdown: "text-blue-500"
  },
  amber: { 
    active: "bg-amber-500 text-white border-amber-500", 
    inactive: "text-amber-400 border-amber-500/50 hover:bg-amber-500/20",
    dropdown: "text-amber-500"
  },
  red: { 
    active: "bg-red-500 text-white border-red-500", 
    inactive: "text-red-400 border-red-500/50 hover:bg-red-500/20",
    dropdown: "text-red-500"
  },
  cyan: { 
    active: "bg-cyan-500 text-white border-cyan-500", 
    inactive: "text-cyan-400 border-cyan-500/50 hover:bg-cyan-500/20",
    dropdown: "text-cyan-500"
  },
  purple: { 
    active: "bg-purple-500 text-white border-purple-500", 
    inactive: "text-purple-400 border-purple-500/50 hover:bg-purple-500/20",
    dropdown: "text-purple-500"
  },
};

// Navigation structure with Lucide icons
const navGroups: NavGroup[] = [
  {
    label: "Fleet",
    labelKey: "nav.fleet",
    icon: Server,
    color: "emerald",
    items: [
      { href: "/nodes", labelKey: "nav.nodes", icon: Server, permission: "nodes:read" },
      { href: "/groups", labelKey: "nav.groups", icon: FolderTree, permission: "groups:read" },
      { href: "/hardware", labelKey: "nav.hardware", icon: HardDrive, permission: "nodes:read" },
    ]
  },
  {
    label: "Software",
    labelKey: "nav.software",
    icon: Package,
    color: "blue",
    items: [
      { href: "/packages", labelKey: "nav.packages", icon: Package, permission: "packages:read" },
      { href: "/repo", labelKey: "nav.repo", icon: HardDrive, permission: "packages:read" },
      { href: "/deployments", labelKey: "nav.deployments", icon: Rocket, permission: "deployments:read" },
      { href: "/jobs", labelKey: "nav.jobs", icon: Zap, permission: "jobs:read" },
      { href: "/software-compare", labelKey: "nav.compare", icon: GitCompare, permission: "nodes:read" },
    ]
  },
  {
    label: "Infra",
    labelKey: "nav.infrastructure",
    icon: Database,
    color: "amber",
    items: [
      { href: "/sql", labelKey: "nav.sql", icon: Database, permission: "services:read" },
      { href: "/services", labelKey: "nav.services", icon: LinkIcon, permission: "services:read" },
    ]
  },
  {
    label: "Security",
    labelKey: "nav.security",
    icon: ShieldCheck,
    color: "red",
    items: [
      { href: "/vulnerabilities", labelKey: "nav.vulnerabilities", icon: Bug, permission: "vulnerabilities:read" },
      { href: "/remediation", labelKey: "nav.remediation", icon: Wrench, permission: "vulnerabilities:read" },
      { href: "/compliance", labelKey: "nav.compliance", icon: ShieldCheck, permission: "compliance:read" },
    ]
  },
  {
    label: "Ops",
    labelKey: "nav.operations",
    icon: Activity,
    color: "cyan",
    items: [
      { href: "/performance", labelKey: "nav.performance", icon: Activity, permission: "nodes:read" },
      { href: "/alerts", labelKey: "nav.alerts", icon: Bell, permission: "alerts:read" },
      { href: "/eventlog", labelKey: "nav.eventlog", icon: FileText, permission: "eventlog:read" },
    ]
  },
  {
    label: "Admin",
    labelKey: "nav.admin",
    icon: Settings,
    color: "purple",
    items: [
      { href: "/users", labelKey: "nav.users", icon: Users, permission: "users:read", adminOnly: true },
      { href: "/audit", labelKey: "nav.audit", icon: ScrollText, permission: "audit:read", adminOnly: true },
      { href: "/api-keys", labelKey: "nav.apiKeys", icon: KeyRound, permission: "api-keys:read" },
      { href: "/settings", labelKey: "nav.settings", icon: Settings },
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
  const GroupIcon = group.icon;

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
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all border ${
          isActive || open ? colors.active : colors.inactive
        }`}
      >
        <GroupIcon className="h-5 w-5" />
        <span className="hidden md:inline">{group.label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl py-2 min-w-[240px] z-50">
          {visibleItems.map((item) => {
            const itemActive = pathname?.startsWith(item.href);
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-5 py-3 text-base font-medium transition-colors ${
                  itemActive
                    ? `${colors.active} mx-2 rounded-lg`
                    : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                }`}
              >
                <ItemIcon className={`h-5 w-5 ${!itemActive ? colors.dropdown : ''}`} />
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" style={{imageRendering: "pixelated"}}>
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
            <span className="hidden md:inline bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent font-bold">Octofleet</span>
          </Link>

          {/* Navigation */}
          <div className="flex items-center gap-2 px-2">
            {/* Dashboard */}
            <Link
              href="/"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all border ${
                pathname === "/" ? dashboardColors.active : dashboardColors.inactive
              }`}
            >
              <LayoutDashboard className="h-5 w-5" />
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

          {/* Right side */}
          <div className="flex items-center gap-3">
            <ExportDropdown />
            <ThemeToggle />
            <LanguageSelector />

            {/* User Menu */}
            {user && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-300 hidden md:inline">
                  <User className="h-4 w-4 inline mr-1" />
                  {user.username}
                </span>
                <button
                  onClick={logout}
                  className="p-2 text-zinc-400 hover:text-white transition-colors"
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
