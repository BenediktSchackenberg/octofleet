"use client";

import { usePathname } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n-context";
import { Navbar } from "@/components/Navbar";
import { CommandPalette } from "@/components/CommandPalette";
import { PageTransition } from "@/components/PageTransition";
import { BreadcrumbTrail } from "@/components/Breadcrumb";
import { LiveEventToast } from "@/components/LiveEventToast";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  return (
    <I18nProvider>
      <AuthProvider>
        {!isLoginPage && <Navbar />}
        {!isLoginPage && <BreadcrumbTrail />}
        <main>
          <PageTransition>{children}</PageTransition>
        </main>
        <CommandPalette />
        <LiveEventToast />
        <KeyboardShortcuts />
      </AuthProvider>
    </I18nProvider>
  );
}
