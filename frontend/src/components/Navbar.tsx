"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { ExportDropdown } from "./ExportButtons";
import { LanguageSelector } from "./LanguageSelector";
import { NotificationCenter } from "./NotificationCenter";
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
  Network,
  // Security
  Bug,
  Wrench,
  ShieldCheck,
  Shield,
  // Operations
  Activity,
  Bell,
  FileText,
  // Admin
  Users,
  ScrollText,
  KeyRound,
  Settings,
  Monitor,
  Search,
  Terminal,
  BarChart3,
  Layers,
  type LucideIcon
} from "lucide-react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  permission?: string;
  adminOnly?: boolean;
  section?: string; // Section header above this item
}

interface NavGroup {
  label: string;
  labelKey: string;
  icon: LucideIcon;
  color: string;
  items: NavItem[];
  columns?: number; // Multi-column dropdown
}

// Neutral color scheme: zinc for inactive, cyan for active
const colorClasses: Record<string, { active: string; inactive: string; dropdown: string }> = {
  emerald: { 
    active: "bg-cyan-500/10 text-cyan-400 border-cyan-500", 
    inactive: "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200",
    dropdown: "text-cyan-500"
  },
  blue: { 
    active: "bg-cyan-500/10 text-cyan-400 border-cyan-500", 
    inactive: "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200",
    dropdown: "text-cyan-500"
  },
  amber: { 
    active: "bg-cyan-500/10 text-cyan-400 border-cyan-500", 
    inactive: "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200",
    dropdown: "text-cyan-500"
  },
  red: { 
    active: "bg-cyan-500/10 text-cyan-400 border-cyan-500", 
    inactive: "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200",
    dropdown: "text-cyan-500"
  },
  cyan: { 
    active: "bg-cyan-500/10 text-cyan-400 border-cyan-500", 
    inactive: "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200",
    dropdown: "text-cyan-500"
  },
  purple: { 
    active: "bg-cyan-500/10 text-cyan-400 border-cyan-500", 
    inactive: "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200",
    dropdown: "text-cyan-500"
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
      { href: "/metering", labelKey: "nav.metering", icon: BarChart3, permission: "nodes:read" },
    ]
  },
  {
    label: "Infra",
    labelKey: "nav.infrastructure",
    icon: Database,
    color: "amber",
    items: [
      { href: "/provisioning", labelKey: "nav.provisioning", icon: Network, permission: "services:read" },
      { href: "/content", labelKey: "nav.contentLifecycle", icon: Layers, permission: "services:read" },
      { href: "/sql", labelKey: "nav.sql", icon: Database, permission: "services:read" },
      { href: "/services", labelKey: "nav.services", icon: LinkIcon, permission: "services:read" },
    ]
  },
  {
    label: "Security",
    labelKey: "nav.security",
    icon: ShieldCheck,
    color: "red",
    columns: 2,
    items: [
      // Column 1: Monitoring & Detection
      { href: "/security", labelKey: "nav.securityOverview", icon: ShieldCheck, section: "Monitoring" },
      { href: "/security/findings", labelKey: "nav.findings", icon: Bug },
      { href: "/security/events", labelKey: "nav.securityEvents", icon: Activity },
      { href: "/security/profiles", labelKey: "nav.monitoringProfiles", icon: Shield },
      { href: "/security/rules", labelKey: "nav.behaviorRules", icon: Shield },
      { href: "/security/policies", labelKey: "nav.securityPolicies", icon: Shield },
      // Column 2: Compliance & Vulnerability
      { href: "/vulnerabilities", labelKey: "nav.vulnerabilities", icon: Bug, section: "Compliance" },
      { href: "/remediation", labelKey: "nav.remediation", icon: Wrench },
      { href: "/compliance", labelKey: "nav.compliance", icon: ShieldCheck },
      { href: "/security/posture", labelKey: "nav.configPosture", icon: Shield },
      { href: "/security/file-audit", labelKey: "nav.fileAudit", icon: Shield },
      { href: "/security/audit-log", labelKey: "nav.accessAudit", icon: Shield },
      { href: "/security/evidence", labelKey: "nav.evidence", icon: Shield },
      { href: "/security/retention", labelKey: "nav.retention", icon: Shield },
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
      { href: "/reports", labelKey: "nav.reports", icon: FileText, permission: "nodes:read" },
      { href: "/patches", labelKey: "nav.patches", icon: ShieldCheck, permission: "nodes:read" },
      { href: "/query", labelKey: "nav.queryEngine", icon: Terminal, permission: "nodes:read" },
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
      { href: "/admin/agents", labelKey: "nav.agentMonitor", icon: Monitor, permission: "admin:read", adminOnly: true },
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
        <div className={`absolute top-full left-0 mt-2 bg-card dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-xl shadow-2xl py-2 z-50 ${
          group.columns && group.columns > 1 ? 'min-w-[480px]' : 'min-w-[240px]'
        }`}>
          {group.columns && group.columns > 1 ? (
            <div className="grid grid-cols-2 gap-0 divide-x divide-zinc-700/50">
              {(() => {
                // Split items into columns by section markers
                const cols: NavItem[][] = [[]];
                let currentCol = 0;
                visibleItems.forEach((item, idx) => {
                  if (item.section && idx > 0 && cols.length < group.columns!) {
                    cols.push([]);
                    currentCol++;
                  }
                  cols[currentCol].push(item);
                });
                return cols.map((colItems, ci) => (
                  <div key={ci} className="py-1">
                    {colItems.map((item) => {
                      const itemActive = pathname?.startsWith(item.href) && (item.href !== "/security" || pathname === "/security");
                      const ItemIcon = item.icon;
                      return (
                        <div key={item.href}>
                          {item.section && (
                            <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                              {item.section}
                            </div>
                          )}
                          <Link
                            href={item.href}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors ${
                              itemActive
                                ? `${colors.active} mx-2 rounded-lg`
                                : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                            }`}
                          >
                            <ItemIcon className={`h-4 w-4 ${!itemActive ? colors.dropdown : ''}`} />
                            <span>{t(item.labelKey)}</span>
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          ) : (
            visibleItems.map((item) => {
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
          })
          )}
        </div>
      )}
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const dashboardColors = colorClasses.cyan;

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
          <Link href="/" onClick={() => router.push("/")} className="flex items-center gap-2 font-bold text-white shrink-0 hover:opacity-80 transition-opacity cursor-pointer">
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
              onClick={() => router.push("/")}
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
            <button 
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}))}
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-800/50 border border-zinc-700/50 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all text-xs group"
            >
              <Search className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" />
              <span>Quick Search</span>
              <kbd className="ml-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-sans opacity-70">Ctrl K</kbd>
            </button>
            <NotificationCenter />
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
