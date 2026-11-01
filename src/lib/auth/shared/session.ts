/**
 * Loki's session shape, answered from a shared AccountKit session. Every
 * request rereads the `users` row, so a rename, a new username, a finished
 * onboarding or a newly verified address applies at once, and a deleted (or
 * wiped-by-reseed) account is signed out instead of carrying stale claims.
 */
import * as React from "react";
import type { Session } from "next-auth";
import { isDemoEmail } from "@/config/demo";
import { getUserById } from "@/db/queries/users";
import { onboardingCompleteFlag } from "@/lib/onboarding-heal";
import { sharedAuth } from "./runtime";

type SharedSession = { user: { id: string }; session: { expiresAt: Date | string } };

export async function lokiSession(shared: SharedSession | null): Promise<Session | null> {
  if (!shared) return null;
  const row = await getUserById(shared.user.id);
  if (!row) return null;
  return {
    user: {
      id: row.id,
      name: row.name ?? null,
      email: row.email ?? null,
      image: row.image ?? null,
      username: row.username ?? null,
      onboardedAt: row.onboardedAt ?? null,
      onboardingComplete: onboardingCompleteFlag(row),
      emailVerified: row.emailVerified ?? null,
      isDemo: isDemoEmail(row.email),
    },
    expires: new Date(shared.session.expiresAt).toISOString(),
  };
}

// React.cache dedupes per request on the server; outside React (tests) it is absent.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T = React.cache ?? ((fn) => fn);

/** The session of this request (server components, route handlers, actions). */
export const sharedSession = cache(async () => lokiSession(await sharedAuth.getSession()));

/** The session behind request headers (the proxy, the /session endpoint). */
export async function sharedSessionFor(headers: Headers): Promise<Session | null> {
  return lokiSession(await sharedAuth.sessionFor(headers).catch(() => null));
}

/** The shared session id behind these headers, for "keep this session" writes. */
export async function sharedSessionId(headers: Headers): Promise<string | null> {
  const shared = await sharedAuth.sessionFor(headers).catch(() => null);
  return shared?.session.id ?? null;
}
