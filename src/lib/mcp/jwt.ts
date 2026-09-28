/**
 * Verifying an OrangeCat access token, with nothing but node:crypto.
 *
 * Why hand-rolled: Loki has no JOSE dependency, and the token it must accept is
 * one narrow shape — RS256, signed by one issuer, for one audience. A general
 * JOSE library would accept more than that; this accepts exactly that, and
 * every rejection below names a real way a token can be wrong.
 *
 * The audience check is the one that must never be relaxed. OrangeCat also
 * mints tokens for its other clients (Loki's own "Login with OrangeCat"
 * included, whose `aud` is a client id). Every one of them is a validly signed
 * OrangeCat JWT; only `aud` says it was minted to be spent HERE. Accepting a
 * client-id audience would let any app that can obtain a user's OrangeCat token
 * drive their Loki.
 */
import { createPublicKey, verify, type KeyObject, type webcrypto } from "node:crypto";

export type VerifiedAccessToken = {
  /** OrangeCat actor id — what a Loki user is linked by. */
  sub: string;
  /** OrangeCat user id. Informational; the link is by actor. */
  uid: string | null;
  scopes: string[];
  clientId: string | null;
  exp: number;
};

export type VerifyResult = { ok: true; token: VerifiedAccessToken } | { ok: false; reason: string };

/** Resolves a signing key by `kid`; null when the issuer does not publish it. */
export type KeyResolver = (kid: string | undefined) => Promise<KeyObject[]>;

/** Clock skew tolerated on exp/nbf. Small: a token is minutes-lived, not hours. */
const CLOCK_SKEW_SECONDS = 60;

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  jwt: string,
  expect: { issuer: string; audience: string; keys: KeyResolver; nowSeconds?: number },
): Promise<VerifyResult> {
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) {
    return { ok: false, reason: "not a JWT" };
  }
  const [h, p, s] = parts;
  const header = decodeSegment(h);
  const payload = decodeSegment(p);
  if (!header || !payload) return { ok: false, reason: "malformed JWT" };

  // Pinned, not read from the token: an attacker picks `alg`, so honouring it is
  // how `none` and HMAC-with-the-public-key forgeries get in.
  if (header.alg !== "RS256") return { ok: false, reason: "unsupported alg" };

  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const candidates = await expect.keys(kid);
  if (candidates.length === 0) return { ok: false, reason: "unknown signing key" };
  const signed = Buffer.from(`${h}.${p}`);
  const signature = Buffer.from(s, "base64url");
  const valid = candidates.some((key) => {
    try {
      return verify("sha256", signed, key, signature);
    } catch {
      return false;
    }
  });
  if (!valid) return { ok: false, reason: "bad signature" };

  if (payload.iss !== expect.issuer) return { ok: false, reason: "wrong issuer" };

  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(expect.audience)) return { ok: false, reason: "wrong audience" };

  const now = expect.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number") return { ok: false, reason: "no expiry" };
  if (payload.exp <= now - CLOCK_SKEW_SECONDS) return { ok: false, reason: "expired" };
  if (typeof payload.nbf === "number" && payload.nbf > now + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "not yet valid" };
  }

  if (typeof payload.sub !== "string" || !payload.sub) return { ok: false, reason: "no subject" };

  return {
    ok: true,
    token: {
      sub: payload.sub,
      uid: typeof payload.uid === "string" ? payload.uid : null,
      scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
      clientId: typeof payload.client_id === "string" ? payload.client_id : null,
      exp: payload.exp,
    },
  };
}

type Jwk = webcrypto.JsonWebKey & { kid?: string };

/** How long a fetched key set is trusted before it is fetched again. */
const JWKS_TTL_MS = 10 * 60 * 1000;
/**
 * The floor between refetches triggered by an unknown `kid`. A key rotation is
 * found on the first request that carries the new kid; without this floor, a
 * stream of tokens with made-up kids would turn Loki into a fetch amplifier
 * aimed at OrangeCat.
 */
const JWKS_MIN_REFETCH_MS = 30 * 1000;

/**
 * A cached key set with the one refetch rotation needs. `fetchJwks` is
 * injected so the cache is testable without a network.
 */
export function createJwksResolver(
  fetchJwks: () => Promise<{ keys?: unknown }>,
  clock: () => number = Date.now,
): KeyResolver {
  let keys: Jwk[] = [];
  let fetchedAt = -Infinity;
  let inFlight: Promise<void> | null = null;
  const imported = new Map<Jwk, KeyObject | null>();

  const refresh = () => {
    inFlight ??= fetchJwks()
      .then((set) => {
        keys = Array.isArray(set.keys) ? (set.keys as Jwk[]) : [];
        fetchedAt = clock();
        imported.clear();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const usable = (kid: string | undefined): KeyObject[] =>
    keys
      .filter((k) => k.kty === "RSA" && (k.use === undefined || k.use === "sig"))
      .filter((k) => (kid ? k.kid === kid : true))
      .map((k) => {
        if (!imported.has(k)) {
          try {
            imported.set(k, createPublicKey({ key: k, format: "jwk" }));
          } catch {
            imported.set(k, null);
          }
        }
        return imported.get(k) ?? null;
      })
      .filter((k): k is KeyObject => k !== null);

  return async (kid) => {
    if (clock() - fetchedAt > JWKS_TTL_MS) await refresh();
    const found = usable(kid);
    if (found.length > 0 || clock() - fetchedAt < JWKS_MIN_REFETCH_MS) return found;
    await refresh();
    return usable(kid);
  };
}
