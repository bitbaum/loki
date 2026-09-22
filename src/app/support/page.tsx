import Link from "next/link";
import { ArrowUpRight, Bitcoin, BookOpen, Bot, Bug, Cat, Mail } from "lucide-react";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { PublicSurface } from "@/components/public/PublicSurface";
import { ECOSYSTEM_LINKS } from "@/config/ecosystem";
import { INVESTOR_DETAILS } from "@/config/marketing-content";

export const metadata = {
  title: "Support",
  description: "Get help with Loki — docs, GitHub issues, email — or fund the work directly.",
};

// The nav says "Support", so getting help comes first. Funding the work is a
// different intent and lives below under its own heading.
const helpChannels = [
  {
    title: "Documentation",
    body: "Install Fleet Runner, connect your machines, and operate your fleet — setup and troubleshooting guides.",
    href: "/docs",
    cta: "Read the docs",
    external: false,
    icon: BookOpen,
  },
  {
    title: "GitHub issues",
    body: "Found a bug or a missing behavior? File it where the fleet actually picks work up.",
    href: "https://github.com/bitbaum/loki/issues",
    cta: "Open an issue",
    external: true,
    icon: Bug,
  },
  {
    title: "Email",
    body: "For anything that doesn't fit a public issue — account questions, security reports, everything else.",
    href: `mailto:${INVESTOR_DETAILS.contact}`,
    cta: INVESTOR_DETAILS.contact,
    external: true,
    icon: Mail,
  },
] as const;

const supportTargets = [
  {
    title: "Loki",
    body: "Fund the production layer: Loki, supervised agent fleets, and tools that turn intentions into working systems.",
    href: ECOSYSTEM_LINKS.loki,
    icon: Bot,
  },
  {
    title: "OrangeCat",
    body: "Fund the public economic layer for people, projects, groups, products, and services.",
    href: ECOSYSTEM_LINKS.orangeCat,
    icon: Cat,
  },
  {
    title: "Cato",
    body: "Support the founder and follow the entities being built across both products.",
    href: ECOSYSTEM_LINKS.cato,
    icon: Bitcoin,
  },
] as const;

export default function SupportPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container-wide py-12 sm:py-20 lg:py-28">
        <div className="ui-public-eyebrow">Support</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">Get help</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          Stuck on setup, hit a bug, or need a human? Start with the docs, file an issue, or write
          directly.
        </p>
        <div className="ui-public-section-gap grid gap-3 sm:gap-4 md:grid-cols-3">
          {helpChannels.map(({ title, body, href, cta, external, icon: Icon }) => {
            const inner = (
              <>
                {/* Icon and title share a row on a phone — stacked, the glyph
                    cost a full line of height on each of six cards. */}
                <div className="flex items-center gap-3 sm:block">
                  <Icon className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
                  <h2 className="ui-public-prose-strong text-lg sm:mt-5">{title}</h2>
                </div>
                <p className="ui-public-surface-card-body">{body}</p>
                <span className="ui-public-link mt-4 inline-flex min-h-11 items-center gap-1 break-all sm:mt-5 sm:break-normal">
                  {cta} <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </span>
              </>
            );
            return external ? (
              <a
                key={title}
                href={href}
                target={href.startsWith("mailto:") ? undefined : "_blank"}
                rel={href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                className="ui-public-surface-card !min-h-0"
              >
                {inner}
              </a>
            ) : (
              <Link key={title} href={href} className="ui-public-surface-card !min-h-0">
                {inner}
              </Link>
            );
          })}
        </div>

        <section className="mt-12 border-t border-border-subtle pt-10 sm:mt-20 sm:pt-12">
          <h2 className="ui-public-display-md">Fund the work</h2>
          <p className="ui-public-body-lg mt-3 max-w-2xl sm:mt-4">
            OrangeCat is the public funding surface for both sibling products. Choose what you want
            to support, then pay the entity directly in Bitcoin. An OrangeCat account is not
            required to scan a payment request.
          </p>
          <div className="mt-8 grid gap-3 sm:mt-10 sm:gap-4 md:grid-cols-3">
            {supportTargets.map(({ title, body, href, icon: Icon }) => (
              <a
                key={title}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-public-surface-card !min-h-0"
              >
                <div className="flex items-center gap-3 sm:block">
                  <Icon className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
                  <h3 className="ui-public-prose-strong text-lg sm:mt-5">{title}</h3>
                </div>
                <p className="ui-public-surface-card-body">{body}</p>
                <span className="ui-public-link mt-4 inline-flex min-h-11 items-center gap-1 sm:mt-5">
                  Open on OrangeCat <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-border-subtle pt-10 sm:mt-16">
          <h2 className="ui-public-display-md">Why Bitcoin only today?</h2>
          <p className="ui-public-body-lg mt-3 max-w-3xl sm:mt-4">
            Bitcoin gives contributors a public, independently verifiable settlement record while
            remaining non-custodial. Fiat rails expose activity to banks without giving the public
            the same audit trail, and privacy coins deliberately hide it. Both remain research
            topics on the roadmap; neither is presented as available now.
          </p>
          <Link
            href="/roadmap"
            className="ui-public-link mt-4 inline-flex min-h-11 items-center sm:mt-6"
          >
            Read the roadmap →
          </Link>
        </section>
      </main>
    </PublicSurface>
  );
}
