"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n-context";
import { GlobalBar } from "@/components/GlobalBar";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { PageTransition } from "@/components/PageTransition";
import { LiveEventToast } from "@/components/LiveEventToast";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { useRecentlyOpened } from "@/hooks/useRecentlyOpened";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Start",
  "/tasks": "Tasks",
  "/nodes": "Nodes",
  "/groups": "Groups",
  "/hardware": "Hardware",
  "/packages": "Packages",
  "/repo": "Repository",
  "/deployments": "Deployments",
  "/jobs": "Jobs",
  "/metering": "Software Metering",
  "/software-compare": "Software Compare",
  "/security": "Security",
  "/security/findings": "Security Findings",
  "/security/events": "Security Events",
  "/security/profiles": "Security Profiles",
  "/security/rules": "Security Rules",
  "/security/policies": "Security Policies",
  "/security/posture": "Security Posture",
  "/security/file-audit": "File Audit",
  "/security/audit-log": "Access Audit",
  "/security/evidence": "Evidence",
  "/security/retention": "Retention",
  "/vulnerabilities": "Vulnerabilities",
  "/remediation": "Remediation",
  "/compliance": "Compliance",
  "/performance": "Performance",
  "/alerts": "Alerts",
  "/eventlog": "Event Log",
  "/reports": "Reports",
  "/query": "Query Engine",
  "/services": "Services",
  "/provisioning": "Provisioning",
  "/provisioning/admin": "Provisioning Admin",
  "/content": "Content Lifecycle",
  "/sql": "SQL Manager",
  "/users": "Users",
  "/audit": "Audit",
  "/api-keys": "API Keys",
  "/settings": "Settings",
  "/admin/agents": "Agent Monitor",
};

function humanizeSegment(segment: string) {
  return decodeURIComponent(segment)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getRouteLabel(pathname: string) {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Start";

  if (segments[0] === "nodes" && segments[1]) {
    if (segments[2]) return `Node ${segments[1]} - ${humanizeSegment(segments[2])}`;
    return `Node ${segments[1]}`;
  }

  if (segments[0] === "packages" && segments[1]) {
    return `Package ${segments[1]}`;
  }

  if (segments[0] === "deployments" && segments[1]) {
    return `Deployment ${segments[1]}`;
  }

  if (segments[0] === "jobs" && segments[1]) {
    return `Job ${segments[1]}`;
  }

  if (segments[0] === "groups" && segments[1]) {
    return `Group ${segments[1]}`;
  }

  if (segments[0] === "services" && segments[1]) {
    return `Service ${segments[1]}`;
  }

  return humanizeSegment(segments[segments.length - 1]);
}

function RecentlyOpenedTracker({ pathname }: { pathname: string }) {
  const { trackPage } = useRecentlyOpened();

  useEffect(() => {
    if (!pathname || pathname === "/login") return;
    trackPage(pathname, getRouteLabel(pathname));
  }, [pathname, trackPage]);

  return null;
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <I18nProvider>
      <AuthProvider>
        {!isLoginPage && <RecentlyOpenedTracker pathname={pathname} />}
        {!isLoginPage && (
          <GlobalBar onHamburgerClick={() => setMobileOpen((v) => !v)} />
        )}
        <div className={isLoginPage ? "" : "flex h-[calc(100vh-40px)]"}>
          {!isLoginPage && (
            <AppSidebar
              mobileOpen={mobileOpen}
              onMobileClose={() => setMobileOpen(false)}
            />
          )}
          <main className="flex-1 overflow-y-auto">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <CommandPalette />
        <LiveEventToast />
        <KeyboardShortcuts />
      </AuthProvider>
    </I18nProvider>
  );
}
