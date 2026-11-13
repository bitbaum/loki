import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";

/**
 * A public link as the person reading it should see it. Signed in, the
 * homepage hero said "Open Loki" while the rows under it still said "Create
 * an account" and "Start a project" (to /sign-up) and the footer said
 * "Sign in" (2026-11-12): one page, two answers to whether you are signed in.
 * Signed in, a link into an account becomes the way into Loki; every other
 * link is left alone.
 */
export function visitorLink<T extends { label: string; href: string }>(
  link: T,
  signedIn: boolean,
): T {
  if (!signedIn) return link;
  if (link.href !== ROUTES.SIGN_UP && link.href !== ROUTES.SIGN_IN) return link;
  return { ...link, label: `Open ${APP_NAME}`, href: ROUTES.APP_HOME } as T;
}
