import { ROUTES } from "@/config/auth";
import { COMMISSION } from "@/config/commission";

/**
 * The three ways to get something built — the one list.
 *
 * Every door a newcomer meets ends in one of these: build it yourself on
 * Loki, build it with a partner the studio approves, or have the studio build
 * it. They used to be scattered — the landing page offered only the first,
 * the public nav hid the third under "bitbaum", the partner directory was
 * reachable from OrangeCat's careers page and nowhere here, and a stranger who
 * watched a fix land on someone else's site was sent to a bare homepage.
 *
 * Read by the landing page, `/build`, the widget's "made with Loki" line and
 * the tour's end card. Add a path here and every door learns it.
 */
export type BuildPath = {
  id: "yourself" | "partner" | "studio";
  title: string;
  body: string;
  cta: string;
  href: string;
  /** Who it is for, in one phrase — the card's label. */
  who: string;
};

export const BUILD_PATHS: readonly BuildPath[] = [
  {
    id: "yourself",
    who: "Do it yourself",
    title: "Build it yourself",
    body: "Describe it in plain words. AI coding agents build it, put it online, and change it whenever you say what should be different. Free while Loki is in beta.",
    cta: "Start a project",
    href: ROUTES.SIGN_UP,
  },
  {
    id: "partner",
    who: "With a partner",
    title: "Build it with a partner",
    body: "Independent engineers the studio approves. They watch over a project built with Loki and move it forward, at their own price — you stay the owner.",
    cta: "Find a partner",
    href: "https://bitbaum.orangecat.ch/partners/",
  },
  {
    id: "studio",
    who: "Have it built",
    title: "Have bitbaum build it",
    body: "The studio behind Loki ships systems and keeps them running. Bring a brief; the studio takes it from there and you follow along on Loki.",
    cta: "Hire the studio",
    href: COMMISSION.studioHireUrl,
  },
] as const;

export const BUILD_PAGE = {
  path: "/build",
  eyebrow: "THREE WAYS IN",
  title: "Build it the way that fits.",
  lede: "Yourself, with a partner, or let the studio do it. Every way ends the same: something of yours, online, that keeps getting better when you say so.",
} as const;

/** The /build link a stranger's touchpoint hands out, naming where they saw Loki. */
export function buildPageHref(base: string, from?: string | null): string {
  const host =
    from
      ?.trim()
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0] ?? "";
  const clean = /^[a-z0-9.-]{1,120}$/i.test(host) ? host : "";
  return `${base}${BUILD_PAGE.path}${clean ? `?from=${encodeURIComponent(clean)}` : ""}`;
}

/** The hostname a `?from=` carries, or null when it is not one. */
export function fromHost(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  return /^[a-z0-9.-]{1,120}$/i.test(v) && v.includes(".") ? v : null;
}
