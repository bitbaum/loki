"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SidebarBrand } from "./sidebar/SidebarBrand";
import { SidebarNav } from "./sidebar/SidebarNav";

/**
 * The sidebar navigates. It does not act on the account.
 *
 * It used to end in a footer carrying the theme cycle, Settings, "Lock
 * private zone" and "Sign out" — plus a collapse button marked `md:hidden`
 * inside a panel marked `hidden md:flex`, so that button could never render on
 * any viewport. The account actions moved to AccountMenu in the top bar; the
 * one real collapse control has always lived in SidebarBrand, and now it is
 * the only one.
 */
export function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn("ui-sidebar hidden md:flex md:flex-col", collapsed ? "md:w-20" : "md:w-72")}
    >
      <SidebarBrand collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SidebarNav pathname={pathname} collapsed={collapsed} />
      </div>
    </aside>
  );
}
