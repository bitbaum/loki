"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Lock } from "lucide-react";
import Link from "next/link";
import { SIDEBAR_SECTIONS, type SidebarSection } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { usePrivateZone } from "@/hooks/use-private-zone";
import { SidebarNavItem } from "./SidebarNavItem";

// Per-browser UI preference — which sidebar sections the user has expanded.
// SSOT for defaults lives here; new sections need exactly one entry to opt in
// to the toggle behaviour.
import {
  SIDEBAR_SECTIONS_STORAGE_KEY,
  LEGACY_SIDEBAR_SECTIONS_STORAGE_KEY,
} from "@/config/brand-storage";
// Every loop section starts open. The old default kept three of four sections
// collapsed, which is why the sidebar read as a short list with a lot of
// chevrons: the taxonomy was hidden behind the very control meant to reveal
// it. With the loop there are only three sections and eleven items — they fit.
const DEFAULT_EXPANDED: Record<string, boolean> = {
  now: true, // what needs me
  fleet: true, // what my fleet is doing
  command: true, // how I act on it
  private: false, // the user's own data — opened deliberately, not browsed
};

function loadExpanded(): Record<string, boolean> {
  if (typeof window === "undefined") return DEFAULT_EXPANDED;
  try {
    const raw =
      window.localStorage.getItem(SIDEBAR_SECTIONS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_SIDEBAR_SECTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_EXPANDED;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...DEFAULT_EXPANDED, ...parsed };
  } catch {
    return DEFAULT_EXPANDED;
  }
}

export function SidebarNav({ pathname, collapsed }: { pathname: string; collapsed: boolean }) {
  const { configured, unlocked } = usePrivateZone();
  const privateLocked = configured && !unlocked;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(DEFAULT_EXPANDED);

  // Hydrate from localStorage after mount — server render uses the static
  // defaults so SSR markup matches the first client render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time hydration of persisted UI prefs
    setExpanded(loadExpanded());
  }, []);

  // Always show the user where they are. If they navigate to a page that
  // lives inside a collapsed section, auto-expand that section so the active
  // item is visible. Skip private when locked — the section is non-expandable
  // in that state and the user shouldn't be on a private page anyway.
  useEffect(() => {
    const activeId = SIDEBAR_SECTIONS.find((s) =>
      s.items.some((item) => isCurrentPath(pathname, item.href)),
    )?.id;
    if (!activeId) return;
    if (activeId === "private" && privateLocked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: keep active section visible
    setExpanded((prev) => (prev[activeId] ? prev : { ...prev, [activeId]: true }));
  }, [pathname, privateLocked]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(SIDEBAR_SECTIONS_STORAGE_KEY, JSON.stringify(next));
        window.localStorage.removeItem(LEGACY_SIDEBAR_SECTIONS_STORAGE_KEY);
      } catch {
        // localStorage failures shouldn't break navigation.
      }
      return next;
    });
  }, []);

  return (
    <nav className={collapsed ? "px-2 py-4 space-y-4" : "px-3 py-4 space-y-3"}>
      {SIDEBAR_SECTIONS.map((section) => {
        // The collapsed rail carries the whole loop — Now, Fleet, Command —
        // because eleven icons fit a rail and the loop is the product. Only
        // Private is withheld, and only to keep its lock meaningful.
        if (collapsed && section.private && !privateLocked) {
          return null;
        }
        // Icon-only sidebar shows every remaining item regardless of section
        // expansion (toggling has no visual meaning without labels).
        const isExpanded = collapsed || expanded[section.id] !== false;
        return (
          <SidebarNavSection
            key={section.id}
            section={section}
            pathname={pathname}
            collapsed={collapsed}
            privateLocked={privateLocked}
            isExpanded={isExpanded}
            onToggle={() => toggle(section.id)}
          />
        );
      })}
    </nav>
  );
}

function SidebarNavSection({
  section,
  pathname,
  collapsed,
  privateLocked,
  isExpanded,
  onToggle,
}: {
  section: SidebarSection;
  pathname: string;
  collapsed: boolean;
  privateLocked: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isLocked = Boolean(section.private && privateLocked);

  // When the private zone is locked, the section is not expandable — its
  // header is the unlock affordance itself. There's nothing meaningful to
  // expand into (the user can't see items anyway), and forcing a stale
  // "Unlock to view" entry inside an expandable shell is just clutter.
  if (isLocked) {
    if (collapsed) {
      return (
        <Link
          href="/unlock"
          className="ui-sidebar-utility group relative w-full justify-center px-2"
          aria-label="Unlock private section"
        >
          <Lock className="h-4 w-4 shrink-0" />
          <span className="ui-sidebar-tooltip">Unlock private</span>
        </Link>
      );
    }
    return (
      <Link
        href="/unlock"
        className="ui-sidebar-section-locked"
        aria-label="Unlock private section"
      >
        <span className="flex items-center gap-2">
          <span>{section.label}</span>
          <Lock className="ui-sidebar-section-lock-active" />
        </span>
        <span className="text-text-muted text-micro uppercase tracking-caps">Unlock</span>
      </Link>
    );
  }

  return (
    <div>
      {!collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="ui-sidebar-section-toggle"
          aria-expanded={isExpanded}
          aria-controls={`sidebar-section-${section.id}`}
          title={section.question}
        >
          <span>{section.label}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-text-muted transition-transform ${isExpanded ? "" : "-rotate-90"}`}
            aria-hidden
          />
        </button>
      )}

      {isExpanded && (
        <div id={`sidebar-section-${section.id}`} className="space-y-1.5">
          {section.items.map((item) => (
            <SidebarNavItem
              key={item.id}
              item={item}
              current={isCurrentPath(pathname, item.href)}
              collapsed={collapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
