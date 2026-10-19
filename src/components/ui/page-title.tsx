"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The page <h1>. On mobile the AppTopBar already renders the current nav
 * label (e.g. "Control"), so a page whose title IS that label would show it
 * twice — a wasted line at the top of every nav page on the most space-
 * constrained viewport. Hide the h1 on mobile ONLY when it duplicates the top
 * bar's label; detail/flow pages (e.g. "Start a new project", an essay title)
 * keep their h1 because the top bar shows the parent label, not their title.
 */
export function PageTitle({ title }: { title: string }) {
  const duplicatesTopBar = useDuplicatesTopBar(title);
  return <h1 className={cn("ui-page-title", duplicatesTopBar && "hidden md:block")}>{title}</h1>;
}

function useDuplicatesTopBar(title: string): boolean {
  const pathname = usePathname();
  return NAV_ITEMS.find((item) => isCurrentPath(pathname, item.href))?.label === title;
}

/**
 * The block a page's title sits in. When the title is all it holds and the
 * title is hidden on a phone (above), the block goes too: empty, it still
 * took its place in the page's spacing, and Home opened on a blank band above
 * its box (owner's screenshot, 2026-10-19).
 */
export function PageHead({
  title,
  onlyTitle,
  children,
}: {
  title: string;
  /** Nothing but the title inside (no back link, subtitle or actions). */
  onlyTitle: boolean;
  children: React.ReactNode;
}) {
  const duplicates = useDuplicatesTopBar(title);
  const empty = onlyTitle && duplicates;
  return <div className={cn("space-y-3", empty && "hidden md:block")}>{children}</div>;
}
