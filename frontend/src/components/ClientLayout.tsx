"use client";

import { usePathname } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n-context";
import { Navbar } from "@/components/Navbar";
import { CommandPalette } from "@/components/CommandPalette";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  return (
    <I18nProvider>
      <AuthProvider>
        {!isLoginPage && <Navbar />}
        <main>{children}</main>
        <CommandPalette />
      </AuthProvider>
    </I18nProvider>
  );
}
