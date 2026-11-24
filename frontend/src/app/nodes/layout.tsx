"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { FleetTree, FleetTreeProvider } from "@/components/fleet/FleetTree";

/**
 * Fleet workspace: the tree (groups → OS → release) on the left of the Nodes list and of each node
 * page, so opening a node keeps the user's place. Full-screen tools (terminal, shell, screen, live)
 * stay without it. Below md the tree is hidden; the list shows the picked branch as a chip.
 */
function FleetWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const withTree = pathname === "/nodes" || /^\/nodes\/[^/]+$/.test(pathname);
  if (!withTree) return <>{children}</>;
  return (
    <FleetTreeProvider>
      <div className="flex min-h-full">
        <aside className="hidden md:block w-64 shrink-0 sticky top-0 self-start h-[calc(100vh-40px)] overflow-y-auto border-r bg-muted/30">
          <FleetTree />
        </aside>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </FleetTreeProvider>
  );
}

export default function NodesLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams (the list's scope) needs a Suspense boundary
  return (
    <Suspense fallback={null}>
      <FleetWorkspace>{children}</FleetWorkspace>
    </Suspense>
  );
}
