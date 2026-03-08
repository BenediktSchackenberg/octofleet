"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  AlertTriangle,
  Server,
  FolderTree,
  HardDrive,
  Package,
  Rocket,
  Zap,
  GitCompare,
  Database,
  Link as LinkIcon,
  Network,
  Bug,
  Wrench,
  ShieldCheck,
  Shield,
  Activity,
  Bell,
  FileText,
  Users,
  ScrollText,
  KeyRound,
  Settings,
  Monitor,
  Terminal,
  BarChart3,
  Layers,
  X,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  permission?: string;
  adminOnly?: boolean;
  section?: string;
}

interface NavGroup {
  label: string;
  labelKey: string;
  icon: LucideIcon;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Devices",
    labelKey: "nav.fleet",
    icon: Server,
    items: [
      { href: "/nodes", labelKey: "nav.nodes", icon: Server, permission: "nodes:read" },
      { href: "/groups", labelKey: "nav.groups", icon: FolderTree, permission: "groups:read" },
      { href: "/hardware", labelKey: "nav.hardware", icon: HardDrive, permission: "nodes:read" },
    ],
  },
  {
    label: "Software",
    labelKey: "nav.software",
    icon: Package,
    items: [
      { href: "/packages", labelKey: "nav.packages", icon: Package, permission: "packages:read" },
      { href: "/repo", labelKey: "nav.repo", icon: HardDrive, permission: "packages:read" },
      { href: "/deployments", labelKey: "nav.deployments", icon: Rocket, permission: "deployments:read" },
      { href: "/jobs", labelKey: "nav.jobs", icon: Zap, permission: "jobs:read" },
      { href: "/software-compare", labelKey: "nav.compare", icon: GitCompare, permission: "nodes:read" },
      { href: "/metering", labelKey: "nav.metering", icon: BarChart3, permission: "nodes:read" },
    ],
  },
  {
    label: "Security",
    labelKey: "nav.security",
    icon: ShieldCheck,
    items: [
      { href: "/security", labelKey: "nav.securityOverview", icon: ShieldCheck },
      { href: "/security/findings", labelKey: "nav.findings", icon: Bug },
      { href: "/security/events", labelKey: "nav.securityEvents", icon: Activity },
      { href: "/security/profiles", labelKey: "nav.monitoringProfiles", icon: Shield },
      { href: "/security/rules", labelKey: "nav.behaviorRules", icon: Shield },
      { href: "/security/policies", labelKey: "nav.securityPolicies", icon: Shield },
      { href: "/vulnerabilities", labelKey: "nav.vulnerabilities", icon: Bug },
      { href: "/remediation", labelKey: "nav.remediation", icon: Wrench },
      { href: "/compliance", labelKey: "nav.compliance", icon: ShieldCheck },
      { href: "/security/posture", labelKey: "nav.configPosture", icon: Shield },
      { href: "/security/file-audit", labelKey: "nav.fileAudit", icon: Shield },
      { href: "/security/audit-log", labelKey: "nav.accessAudit", icon: Shield },
      { href: "/security/evidence", labelKey: "nav.evidence", icon: Shield },
      { href: "/security/retention", labelKey: "nav.retention", icon: Shield },
    ],
  },
  {
    label: "Operations",
    labelKey: "nav.operations",
    icon: Activity,
    items: [
      { href: "/performance", labelKey: "nav.performance", icon: Activity, permission: "nodes:read" },
      { href: "/alerts", labelKey: "nav.alerts", icon: Bell, permission: "alerts:read" },
      { href: "/eventlog", labelKey: "nav.eventlog", icon: FileText, permission: "eventlog:read" },
      { href: "/reports", labelKey: "nav.reports", icon: FileText, permission: "nodes:read" },
      { href: "/patches", labelKey: "nav.patches", icon: ShieldCheck, permission: "nodes:read" },
      { href: "/query", labelKey: "nav.queryEngine", icon: Terminal, permission: "nodes:read" },
    ],
  },
  {
    label: "Provisioning",
    labelKey: "nav.infrastructure",
    icon: Network,
    items: [
      { href: "/provisioning", labelKey: "nav.provisioning", icon: Network, permission: "services:read" },
      { href: "/content", labelKey: "nav.contentLifecycle", icon: Layers, permission: "services:read" },
      { href: "/sql", labelKey: "nav.sql", icon: Database, permission: "services:read" },
      { href: "/services", labelKey: "nav.services", icon: LinkIcon, permission: "services:read" },
    ],
  },
  {
    label: "Administration",
    labelKey: "nav.admin",
    icon: Settings,
    items: [
      { href: "/users", labelKey: "nav.users", icon: Users, permission: "users:read", adminOnly: true },
      { href: "/audit", labelKey: "nav.audit", icon: ScrollText, permission: "audit:read", adminOnly: true },
      { href: "/api-keys", labelKey: "nav.apiKeys", icon: KeyRound, permission: "api-keys:read" },
      { href: "/admin/agents", labelKey: "nav.agentMonitor", icon: Monitor, permission: "admin:read", adminOnly: true },
      { href: "/settings", labelKey: "nav.settings", icon: Settings },
    ],
  },
];

// Standalone items (no sub-items)
const standaloneItems: { href: string; label: string; labelKey: string; icon: LucideIcon }[] = [
  { href: "/", label: "Start", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", labelKey: "nav.tasks", icon: AlertTriangle },
];

const STORAGE_KEY = "octofleet-sidebar-collapsed";

export function AppSidebar({ mobileOpen, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const pathname = usePathname();
  const { hasPermission, isAdmin } = useAuth();
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  // Filter items by permissions
  const filterItems = (items: NavItem[]) =>
    items.filter((item) => {
      if (item.adminOnly && !isAdmin()) return false;
      if (item.permission && !hasPermission(item.permission)) return false;
      return true;
    });

  // Find active group
  const activeGroup = navGroups.find((group) =>
    group.items.some((item) =>
      item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href)
    )
  );

  const isStandaloneActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  const isGroupActive = (group: NavGroup) =>
    group.items.some((item) =>
      item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href)
    );

  const activeSubItems = activeGroup ? filterItems(activeGroup.items) : [];

  // For mobile: overlay + drawer
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const sidebarContent = (
    <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-800">
      {/* Header with logo and collapse toggle */}
      <div className="flex items-center h-10 px-3 border-b border-zinc-800 shrink-0">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="22" height="22" style={{ imageRendering: "pixelated" }}>
              <rect x="12" y="4" width="8" height="2" fill="#9333ea" />
              <rect x="10" y="6" width="12" height="2" fill="#9333ea" />
              <rect x="9" y="8" width="14" height="4" fill="#9333ea" />
              <rect x="10" y="12" width="12" height="2" fill="#9333ea" />
              <rect x="11" y="9" width="2" height="2" fill="#ffffff" />
              <rect x="19" y="9" width="2" height="2" fill="#ffffff" />
              <rect x="12" y="10" width="1" height="1" fill="#000000" />
              <rect x="20" y="10" width="1" height="1" fill="#000000" />
              <rect x="8" y="14" width="2" height="4" fill="#a855f7" />
              <rect x="6" y="18" width="2" height="4" fill="#a855f7" />
              <rect x="11" y="14" width="2" height="4" fill="#a855f7" />
              <rect x="10" y="18" width="2" height="4" fill="#a855f7" />
              <rect x="14" y="14" width="4" height="4" fill="#a855f7" />
              <rect x="14" y="18" width="4" height="4" fill="#a855f7" />
              <rect x="19" y="14" width="2" height="4" fill="#a855f7" />
              <rect x="20" y="18" width="2" height="4" fill="#a855f7" />
              <rect x="22" y="14" width="2" height="4" fill="#a855f7" />
              <rect x="24" y="18" width="2" height="4" fill="#a855f7" />
            </svg>
            <span className="bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent font-bold text-sm">
              Octofleet
            </span>
          </Link>
        )}
        <div className="flex-1" />
        {mobileOpen ? (
          <button onClick={onMobileClose} className="p-1 text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={toggleCollapse}
            className="p-1 text-zinc-400 hover:text-white transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {/* Standalone items */}
        {standaloneItems.map(({ href, label, labelKey, icon: Icon }) => {
          const active = isStandaloneActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onMobileClose}
              title={collapsed ? (t(labelKey) || label) : undefined}
              className={`flex items-center gap-3 h-11 rounded-lg mb-0.5 transition-colors ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
                active
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="text-sm font-medium truncate">{t(labelKey) || label}</span>}
            </Link>
          );
        })}

        {/* Divider */}
        <div className="border-t border-zinc-800 my-2" />

        {/* Group items */}
        {navGroups.map((group) => {
          const visible = filterItems(group.items);
          if (visible.length === 0) return null;
          const active = isGroupActive(group);
          const Icon = group.icon;
          // Primary item links to first sub-item
          const primaryHref = visible[0].href;

          return (
            <Link
              key={group.label}
              href={primaryHref}
              onClick={onMobileClose}
              title={collapsed ? group.label : undefined}
              className={`flex items-center gap-3 h-11 rounded-lg mb-0.5 transition-colors ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
                active
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="text-sm font-medium truncate">{group.label}</span>}
            </Link>
          );
        })}

        {/* Sub-items for active section */}
        {activeSubItems.length > 0 && (
          <>
            <div className="border-t border-zinc-800 my-2" />
            {!collapsed && activeGroup && (
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                {activeGroup.label}
              </div>
            )}
            {activeSubItems.map((item) => {
              const itemActive =
                item.href === "/security"
                  ? pathname === "/security"
                  : pathname?.startsWith(item.href);
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onMobileClose}
                  title={collapsed ? t(item.labelKey) : undefined}
                  className={`flex items-center gap-3 h-9 rounded-lg mb-0.5 transition-colors ${
                    collapsed ? "justify-center px-0" : "px-3 pl-5"
                  } ${
                    itemActive
                      ? "bg-cyan-500/10 text-cyan-400"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  <ItemIcon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="text-sm truncate">{t(item.labelKey)}</span>}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </div>
  );

  // Mobile: slide-out drawer
  if (mobileOpen) {
    return (
      <>
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onMobileClose} />
        <div className="fixed left-0 top-10 bottom-0 w-60 z-50 md:hidden">{sidebarContent}</div>
      </>
    );
  }

  // Desktop
  return (
    <div
      className="hidden md:flex shrink-0 transition-all duration-200"
      style={{ width: collapsed ? 64 : 240 }}
    >
      {sidebarContent}
    </div>
  );
}
