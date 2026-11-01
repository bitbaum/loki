/**
 * The NextAuth provider ids a deploy must find mounted, derived from
 * PAUSED_PROVIDERS (src/lib/auth-providers.ts) so pausing a broken provider
 * there does not fail every deploy's post-deploy check. Prints them space-
 * separated; scripts/deploy-hetzner.sh reads the line.
 *
 *   npx tsx scripts/expected-auth-providers.ts   # → "github email-password"
 *   AUTH_RUNTIME=accountkit npx tsx scripts/expected-auth-providers.ts
 *                                                # → "email-password"
 *
 * AUTH_RUNTIME is the BOX's value (deploy-hetzner.sh reads it from
 * /opt/loki/app/.env): on the AccountKit runtime GitHub, Google and X are not
 * mounted by design (getEnabledAuthProviders), so expecting them failed every
 * deploy after the 2026-11-01 switch with "auth provider missing: github" and
 * rolled back a build that was fine.
 */
import { sharedRuntimeEnabled } from "@bitbaum/accountkit/auth/switch";

import { PAUSED_PROVIDERS } from "../src/lib/auth-providers";

/** Every provider production configures, by the id /api/auth/providers lists. */
const CONFIGURED = [
  { key: "github", id: "github" },
  { key: "google", id: "google" },
  { key: "x", id: "x-1a" },
] as const;

const ids = sharedRuntimeEnabled()
  ? []
  : CONFIGURED.filter(({ key }) => !PAUSED_PROVIDERS[key]).map(({ id }) => id);
console.log([...ids, "email-password"].join(" "));
