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
import { HOME_PRODUCT_SURFACES, START_PATHS, HOME_HERO_CONSOLE } from "@/config/marketing-content";
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

          <div className="ui-public-hero-actions mx-auto">
            <Link href={signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP} className="ui-public-cta">
              {signedIn ? `Open ${APP_NAME}` : "Start building"}
            </Link>
            {/* "Download runner" is a dead end on a phone — Fleet Runner is a
                desktop binary (.deb / .dmg / .exe) and there is nothing a
                phone visitor can do with that link but lose their place. They
                get the tour instead; the download keeps its place from `sm`
                up, where the visitor is plausibly on the machine that would
                run it. */}
            <Link href="/docs/quickstart" className="ui-public-cta-ghost sm:hidden">
              See how it works
            </Link>
            {!insideRunner && (
              <Link href="/download" className="ui-public-cta-ghost hidden sm:inline-flex">
                Download runner
              </Link>
            )}
          </div>

          {/* Hero product visual — a REAL snapshot of the owner's fleet (founder
              dogfooding), fetched server-side. Public-safe fields only; "LIVE"
              shows only when an agent is actually running. Hidden if there's no
              fleet data, so we never render an empty/fake box. */}
          {fleet.metrics.length > 0 && (
            <div className="ui-public-hero-console">
              <div className="ui-public-hero-console-bar">
                <span className="ui-public-hero-console-label">{HOME_HERO_CONSOLE.label}</span>
                <span
                  className={`ui-public-hero-console-live${fleet.isLive ? "" : " ui-public-hero-console-live-idle"}`}
                >
                  {fleet.isLive ? "Live" : "Fleet"}
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
                    </div>
                  ))}
                </div>
              )}
              <div className="ui-public-hero-console-metrics">
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

      <div className="ui-public-band ui-public-section">
        <div className="ui-public-container">
          <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-end md:gap-10">
            <div>
              <div className="ui-public-eyebrow">PRODUCT</div>
              <h2 className="ui-public-display-lg mt-3 sm:mt-4">
                One control plane. Local execution.
              </h2>
            </div>
            <p className="ui-public-section-lede md:justify-self-end">
              {APP_NAME} is built for operators already running multiple AI agents across multiple
              projects. It makes the work visible, steerable, and recoverable.
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
        </div>
      </div>

      {shipped.entries.length > 0 && (
        <div className="ui-public-section">
          <div className="ui-public-container">
            <div className="grid gap-4 md:grid-cols-[0.9fr_1.1fr] md:items-end md:gap-10">
              <div>
                <div className="ui-public-eyebrow">SHIPPED BECAUSE A VISITOR ASKED</div>
                <h2 className="ui-public-display-md mt-3 sm:mt-4">
                  The feedback loop, in production.
                </h2>
              </div>
              <p className="ui-public-section-lede md:justify-self-end">
                Real reports from the feedback widget, fixed by the fleet and deployed
                {shipped.resolvedCount > 0 && ` — ${shipped.resolvedCount} resolved so far`}.
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
                      {entry.page ? `${entry.page} · ` : ""}shipped{" "}
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

      <div className="ui-public-section">
        <div className="ui-public-container">
          <div className="text-center">
            <div className="ui-public-eyebrow">GET STARTED</div>
            <h2 className="ui-public-display-lg mt-3 sm:mt-4">Not another coding agent.</h2>
            <p className="ui-public-section-lede mx-auto mt-4">
              Most tools help you write code faster in one file or one project. Loki is for running
              real agent operations at fleet scale — choose your entry point.
            </p>
          </div>

          <div className="ui-public-section-gap grid gap-3 sm:gap-4 md:grid-cols-3">
            {START_PATHS.filter((path) => !(insideRunner && path.href === "/download")).map(
              (path) => (
                /* The card itself is the link. A 44px text link inside a 260px
                 card is a needle to hit with a thumb; the whole surface is the
                 target now, and the arrow row is just its label.

                 order-last below `md`: "Run locally" leads on desktop, where
                 the visitor is plausibly sitting at the machine that would run
                 the agents. On a phone it is the one entry point they cannot
                 take, and leading three choices with it makes the list open on
                 a dead end. The hosted control plane goes first there; the
                 grid restores config order at `md`. */
                <Link
                  key={path.title}
                  href={path.href}
                  className={`ui-public-start-card${path.href === "/download" ? " order-last md:order-none" : ""}`}
                >
                  <h3 className="ui-public-start-card-title">{path.title}</h3>
                  <p className="ui-public-start-card-body">{path.body}</p>
                  <span className="ui-public-start-card-link">{path.cta} →</span>
                </Link>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="ui-public-container border-t border-border-subtle py-14 text-center sm:py-20">
        <Link
          href={signedIn ? ROUTES.APP_HOME : ROUTES.SIGN_UP}
          className="ui-public-cta-lg w-full sm:w-auto"
        >
          {signedIn ? `Open ${APP_NAME}` : "Begin"}
        </Link>
        <p className="ui-public-meta mt-4">For builders running real agent operations.</p>
      </div>
    </PublicSurface>
  );
}
