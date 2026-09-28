/**
 * Where OrangeCat is, for the pieces of Loki that must know without touching
 * the database.
 *
 * These two lines used to live in lib/integrations/orangecat.ts, which imports
 * @/db — and @/db throws at module init when no connection string is set. That
 * was harmless while the only readers were the SDK client and Auth.js, both of
 * which run with a database. The MCP server's token check is different: it has
 * to name the issuer it trusts in a pure module the unit suite can load, so the
 * value moved here and every reader imports it from here.
 */

/** SSOT fallback for the OrangeCat origin when the env override is unset
 *  (ORANGECAT_API_BASE / ORANGECAT_OAUTH_ISSUER). */
export const ORANGECAT_BASE_FALLBACK = "https://orangecat.ch";

/**
 * The OrangeCat authorization server — the `iss` every OrangeCat token carries,
 * and the origin its OIDC discovery and JWKS hang off. "Login with OrangeCat",
 * the per-user token refresh and the MCP resource server all trust THIS value,
 * so a staging issuer is one env var rather than three. Compared byte-for-byte
 * against `iss`, so it is not normalised here: a trailing slash in the env is
 * a different issuer, exactly as OIDC discovery would treat it.
 */
export const ORANGECAT_OAUTH_ISSUER = process.env.ORANGECAT_OAUTH_ISSUER ?? ORANGECAT_BASE_FALLBACK;
