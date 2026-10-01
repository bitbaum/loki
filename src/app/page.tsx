import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getUserCount, getDefaultUser } from "@/db/queries/users";
import {
  getHeroFleetSnapshot,
  getShippedFromFeedbackSnapshot,
  type HeroFleetSnapshot,
  type ShippedFeedbackSnapshot,
} from "@/db/queries/public-fleet";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import {
  HOME_AUDIENCES,
  HOME_HERO_CONSOLE,
  HOME_PRODUCT_SURFACES,
  HOME_SAFETY_NOTE,
  HOME_STEPS,
  WHERE_IT_RUNS,
} from "@/config/marketing-content";
import {
  APP_NAME,
  MARKETING_TAGLINE,
  MARKETING_HERO_PRIMARY,
  MARKETING_HERO_SECONDARY,
  MARKETING_POSITIONING,
  MARKETING_POSITIONING_SHORT,
} from "@/config/brand";
import { ROUTES } from "@/config/auth";
import { isFleetRunnerRequest } from "@/lib/fleet-runner";
import { landingRedirect } from "@/lib/landing-destination";
import { COMMISSION } from "@/config/commission";

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await getUserCount()) === 0) redirect("/setup");

  // Inside the desktop app the visitor already has the runner — pitching them
  // a download is circular. Drop every "Download Fleet Runner" CTA in that case.
  const insideRunner = await isFleetRunnerRequest();
  const params = await searchParams;

  const session = await auth();
  // Onboarding is an unfinished flow — keep the redirect so the user finishes it.
  // But once onboarding is done, the homepage is just another public page they
  // are allowed to read. PublicHeaderActions surfaces an "Open Loki →"
  // entry into the app for signed-in visitors.
  let signedIn = false;
  if (session?.user) {
    const done =
      session.user.onboardingComplete === true ||
      Boolean(session.user.onboardedAt && session.user.username);
    if (!done) redirect(ROUTES.ONBOARDING);
    signedIn = true;
  }

  // Fleet Runner launches at OS startup and loads APP_URL with no path, so a
  // signed-in operator's first sight of the day was the marketing hero — a
  // pitch aimed at a stranger, which suggests nothing to do and costs a click
  // before any agent can be launched. See landingRedirect for the full rule.
  const elsewhere = landingRedirect({ insideRunner, signedIn, params });
  if (elsewhere) redirect(elsewhere);

  // Real fleet snapshot for the hero console: the SHOWCASE tier (owner
  // consented AND operator featured) plus fleet-wide totals, public-safe
  // fields only. It used to be the default user's own project list, which in a
  // multi-tenant product published one account because of who it was — see
  // db/queries/public-visibility.ts. Never fabricated; falls back to an empty
  // snapshot so the hero degrades gracefully rather than inventing numbers.
  const fleet: HeroFleetSnapshot = await getHeroFleetSnapshot().catch(() => ({
    isLive: false,
    projects: [],
    metrics: [],
  }));
  const owner = await getDefaultUser().catch(() => null);
  // "Shipped thanks to feedback" — operator-featured resolved reports only
  // (raw visitor text never auto-publishes). Renders nothing until real
  // entries exist, per the same never-fabricate doctrine as the hero.
  const emptyShipped: ShippedFeedbackSnapshot = {
    resolvedCount: 0,
    medianResolutionHours: null,
    entries: [],
  };
  const shipped: ShippedFeedbackSnapshot = owner
    ? await getShippedFromFeedbackSnapshot(owner.id).catch(() => emptyShipped)
    : emptyShipped;

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-hero-fold">
        <div className="w-full max-w-5xl">
          <div className="ui-public-hero-badge">
            <span className="sm:hidden">{MARKETING_POSITIONING_SHORT}</span>
            <span className="hidden sm:inline">{MARKETING_POSITIONING}</span>
          </div>

          <h1 className="ui-public-hero-title">
            {MARKETING_HERO_PRIMARY}
            <br />
            <span className="ui-public-hero-title-dim">{MARKETING_HERO_SECONDARY}</span>
          </h1>

          <p className="ui-public-hero-lede">{MARKETING_TAGLINE}</p>

          {/* One primary action. Three equal buttons used to compete here
              ("Change an existing website", "Start building", "Download
              runner") and the download — a desktop binary — led on phones,
              where it is a dead end. The download lives in "Where the work
              runs" below and in the nav. */}
          <div className="ui-public-hero-actions mx-auto">
            <Link href={signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP} className="ui-public-cta">
              {signedIn ? `Open ${APP_NAME}` : "Start a project"}
            </Link>
            <Link href={COMMISSION.path} className="ui-public-cta-ghost">
              Change a website you have
            </Link>
          </div>
          <p className="ui-public-meta mt-4">
            <Link href="/how-it-works" className="ui-public-link">
              How it works →
            </Link>
          </p>

          {/* Hero product visual — a REAL snapshot of the FLEET, fetched
              server-side: the showcase tier (owner consented AND operator
              featured) plus fleet-wide counts. Public-safe fields only; "LIVE"
              shows only when an agent is actually running. Hidden if there's no
              fleet data, so we never render an empty/fake box. */}
          {fleet.metrics.length > 0 && (
            <div className="ui-public-hero-console">
              <div className="ui-public-hero-console-bar">
                <span className="ui-public-hero-console-label">{HOME_HERO_CONSOLE.label}</span>
                <span
                  className={`ui-public-hero-console-live${fleet.isLive ? "" : " ui-public-hero-console-live-idle"}`}
                >
                  {fleet.isLive ? HOME_HERO_CONSOLE.busy : HOME_HERO_CONSOLE.idle}
                </span>
              </div>
              {fleet.projects.length > 0 && (
                <div className="ui-public-hero-console-rows">
                  {fleet.projects.map((project) => (
                    <div key={project.name} className="ui-public-hero-console-row">
                      <span className="ui-public-hero-console-row-head">
                        <span
                          className={`ui-public-hero-console-dot ui-public-hero-console-dot-${project.state}`}
                        />
                        <span className="ui-public-hero-console-name">{project.name}</span>
                      </span>
                      {project.note && (
                        <span className="ui-public-hero-console-note">{project.note}</span>
                      )}
                      {/* Whose work this is. A showcased project belongs to a
                          tenant; printing it unattributed would read as "our
                          projects". Linked when they have a handle, so being
                          credited is worth something to them. */}
                      {project.by &&
                        (project.by.href ? (
                          <Link href={project.by.href} className="ui-public-hero-console-by">
                            {project.by.label}
                          </Link>
                        ) : (
                          <span className="ui-public-hero-console-by">{project.by.label}</span>
                        ))}
                    </div>
                  ))}
                </div>
              )}
              <div
                className={
                  fleet.projects.length > 0
                    ? "ui-public-hero-console-metrics"
                    : "ui-public-hero-console-metrics ui-public-hero-console-metrics-flush"
                }
              >
                {fleet.metrics.map((metric) => (
                  <div key={metric.label}>
                    <div className="ui-public-hero-console-metric-num">{metric.value}</div>
                    <div className="ui-public-hero-console-metric-label">{metric.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 1 — How it works, in a newcomer's words. */}
      <div className="ui-public-band ui-public-section" id="how">
        <div className="ui-public-container">
          <div className="text-center">
            <div className="ui-public-eyebrow">HOW IT WORKS</div>
            <h2 className="ui-public-display-lg mt-3 sm:mt-4">
              From a sentence to a working site.
            </h2>
          </div>
          <div className="ui-public-section-gap ui-public-howto">
            {HOME_STEPS.map((step) => (
              <section key={step.number} className="ui-public-howto-step">
                <span className="ui-public-howto-num" aria-hidden="true">
                  {step.number}
                </span>
                <h3 className="ui-public-howto-title">{step.title}</h3>
                <p className="ui-public-howto-body">{step.body}</p>
              </section>
            ))}
          </div>
          <p className="ui-public-howto-note">{HOME_SAFETY_NOTE}</p>
        </div>
      </div>

      {/* 2 — Proof: real fixes that shipped because someone asked. */}
      {shipped.entries.length > 0 && (
        <div className="ui-public-section">
          <div className="ui-public-container">
            <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-end md:gap-10">
              <div>
                <div className="ui-public-eyebrow">FIXED BECAUSE SOMEONE ASKED</div>
                <h2 className="ui-public-display-md mt-3 sm:mt-4">Notes in, fixes out.</h2>
              </div>
              <p className="ui-public-section-lede md:justify-self-end">
                Real notes left through the Loki button on a site, fixed by an agent and put online
                {shipped.resolvedCount > 0 && ` — ${shipped.resolvedCount} so far`}.
              </p>
            </div>
            <div className="ui-public-section-gap grid gap-3 sm:grid-cols-3 sm:gap-4">
              {shipped.entries.map((entry) => (
                <section
                  key={`${entry.project}-${entry.resolvedAt}`}
                  className="ui-public-surface-card !min-h-0"
                >
                  <div className="ui-public-surface-card-label">{entry.project}</div>
                  <p className="ui-public-surface-card-body">“{entry.excerpt}”</p>
                  <div className="ui-public-surface-card-meta">
                    <span className="ui-public-surface-card-meta-chip">
                      {entry.page ? `${entry.page} · ` : ""}fixed{" "}
                      {new Date(entry.resolvedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 3 — Who it is for: three doors instead of one pitch. */}
      <div className="ui-public-section">
        <div className="ui-public-container">
          <div className="text-center">
            <div className="ui-public-eyebrow">WHO IT IS FOR</div>
            <h2 className="ui-public-display-lg mt-3 sm:mt-4">Start where you are.</h2>
          </div>
          <div className="ui-public-section-gap grid gap-3 sm:gap-4 md:grid-cols-3">
            {HOME_AUDIENCES.map((door) => (
              <Link key={door.title} href={door.href} className="ui-public-start-card">
                <h3 className="ui-public-start-card-title">{door.title}</h3>
                <p className="ui-public-start-card-body">{door.body}</p>
                <span className="ui-public-start-card-link">{door.cta} →</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 4 — What is inside, for a visitor who wants a look first. */}
      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container">
          <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-end md:gap-10">
            <div>
              <div className="ui-public-eyebrow">INSIDE {APP_NAME.toUpperCase()}</div>
              <h2 className="ui-public-display-lg mt-3 sm:mt-4">You stay in charge.</h2>
            </div>
            <p className="ui-public-section-lede md:justify-self-end">
              {APP_NAME} doesn&rsquo;t write code itself. It runs the AI coding agents that do — and
              shows you what they are doing, what they changed, and what went online.
            </p>
          </div>
          <div className="ui-public-section-gap grid gap-3 sm:grid-cols-2 sm:gap-4">
            {HOME_PRODUCT_SURFACES.map((surface) => (
              <section key={surface.label} className="ui-public-surface-card">
                <div className="ui-public-surface-card-label">{surface.label}</div>
                <h3 className="ui-public-surface-card-title">{surface.title}</h3>
                <p className="ui-public-surface-card-body">{surface.body}</p>
                <div className="ui-public-surface-card-meta">
                  {surface.meta.split(" · ").map((term) => (
                    <span key={term} className="ui-public-surface-card-meta-chip">
                      {term}
                    </span>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <p className="ui-public-meta mt-6 text-center sm:mt-8">
            <Link href="/compare" className="ui-public-link">
              How Loki compares with Claude Code, Codex, Lovable and others →
            </Link>
          </p>
        </div>
      </div>

      {/* 5 — Where the work runs, honest about who can use the cloud. */}
      <div className="ui-public-section">
        <div className="ui-public-container">
          <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-end md:gap-10">
            <div>
              <div className="ui-public-eyebrow">{WHERE_IT_RUNS.eyebrow}</div>
              <h2 className="ui-public-display-md mt-3 sm:mt-4">{WHERE_IT_RUNS.title}</h2>
            </div>
            <p className="ui-public-section-lede md:justify-self-end">{WHERE_IT_RUNS.lede}</p>
          </div>
          <div className="ui-public-section-gap grid gap-3 sm:grid-cols-2 sm:gap-4">
            {WHERE_IT_RUNS.options
              .filter((option) => !(insideRunner && option.cta.href === "/download"))
              .map((option) => (
                <Link key={option.label} href={option.cta.href} className="ui-public-start-card">
                  <div className="ui-public-surface-card-label">{option.label}</div>
                  <h3 className="ui-public-start-card-title mt-2">{option.title}</h3>
                  <p className="ui-public-start-card-body">{option.body}</p>
                  <span className="ui-public-start-card-link">{option.cta.label} →</span>
                </Link>
              ))}
          </div>
        </div>
      </div>

      <div className="ui-public-container border-t border-border-subtle py-14 text-center sm:py-20">
        <Link
          href={signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP}
          className="ui-public-cta-lg w-full sm:w-auto"
        >
          {signedIn ? `Open ${APP_NAME}` : "Start a project"}
        </Link>
        <p className="ui-public-meta mt-4">
          Free while {APP_NAME} is in beta. Open source under the MIT licence.
        </p>
      </div>
    </PublicSurface>
  );
}
