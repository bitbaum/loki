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
import { ProblemsSection } from "@/components/public/ProblemsSection";
import {
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
import { BUILD_PAGE } from "@/config/build-paths";
import { BuildPaths } from "@/components/public/BuildPaths";

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

  const primaryHref = signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP;
  const primaryLabel = signedIn ? `Open ${APP_NAME}` : "Start a project";

  // One page, read top to bottom on a phone: the promise and the one action,
  // the evidence, then each section a plain heading over rows — no eyebrow
  // labels, no cards inside bands, and orange only on the one action
  // (docs/development/design-reset-2026-10.md). "Who it is for" was cut: its
  // three doors (start a project, change a website, already use agents)
  // repeated the problems list and the build paths word for word.
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-hero-fold">
        <div className="w-full max-w-5xl">
          <p className="ui-public-hero-badge">
            <span className="sm:hidden">{MARKETING_POSITIONING_SHORT}</span>
            <span className="hidden sm:inline">{MARKETING_POSITIONING}</span>
          </p>

          <h1 className="ui-public-hero-title">
            {MARKETING_HERO_PRIMARY}
            <br />
            <span className="ui-public-hero-title-dim">{MARKETING_HERO_SECONDARY}</span>
          </h1>

          <p className="ui-public-hero-lede">{MARKETING_TAGLINE}</p>

          {/* One primary action, and the other way in as a plain link under
              it — two full-width buttons read as two equal choices. */}
          <div className="ui-public-hero-actions mx-auto">
            <Link href={primaryHref} className="ui-public-cta">
              {primaryLabel}
            </Link>
          </div>
          <p className="mt-4">
            <Link href={COMMISSION.path} className="ui-public-text-link">
              Or change a website you have →
            </Link>
          </p>

          {/* Hero product visual — a REAL snapshot of the FLEET, fetched
              server-side: the showcase tier (owner consented AND operator
              featured) plus fleet-wide counts. Public-safe fields only; "Agent
              working" shows only when an agent is actually running. Hidden if
              there's no fleet data, so we never render an empty/fake box. */}
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
      <section className="ui-public-band ui-public-section" id="how" aria-labelledby="how-title">
        <div className="ui-public-container">
          <h2 id="how-title" className="ui-public-h2">
            From a sentence to a working site.
          </h2>
          <ol className="ui-public-section-gap ui-public-howto">
            {HOME_STEPS.map((step) => (
              <li key={step.number} className="ui-public-howto-step">
                <span className="ui-public-howto-num" aria-hidden="true">
                  {step.number}
                </span>
                <h3 className="ui-public-howto-title">{step.title}</h3>
                <p className="ui-public-howto-body">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="ui-public-howto-note">{HOME_SAFETY_NOTE}</p>
        </div>
      </section>

      {/* What it solves — concrete problems, a person's first, then society's.
          Right after "how it works" so the mechanism is followed by what it
          is for. Copy: config/problems-we-solve.ts. */}
      <ProblemsSection signedIn={signedIn} />

      {/* 2 — Proof: real fixes that shipped because someone asked. */}
      {shipped.entries.length > 0 && (
        <section className="ui-public-band ui-public-section" aria-labelledby="shipped-title">
          <div className="ui-public-container">
            <h2 id="shipped-title" className="ui-public-h2">
              Notes in, fixes out.
            </h2>
            <p className="ui-public-section-lede mt-3">
              Real notes left through the Loki button on a site, fixed by an agent and put online
              {shipped.resolvedCount > 0 && ` — ${shipped.resolvedCount} so far`}.
            </p>
            <ul className="ui-public-section-gap ui-public-rows">
              {shipped.entries.map((entry) => (
                <li key={`${entry.project}-${entry.resolvedAt}`} className="ui-public-surface-card">
                  <div className="ui-public-surface-card-label">
                    {entry.project} · {entry.page ? `${entry.page} · ` : ""}fixed{" "}
                    {new Date(entry.resolvedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <p className="ui-public-surface-card-body">“{entry.excerpt}”</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* 3 — Three ways to get it built: yourself, with a partner, or by the
          studio. One list (config/build-paths.ts), the same rows /build shows. */}
      <section className="ui-public-band ui-public-section" aria-labelledby="paths-title">
        <div className="ui-public-container">
          <h2 id="paths-title" className="ui-public-h2">
            {BUILD_PAGE.title}
          </h2>
          <BuildPaths className="ui-public-section-gap" />
        </div>
      </section>

      {/* 4 — What is inside, for a visitor who wants a look first. */}
      <section className="ui-public-band ui-public-section" aria-labelledby="inside-title">
        <div className="ui-public-container">
          <h2 id="inside-title" className="ui-public-h2">
            You stay in charge.
          </h2>
          <p className="ui-public-section-lede mt-3">
            {APP_NAME} doesn&rsquo;t write code itself. It runs the AI coding agents that do — and
            shows you what they are doing, what they changed, and what went online.
          </p>
          <ul className="ui-public-section-gap ui-public-rows ui-public-rows-2">
            {HOME_PRODUCT_SURFACES.map((surface) => (
              <li key={surface.label} className="ui-public-surface-card">
                <div className="ui-public-surface-card-label">{surface.label}</div>
                <h3 className="ui-public-surface-card-title">{surface.title}</h3>
                <p className="ui-public-surface-card-body">{surface.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            <Link href="/compare" className="ui-public-text-link">
              How Loki compares with Claude Code, Codex, Lovable and others →
            </Link>
          </p>
        </div>
      </section>

      {/* 5 — Where the work runs, honest about who can use the cloud. */}
      <section className="ui-public-band ui-public-section" aria-labelledby="runs-title">
        <div className="ui-public-container">
          <h2 id="runs-title" className="ui-public-h2">
            {WHERE_IT_RUNS.title}
          </h2>
          <p className="ui-public-section-lede mt-3">{WHERE_IT_RUNS.lede}</p>
          <ul className="ui-public-section-gap ui-public-rows ui-public-rows-2">
            {WHERE_IT_RUNS.options
              .filter((option) => !(insideRunner && option.cta.href === "/download"))
              .map((option) => (
                <li key={option.label} className="flex">
                  <Link href={option.cta.href} className="ui-public-start-card w-full">
                    <span className="ui-public-surface-card-label">{option.label}</span>
                    <span className="ui-public-start-card-title">{option.title}</span>
                    <span className="ui-public-start-card-body">{option.body}</span>
                    <span className="ui-public-start-card-link">{option.cta.label} →</span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </section>

      <div className="ui-public-container border-t border-border-subtle py-14 text-center sm:py-20">
        <Link href={primaryHref} className="ui-public-cta-lg w-full sm:w-auto">
          {primaryLabel}
        </Link>
        <p className="ui-public-meta mt-4">
          Free while {APP_NAME} is in beta. Open source under the MIT licence.{" "}
          <Link href={BUILD_PAGE.path} className="ui-public-link-standalone">
            Or have it built →
          </Link>
        </p>
      </div>
    </PublicSurface>
  );
}
