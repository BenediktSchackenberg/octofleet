"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/nodes", label: "Nodes", icon: "🖥️" },
  { href: "/groups", label: "Groups", icon: "📁" },
  { href: "/jobs", label: "Jobs", icon: "🚀" },
  { href: "/packages", label: "Packages", icon: "📦" },
  { href: "/eventlog", label: "Eventlog", icon: "📋" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-zinc-900 border-b border-zinc-800">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-white">
            <span className="text-xl">🦎</span>
            <span>OpenClaw Inventory</span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = 
                item.href === "/" 
                  ? pathname === "/" 
                  : pathname.startsWith(item.href);
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                  }`}
                >
                  <span className="mr-1.5">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Settings */}
          <Link 
            href="/settings" 
            className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Einstellungen"
          >
            ⚙️
          </Link>
        </div>
      </div>
    </nav>
  );
}
