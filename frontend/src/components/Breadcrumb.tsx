"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Home } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";
import { useRecentlyOpened } from "@/hooks/useRecentlyOpened";
import { crumbLabel } from "@/lib/routes";

export function BreadcrumbTrail() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { recent } = useRecentlyOpened();

  if (!pathname || pathname === "/" || pathname === "/login") return null;

  const segments = pathname.split("/").filter(Boolean);

  // names reported by detail pages (a group's name instead of its id)
  const names = new Map(recent.filter((r) => r.name).map((r) => [r.href, r.name as string]));
  const crumbs = segments.map((_, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    return { label: crumbLabel(href, t, names.get(href)), href };
  });

  return (
    <motion.nav
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 px-6 py-2 text-xs text-zinc-500 bg-zinc-950 border-b border-zinc-800/50"
    >
      <Link href="/" className="hover:text-zinc-300 transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3 text-zinc-700" />
          {i === crumbs.length - 1 ? (
            <span className="text-zinc-300 font-medium">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-zinc-300 transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </motion.nav>
  );
}
