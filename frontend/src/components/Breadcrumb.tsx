"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Home } from "lucide-react";

export function BreadcrumbTrail() {
  const pathname = usePathname();

  if (!pathname || pathname === "/" || pathname === "/login") return null;

  const segments = pathname.split("/").filter(Boolean);

  const crumbs = segments.map((seg, i) => ({
    label: decodeURIComponent(seg).replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase()),
    href: "/" + segments.slice(0, i + 1).join("/"),
  }));

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
