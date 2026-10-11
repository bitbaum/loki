/**
 * One session for every headless check that drives the AUTHENTICATED app:
 * the responsive audit and the ship report. The cookie name follows the
 * scheme (Auth.js prefixes it with __Secure- on https), and the token comes
 * from the environment or is minted from an explicitly supplied Postgres URL.
 *
 * Resolution order:
 *   LOKI_SESSION_TOKEN     — set it and nothing else is needed
 *   AUDIT_DATABASE_URL     — mints a JWT itself (scripts/db-tunnel.sh prints
 *                            the URL for a firewalled Postgres over SSH)
 * Deliberately NOT reusing print-session-token.ts: that resolves a DIRECT box
 * connection from .env.hetzner.local, which is exactly what is unreachable
 * from a sandboxed or CI runner.
 */

export function sessionCookieName(base) {
  return base.startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/** A session token for `base`, or null when nothing can supply one. */
export async function mintSessionToken(base) {
  const fromEnv = process.env.LOKI_SESSION_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const dbUrl = process.env.AUDIT_DATABASE_URL?.trim();
  const secret = process.env.AUTH_SECRET?.trim();
  if (!dbUrl || !secret) return null;

  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1, ssl: false });
  try {
    const rows = await sql`
      SELECT id, email, name, username, onboarded_at
      FROM users
      WHERE is_default = true OR email IS NOT NULL
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `;
    const u = rows[0];
    if (!u?.id) return null;
    const { encode } = await import("@auth/core/jwt");
    return await encode({
      token: {
        id: u.id,
        email: u.email,
        name: u.name,
        username: u.username,
        onboardedAt: u.onboarded_at,
        onboardingComplete: Boolean(u.username && u.onboarded_at),
        sub: u.id,
      },
      secret,
      salt: sessionCookieName(base),
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

/**
 * The cookies a browser context needs: the session (only when there is one —
 * a cookie with an undefined value is not "no cookie", it is a malformed one
 * Playwright rejects) and, when LOKI_PRIVATE_ZONE_COOKIE is set, the
 * private-zone unlock (scripts/test/print-private-zone-cookie.ts).
 */
export function sessionCookies(base, token) {
  const domain = new URL(base).hostname;
  const secure = base.startsWith("https://");
  const cookies = token
    ? [{ name: sessionCookieName(base), value: token, domain, path: "/", httpOnly: true, secure }]
    : [];
  const pz = process.env.LOKI_PRIVATE_ZONE_COOKIE?.trim();
  const pzEq = pz ? pz.indexOf("=") : -1;
  if (pzEq > 0) {
    cookies.push({
      name: pz.slice(0, pzEq),
      value: pz.slice(pzEq + 1),
      domain,
      path: "/",
      httpOnly: true,
      secure,
    });
  }
  return cookies;
}
