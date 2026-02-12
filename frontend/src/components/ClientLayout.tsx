"use client";

import { usePathname } from "next/navigation";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n-context";
import { Navbar } from "@/components/Navbar";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  return (
    <I18nProvider>
      <AuthProvider>
        {!isLoginPage && <Navbar />}
        <main>{children}</main>
      </AuthProvider>
    </I18nProvider>
  );
}
