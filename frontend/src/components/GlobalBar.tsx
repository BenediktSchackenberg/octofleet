"use client";

import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { BreadcrumbTrail } from "@/components/Breadcrumb";
import { ThemeToggle } from "./ThemeToggle";
import { ExportDropdown } from "./ExportButtons";
import { LanguageSelector } from "./LanguageSelector";
import { NotificationCenter } from "./NotificationCenter";
import { Search, LogOut, User, Menu } from "lucide-react";

export function GlobalBar({ onHamburgerClick }: { onHamburgerClick?: () => void }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();

  return (
    <header className="bg-zinc-900 border-b border-zinc-800 h-10 flex items-center px-3 gap-2 shrink-0 z-50">
      {/* Mobile hamburger */}
      <button
        onClick={onHamburgerClick}
        className="md:hidden p-1 text-zinc-400 hover:text-white transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Breadcrumbs */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <BreadcrumbTrail />
      </div>

      {/* Right side actions */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("openclaw:command-palette"))}
        className="hidden lg:flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-800/50 border border-zinc-700/50 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all text-xs group"
      >
        <Search className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" />
        <span>Search</span>
        <kbd className="ml-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-sans opacity-70">
          Ctrl K
        </kbd>
      </button>
      <NotificationCenter />
      <ExportDropdown />
      <ThemeToggle />
      <LanguageSelector />

      {user && (
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-300 hidden md:inline">
            <User className="h-3.5 w-3.5 inline mr-1" />
            {user.username}
          </span>
          <button
            onClick={logout}
            className="p-1.5 text-zinc-400 hover:text-white transition-colors"
            title={t("nav.logout")}
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}
