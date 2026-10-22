"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The page's one <h1> (design reset rule 1: exactly one <h1> in the DOM at
 * every width).
 *
 * On a phone the top bar names the page (AppTopBar), so a title that IS that
 * name is read but not drawn here — `sr-only`, never `display:none`, so it is
 * still the page's heading for a screen reader and for the page audit. The top
 * bar sees this h1 in <main> and draws its name as plain text, not a second
 * h1. A title that is NOT the nav label ("Start a new project", an essay) is
 * drawn at every width, because the top bar shows the parent's name.
 */
export function PageTitle({ title }: { title: string }) {
  const duplicatesTopBar = useDuplicatesTopBar(title);
  return <h1 className={cn("ui-page-title", duplicatesTopBar && "max-md:sr-only")}>{title}</h1>;
}

function useDuplicatesTopBar(title: string): boolean {
  const pathname = usePathname();
  return NAV_ITEMS.find((item) => isCurrentPath(pathname, item.href))?.label === title;
}

/**
 * The block a page's title sits in. When the title is all it holds and the
 * title is not drawn on a phone (above), the block is not drawn either — it
 * is visually hidden, with the h1 inside it still read. Empty, it took its
 * place in the page's spacing, and Home opened on a blank band above its box
 * (owner's screenshot, 2026-10-19).
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
  return <div className={cn("space-y-3", empty && "max-md:sr-only")}>{children}</div>;
}
