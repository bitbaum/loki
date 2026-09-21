"use client";

import Link from "next/link";
import { CURRENT_RELEASE } from "@/config/changelog";
import { useInsideFleetRunner } from "@/hooks/use-inside-fleet-runner";
import { APP_NAME } from "@/config/brand";
import { ECOSYSTEM, ECOSYSTEM_LINKS } from "@/config/ecosystem";
import { FLEET_SITES } from "@/config/fleet-sites";

// PublicFooter — links to legal pages and support surfaces on every
// unauthenticated marketing page. Rendered by PublicSurface so individual
// pages don't need to opt in.
//
// Group A (Product): the things a visitor might want to do next.
// Group B (Legal): trust signals required for a credible product release.
// Group C (Source): GitHub, the org the product ships from.

const FOOTER_GROUPS = [
  {
    heading: "Product",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: "/download" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Roadmap", href: "/roadmap" },
      { label: "Changelog", href: "/releases" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Whitepaper", href: "/whitepaper" },
      { label: "Thoughts", href: "/thoughts" },
      { label: "Frontier", href: "/frontier" },
      { label: "Investors", href: "/investors" },
    ],
  },
  {
    heading: "Support",
    links: [
      // "Support Loki" under a heading already reading SUPPORT asks the
      // reader to fund the project. It goes to the help desk, whose own H1 is
      // "Get help" — so the label promised one thing and delivered another in
      // both directions: someone wanting to contribute lands on a support
      // form, and someone stuck may not click what reads like a donate link.
      { label: "Get help", href: "/support" },
      {
        label: "GitHub issues",
        href: "https://github.com/bitbaum/loki/issues",
        external: true,
      },
    ],
  },
  {
    heading: "Ecosystem",
    links: [
      { label: "OrangeCat — Economy", href: ECOSYSTEM.orangeCat.siteUrl, external: true },
      { label: "Solon — Governance", href: ECOSYSTEM.solon.siteUrl, external: true },
      { label: "Loki on OrangeCat", href: ECOSYSTEM_LINKS.loki, external: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "License", href: "/license" },
    ],
  },
] as const;

export function PublicFooter() {
  // Inside the desktop app, the "Download" link is circular — strip it (the
  // rest of the footer stays useful: sign in, docs, legal, source).
  const insideRunner = useInsideFleetRunner();

  return (
    <footer className="ui-public-footer mx-auto max-w-6xl px-4 pb-10 sm:px-6 sm:pb-12">
      <div className="ui-public-footer-grid">
        {FOOTER_GROUPS.map((group) => (
          /* No gap on a phone: the pointer:coarse floor already gives each
             link a 44px row, so the extra 8px made a 52px pitch and the
             column read as a list with holes punched in it. Desktop keeps
             the gap, where the rows are only as tall as the text. */
          <div key={group.heading} className="flex flex-col sm:gap-2">
            <div className="ui-public-footer-heading">{group.heading}</div>
            {group.links
              .filter((link) => !(insideRunner && link.href === "/download"))
              .map((link) =>
                "external" in link && link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-public-link-standalone text-sm"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="ui-public-link-standalone text-sm"
                  >
                    {link.label}
                  </Link>
                ),
              )}
          </div>
        ))}
      </div>
      {/* Sites the studio builds and runs. Every one had no inbound link from
          anywhere else until this block existed — see config/fleet-sites.ts.
          Plain anchors, not next/link: these are other origins, and the point
          is that a crawler follows them. Collapsed by default so the three
          product pillars above stay the footer's primary content — the links
          remain in the DOM for crawlers whether or not a human opens it.

          NOT "the fleet", though it used to say so. This list is generated from
          apps.conf — ONE box, the studio's — so on a multi-tenant Loki calling
          it the fleet told every visitor that one account's client sites were
          what Loki is. Same error as the /fleet lede, and the same fix: say
          whose they are. The links stay, because they are real work and the
          cross-linking is the reason this block exists; only the claim
          changes. The tenants' own catalogue is one line below. */}
      <details className="ui-public-footer-fleet">
        <summary className="ui-public-footer-fleet-summary">
          Built by the studio — {FLEET_SITES.length} more sites
        </summary>
        <div className="mt-3">
          <Link href="/fleet" className="ui-public-link-standalone text-sm">
            Projects built with Loki — the public catalogue →
          </Link>
        </div>
        <div className="ui-public-footer-fleet-grid mt-4">
          {FLEET_SITES.map((site) => (
            <a
              key={site.url}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-tap flex flex-col justify-center"
            >
              <span className="ui-public-footer-fleet-name">{site.name}</span>
              <span className="ui-public-footer-fleet-blurb">{site.blurb}</span>
            </a>
          ))}
        </div>
      </details>
      <div className="ui-public-footer-bottom">
        <div>
          © {new Date().getFullYear()} {APP_NAME} · Cato
        </div>
        <Link href="/releases" className="ui-public-link font-mono">
          Fleet Runner v{CURRENT_RELEASE.version}
        </Link>
      </div>
    </footer>
  );
}
