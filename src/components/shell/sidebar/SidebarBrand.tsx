"use client";

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { APP_HOME_HREF } from "@/config/shell";
import { BrandMark } from "../BrandMark";
import { BrandVersion } from "../BrandVersion";

export function SidebarBrand({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <div className="ui-sidebar-section border-b border-border-subtle">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={APP_HOME_HREF}
          // Named: its only child is a picture. Not shrunk: in the folded
          // rail the 40px mark was squeezed to 24px beside the toggle.
          aria-label="Loki, home"
          className="min-w-0 shrink-0 rounded-xl outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BrandMark compact={collapsed} />
        </Link>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="ui-btn-icon hidden md:inline-flex"
          title={toggleLabel}
          aria-label={toggleLabel}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>
      {/* Version stamp under the logo — hidden when the rail is collapsed to a
          mark-only strip. Click → changelog (/releases). */}
      {!collapsed && <BrandVersion />}
    </div>
  );
}
