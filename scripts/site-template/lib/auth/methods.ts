import { createHash } from "node:crypto";

/**
 * Which sign-in methods this deployment offers — a pure function of its env,
 * so "is this button shown" is a unit test, not a guess (fleet STACK.md,
 * "Identity", 2026-10-11).
 *
 *  - Email + password, passkeys and two-factor need nothing external.
 *  - A magic link needs mail (@bitbaum/mail-kit). Without it the option is
 *    HIDDEN in production rather than offered and silently undeliverable; in
 *    development the link is printed to the server console instead.
 *  - "bitbaum sign-in" is the shared sign-in service that holds the Google,
 *    GitHub, X, Meta and Apple credentials once and speaks OIDC to every app,
 *    issuing a per-app (pairwise) subject. Shown only when SIGNIN_* is set.
 *  - "Sign in with OrangeCat" is OrangeCat's OIDC provider: one click for
 *    people who already have OrangeCat, never a requirement. OrangeCat's token
 *    endpoint accepts ONLY client_secret_post and requires PKCE.
 *
 * A method whose env is missing is hidden, never broken.
 */
type Env = Record<string, string | undefined>;

export const SIGNIN_PROVIDER_ID = "bitbaum-signin";
export const ORANGECAT_PROVIDER_ID = "orangecat";
export const ORANGECAT_DEFAULT_ISSUER = "https://orangecat.ch";

export type OidcProviderId = typeof SIGNIN_PROVIDER_ID | typeof ORANGECAT_PROVIDER_ID;

export interface OidcClient {
  providerId: OidcProviderId;
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
}

const text = (value: string | undefined) => value?.trim() || "";

/**
 * An issuer we are willing to send people to: https, or http on localhost for
 * development. Anything else is treated as not configured — a typo must hide
 * the button, not send someone's sign-in over plain HTTP.
 */
export function usableIssuer(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  // OIDC compares `iss` byte for byte; normalise only the trailing slash used
  // to build the discovery URL, never the issuer itself.
  return value;
}

function oidcClient(
  providerId: OidcProviderId,
  issuerValue: string,
  clientId: string,
  clientSecret: string,
): OidcClient | null {
  if (!issuerValue || !clientId || !clientSecret) return null;
  const issuer = usableIssuer(issuerValue);
  if (!issuer) return null;
  return {
    providerId,
    issuer,
    discoveryUrl: `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    clientId,
    clientSecret,
  };
}

/** The shared bitbaum sign-in service (SIGNIN_ISSUER/CLIENT_ID/CLIENT_SECRET). */
export function signinBroker(env: Env): OidcClient | null {
  return oidcClient(
    SIGNIN_PROVIDER_ID,
    text(env.SIGNIN_ISSUER),
    text(env.SIGNIN_CLIENT_ID),
    text(env.SIGNIN_CLIENT_SECRET),
  );
}

/** OrangeCat, under the env names every fleet app already uses. */
export function orangecatOidc(env: Env): OidcClient | null {
  return oidcClient(
    ORANGECAT_PROVIDER_ID,
    text(env.ORANGECAT_OAUTH_ISSUER) || ORANGECAT_DEFAULT_ISSUER,
    text(env.ORANGECAT_OAUTH_CLIENT_ID),
    text(env.ORANGECAT_OAUTH_CLIENT_SECRET),
  );
}

export function oidcClients(env: Env): OidcClient[] {
  return [signinBroker(env), orangecatOidc(env)].filter((c): c is OidcClient => c !== null);
}

export interface SignInMethods {
  password: boolean;
  passkey: boolean;
  twoFactor: boolean;
  magicLink: boolean;
  /** Whether an email must be confirmed before a password account signs in. */
  verifyEmail: boolean;
  signin: boolean;
  orangecat: boolean;
}

/** What the sign-in and sign-up pages offer. Safe to send to the browser: booleans only. */
export function signInMethods(env: Env, mailConfigured: boolean): SignInMethods {
  const development = env.NODE_ENV === "development";
  return {
    password: true,
    passkey: true,
    twoFactor: true,
    magicLink: mailConfigured || development,
    verifyEmail: mailConfigured,
    signin: signinBroker(env) !== null,
    orangecat: orangecatOidc(env) !== null,
  };
}

/**
 * The address given to a person who signed in with a method that brought no
 * email, or whose email we do not trust as an identity.
 *
 * An address from a provider is CONTACT data, never an identity: linking by it
 * lets whoever controls an unverified address at the provider take over the
 * local account (fleet accountkit, `orangecatProfile`). So OIDC accounts never
 * carry the provider's address. `.invalid` is reserved (RFC 2606): it cannot
 * receive mail and cannot collide with a real address. Hashed so the
 * provider's subject is not readable from it.
 */
export function placeholderEmail(providerId: string, subject: string): string {
  const digest = createHash("sha256").update(`${providerId}:${subject}`).digest("hex").slice(0, 32);
  return `${digest}@${providerId}.invalid`;
}

/** Whether mail can ever reach this address. */
export function isDeliverable(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domain.length > 0 && !domain.endsWith(".invalid");
}
