"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { FeedbackNavCount } from "@/components/feedback/FeedbackNavCount";

export function SidebarNavItem({
  item,
  current,
  collapsed,
}: {
  item: NavItem;
  current: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (!collapsed || !linkRef.current) return;
    const rect = linkRef.current.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 12 });
  }, [collapsed]);

  const handleMouseLeave = useCallback(() => setTooltipPos(null), []);

  return (
    <>
      <Link
        ref={linkRef}
        href={item.href}
        title={item.description}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // The folded rail is icons only, and the name showed under a mouse
        // alone: a person moving with Tab saw a ring around a picture.
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        className={cn(
          "group relative ui-nav-item ui-sidebar-nav-item",
          collapsed ? "justify-center px-2 py-3" : "",
          current && "ui-nav-item-active",
          !item.active && "opacity-40",
        )}
        aria-label={collapsed ? item.label : undefined}
        // MobileNav, MobileNavSheet and FleetSurfaceGuide all announce the
        // current page; the desktop sidebar styled it and stayed silent. The
        // active state existed only for people who can see it.
        aria-current={current ? "page" : undefined}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
        {!collapsed && !item.active && <span className="ml-auto ui-micro-label">soon</span>}
        {/* Live counts stay per-item components (a query, not nav config) —
            the nav item itself remains a static definition. */}
        {item.id === "feedback" && <FeedbackNavCount collapsed={collapsed} />}
      </Link>
      {collapsed &&
        tooltipPos &&
        createPortal(
          <span
            className="ui-sidebar-portal-tooltip"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            {item.label}
          </span>,
          document.body,
        )}
    </>
  );
}
