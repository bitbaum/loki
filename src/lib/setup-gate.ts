import { ROUTES } from "@/config/auth";

/**
 * Where /setup sends a visitor, given how many accounts exist.
 *
 * /setup creates the FIRST account of an install. Once any account exists the
 * API refuses (409 "Setup already complete"), but the page used to render the
 * full "Create your admin account" form anyway — so a stranger who found the
 * URL filled it in and hit a wall. With users present the only useful place is
 * sign-in; `null` means "show the form".
 */
export function setupRedirectFor(userCount: number): string | null {
  return userCount > 0 ? ROUTES.SIGN_IN : null;
}
