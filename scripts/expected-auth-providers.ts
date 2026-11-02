/**
 * The provider ids a deploy must find in /api/auth/providers, derived from the
 * same rules that mount them, so pausing or adding a provider never needs a
 * second edit here. Prints them space-separated; scripts/deploy-hetzner.sh
 * reads the line.
 *
 *   npx tsx scripts/expected-auth-providers.ts   # → "github email-password"
 *   AUTH_RUNTIME=accountkit npx tsx scripts/expected-auth-providers.ts
 *                                                # → "email-password"
 *
 * The env is the BOX's, as deploy-hetzner.sh reads it from /opt/fleet/env and
 * /opt/loki/app/.env: AUTH_RUNTIME, the non-secret OIDC names
 * (ORANGECAT_OAUTH_ISSUER/CLIENT_ID, SIGNIN_ISSUER/CLIENT_ID) and, for each
 * secret, only whether it is set (never its value).
 *
 * - Auth.js runtime: GitHub, Google and X when not paused (PAUSED_PROVIDERS in
 *   src/lib/auth-providers.ts), plus the password form.
 * - AccountKit runtime (AUTH_RUNTIME=accountkit, live since 2026-11-01): the
 *   compat layer lists GitHub through Loki's own app (GITHUB_CLIENT_*,
 *   productGithubApp), the password form, and every OIDC client AccountKit
 *   mounts from env — `orangecat` with ORANGECAT_OAUTH_*, `bitbaum-signin`
 *   with SIGNIN_* (oidcClients). Google and X are not mounted there. Expecting GitHub there failed every deploy after the
 *   switch with "auth provider missing: github" and rolled back a good build;
 *   not expecting OrangeCat let it vanish unnoticed.
 */
import { oidcClients, productGithubApp } from "@bitbaum/accountkit/auth";
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";

import { PAUSED_PROVIDERS } from "../src/lib/auth-providers";

/** Every provider production configures on Auth.js, by the id /api/auth/providers lists. */
const CONFIGURED = [
  { key: "github", id: "github" },
  { key: "google", id: "google" },
  { key: "x", id: "x-1a" },
] as const;

export function expectedAuthProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  if (sharedRuntimeEnabled(env)) {
    return [
      ...(productGithubApp(env) ? ["github"] : []),
      "email-password",
      ...oidcClients(env).map((client) => client.providerId),
    ];
  }
  return [
    ...CONFIGURED.filter(({ key }) => !PAUSED_PROVIDERS[key]).map(({ id }) => id),
    "email-password",
  ];
}

if (process.argv[1]?.endsWith("expected-auth-providers.ts")) {
  console.log(expectedAuthProviders().join(" "));
}
