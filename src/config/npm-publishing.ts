import { z } from "zod";

/**
 * Getting the fleet's packages onto npm from a phone (src/lib/packages/npm-publish.ts).
 *
 * The one step that stays a person's: npm lets only the account create a
 * package or link it to GitHub, behind the account's passkey. So the owner
 * makes ONE key on npmjs.com and pastes it into Loki; everything after —
 * GitHub secrets, starting each package's publish.yml, checking npm — is
 * Loki's. Chrome and Brave on Android run no extensions, so Loki cannot type
 * into npm's form on a phone; the panel lists the exact settings instead.
 */

/** The GitHub Actions secret every publish.yml reads for a first version. */
export const NPM_KEY_SECRET = "NPM_BOOTSTRAP_TOKEN";
/** The workflow file every @bitbaum package carries (bitbaum/fleet templates/package). */
export const PUBLISH_WORKFLOW = "publish.yml";

/** The fleet's npm account — public on every package page it publishes. */
export const NPM_ACCOUNT = "maonakamoto";
export const NPM_NEW_KEY_URL = `https://www.npmjs.com/settings/${NPM_ACCOUNT}/tokens/granular-access-tokens/new`;

/** What to set on that page, in its own words, top to bottom. */
export const NPM_KEY_SETTINGS: ReadonlyArray<{ field: string; value: string }> = [
  { field: "Token name", value: "Loki" },
  { field: "Expiration", value: "90 days (the longest npm allows)" },
  { field: "Bypass two-factor authentication", value: "ticked" },
  { field: "Packages and scopes", value: "Read and write · All packages" },
  { field: "Organizations", value: "No access" },
];

/** Loki stops before npm does, so a run never starts with a key about to die. */
export const KEY_EXPIRY_MARGIN_MS = 60 * 60_000;
/** A first publish Loki started is left alone this long before it tries again. */
export const RETRY_AFTER_MS = 6 * 60 * 60_000;
export const KEY_SAVES_PER_HOUR = 10;

/** npm granular keys: `npm_` and 36 letters or digits. */
const NPM_KEY = /^npm_[A-Za-z0-9]{36}$/;

export const SaveNpmKeyBody = z.object({
  key: z.string().trim().regex(NPM_KEY, "An npm key starts with npm_ and is 40 characters long."),
  days: z.number().int().min(1).max(365).default(90),
});

export const NPM_PUBLISH_MESSAGES = {
  rejected: "npm did not accept that key. Check you copied all of it, and that it is not expired.",
  unreachable: "Could not reach npm just now — try again in a minute.",
  rateLimited: "Saved several times just now — wait a moment.",
  noAccess:
    "Loki can only publish packages whose repository you own. Connect GitHub, or ask the package's owner.",
} as const;
