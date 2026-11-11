import { ROUTES, SITE_PREVIEW_PARAM } from "@/config/auth";

/** Inputs the landing page has already resolved before it decides what to render. */
export type LandingContext = {
  /** Request came from the Fleet Runner desktop shell (UA marker). */
  insideRunner: boolean;
  /** Session exists AND onboarding is finished. */
  signedIn: boolean;
  /** Raw `searchParams` of the request. */
  params: Record<string, string | string[] | undefined>;
};

/**
 * Where a visitor to "/" should actually end up.
 *
 * Someone signed in goes to the app. The marketing hero is a pitch written
 * for a stranger: it suggests nothing to do and costs a tap ("Open Loki")
 * before anything can be said. That was first fixed for Fleet Runner only,
 * which loads APP_URL with no path at OS startup; a browser kept the pitch.
 * On 2026-11-11 the owner opened loki.orangecat.ch on his phone, signed in,
 * and got the marketing page and its marketing menu.
 *
 * Returns null when the marketing page is the correct answer: anyone signed
 * out (they still need the pitch and the sign-in path), and anyone who asked
 * for the site on purpose with `?site`.
 */
export function landingRedirect(ctx: LandingContext): string | null {
  if (!ctx.signedIn) return null;
  if (ctx.params[SITE_PREVIEW_PARAM] !== undefined) return null;
  return ctx.insideRunner ? ROUTES.RUNNER_HOME : ROUTES.APP_HOME;
}
