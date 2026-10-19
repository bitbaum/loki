import type { users } from "@/db/schema";
import { hasValidUsername, suggestUsername } from "@/lib/onboarding";

type UserRow = typeof users.$inferSelect;

export type HealPatch = { username?: string; onboardedAt?: Date };

/**
 * Pure decision: given a user row, their active project count, and whether
 * the suggested username is available, returns the patch to apply (or null
 * if no heal needed). Extracted from healReturningUserOnboarding so the
 * branch logic is unit-testable without DB plumbing — see
 * scripts/test/onboarding-heal.ts.
 *
 * Lives in its own file (rather than inside onboarding-heal.ts) because the
 * test script must not pull in @/db at import time — that file initializes
 * the Postgres pool and fails without DATABASE_URL.
 *
 * Policy (updated 2026-06-05): heal fires for ANY user with a derivable,
 * unclaimed username — first-time sign-ins included. This bypasses the
 * /onboarding page entirely for the common GitHub-OAuth case (name + email
 * present → suggestion derives cleanly → mark onboarded). The username is
 * editable later from /settings → Profile, so we're not stealing the user's
 * choice — just defaulting it. Users whose suggestion collides or comes back
 * empty still fall through to the manual /onboarding flow.
 *
 * Project-count is now unused; kept in the signature for the heal wrapper's
 * convenience (it queries it anyway for other purposes) and to preserve the
 * test signature.
 */
export function decideHealPatch(
  user: Pick<UserRow, "name" | "email" | "username" | "onboardedAt">,
  _projectCount: number,
  suggestedUsernameAvailable: boolean,
  /** A free variant of the suggestion ("ximena2") when the plain one is
   *  taken — found by the caller, which can ask the database. */
  freeUsername?: string | null,
): HealPatch | null {
  let username = user.username;
  if (!hasValidUsername(username)) {
    const suggested = freeUsername ?? suggestUsername(user.name, user.email);
    if (suggested && suggestedUsernameAvailable) {
      username = suggested;
    }
  }

  const needsUsername = !hasValidUsername(user.username) && hasValidUsername(username);
  // Only set onboardedAt once a valid username is in hand. Setting it without
  // a username is a no-op (isOnboardingComplete still returns false), so we
  // skip the wasted DB write — the user falls through to manual /onboarding.
  const needsOnboarded = user.onboardedAt == null && hasValidUsername(username);

  if (!needsUsername && !needsOnboarded) return null;

  return {
    ...(needsUsername && username ? { username } : {}),
    ...(needsOnboarded ? { onboardedAt: new Date() } : {}),
  };
}

/** The suggestion, then the same with 2…9 — every one still a valid handle. */
export function usernameCandidates(suggested: string): string[] {
  return [suggested, ...Array.from({ length: 8 }, (_, i) => `${suggested}${i + 2}`)].filter(
    hasValidUsername,
  );
}
