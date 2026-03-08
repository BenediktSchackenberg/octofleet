"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n-context";
import { GlobalBar } from "@/components/GlobalBar";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { PageTransition } from "@/components/PageTransition";
import { LiveEventToast } from "@/components/LiveEventToast";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <I18nProvider>
      <AuthProvider>
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
