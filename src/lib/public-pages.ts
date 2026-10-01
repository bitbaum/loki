import { PUBLIC_NAV } from "@/config/auth";

/** Public pages the nav does not link, but a reader (or crawler) should find. */
const PAGES_OUTSIDE_NAV = [
  "/thoughts",
  "/support",
  "/investors",
  "/releases",
  "/privacy",
  "/terms",
  "/license",
  "/docs/quickstart",
  "/docs/feedback-widget",
] as const;

/**
 * Every same-site public page path: the public nav's internal links plus the
 * pages it does not carry. Read from PUBLIC_NAV so a page added to the nav
 * cannot be forgotten by the sitemap — it listed 5 of ~25 until 2026-10-01.
 */
export function publicPagePaths(): string[] {
  const fromNav = PUBLIC_NAV.flatMap((entry) =>
    entry.kind === "menu"
      ? entry.sections.flatMap((section) => section.items.map((item) => item.href))
      : entry.kind === "link"
        ? [entry.href]
        : [],
  ).filter((href) => href.startsWith("/"));
  return [...new Set([...fromNav, ...PAGES_OUTSIDE_NAV])];
}
