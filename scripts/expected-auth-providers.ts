/**
 * The NextAuth provider ids a deploy must find mounted, derived from
 * PAUSED_PROVIDERS (src/lib/auth-providers.ts) so pausing a broken provider
 * there does not fail every deploy's post-deploy check. Prints them space-
 * separated; scripts/deploy-hetzner.sh reads the line.
 *
 *   npx tsx scripts/expected-auth-providers.ts   # → "github email-password"
 */
import { PAUSED_PROVIDERS } from "../src/lib/auth-providers";

/** Every provider production configures, by the id /api/auth/providers lists. */
const CONFIGURED = [
  { key: "github", id: "github" },
  { key: "google", id: "google" },
  { key: "x", id: "x-1a" },
] as const;

const ids = CONFIGURED.filter(({ key }) => !PAUSED_PROVIDERS[key]).map(({ id }) => id);
console.log([...ids, "email-password"].join(" "));
