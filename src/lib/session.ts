import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { DEFAULT_USER_NAME } from "@/lib/constants";
import { ROUTES } from "@/config/auth";
import { validateAgentToken } from "@/db/queries/agent-tokens";
import { getUserById, getUserByEmail } from "@/db/queries/users";
import { envAlias, envAliasBool } from "@/lib/brand-env";
import { isValidUuid } from "@/lib/utils";
import { TOKEN_SESSION_WRITE_HEADER } from "@/lib/auth/token-session";

/**
 * Resolve the DB user id from a session.
 *
 * A valid-looking UUID in the JWT is NOT proof the user still exists: tokens
 * outlive rows. A box reseed, an account deletion, or a restore can orphan a
 * still-valid 30-day JWT — its `id` then points at a user that's gone, and the
 * holder gets a "logged in but everything is empty" phantom session. (This is
 * exactly how 21 real projects went invisible: the session id no longer matched
 * the user that owned them, though the email did.) So we verify the id maps to
 * a real user, and when it doesn't, recover via the email claim — which our own
 * auth layer signed into the JWT, so it carries the same trust as the id.
 * OAuth JWTs that briefly carry a non-UUID provider id recover the same way.
 */
async function resolveSessionCaller(): Promise<{ userId: string; viaToken: boolean } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const viaToken = session.user.viaToken === true;

  const id = session.user.id;
  if (id && isValidUuid(id)) {
    const user = await getUserById(id);
    if (user) return { userId: id, viaToken };
    // valid UUID but no such user → orphaned token; fall through to email recovery
  }

  const email = session.user.email;
  if (email) {
    const byEmail = await getUserByEmail(email);
    if (byEmail) return { userId: byEmail.id, viaToken };
  }

  return null;
}

/**
 * A session opened with an agent's token (lib/auth/token-session.ts) is the
 * token's power: it reads like a person, and it writes only where a token is
 * accepted. The proxy marks its writes; a person-only route reads them as
 * signed out.
 */
async function isTokenSessionWrite(): Promise<boolean> {
  const h = await headers();
  return h.get(TOKEN_SESSION_WRITE_HEADER) === "1";
}

export async function resolveSessionUserId(): Promise<string | null> {
  const caller = await resolveSessionCaller();
  if (!caller) return null;
  if (caller.viaToken && (await isTokenSessionWrite())) return null;
  return caller.userId;
}

/**
 * Returns the authenticated user's ID, or null if there is no session.
 * Use in API routes (pair with an explicit 401 check).
 * Middleware already blocks browser clients without a session — this is defense-in-depth.
 */
export async function getSessionUserId(): Promise<string | null> {
  return resolveSessionUserId();
}

/**
 * Returns the authenticated user's ID.
 * Redirects to /sign-in if there is no session.
 * Use in server components and server actions.
 */
export async function requirePageUserId(): Promise<string> {
  const userId = await resolveSessionUserId();
  if (!userId) redirect(ROUTES.SIGN_IN);
  return userId;
}

export async function getCurrentUserName(): Promise<string> {
  const session = await auth();
  return session?.user?.name ?? DEFAULT_USER_NAME;
}

let warnedDeprecatedDaemonToken = false;

/**
 * For API routes that must also accept bearer tokens (daemon + CLI agent).
 * Prefers ck_* DB-backed agent tokens (per-user, revocable). The legacy
 * COCKPIT_DAEMON_TOKEN env-var path is only honored when explicitly opted in
 * via COCKPIT_ALLOW_LEGACY_DAEMON_TOKEN=1 — and even then it always maps to
 * the single "default" user, so it must never be used in a multi-tenant
 * deployment.
 */
/**
 * Who made this request, and HOW they authenticated.
 *
 * The "how" is a real signal, not a heuristic: a cookie session means a person
 * is sitting in front of the web UI, and a Bearer token means a runner, a hook,
 * or a scheduled loop. That distinction is what lets a dispatch someone clicked
 * announce its outcome while autopilot churn stays silent — without maintaining
 * a hand-kept list of "automated" call sites that a new one silently joins.
 *
 * getApiUserId stays the common path; this is for the callers that need to know
 * whether a human is waiting on the other end.
 */
export type ApiActor = { userId: string; via: "session" | "token" };

export async function getApiActor(): Promise<ApiActor | null> {
  const caller = await resolveSessionCaller();
  if (caller) return { userId: caller.userId, via: caller.viaToken ? "token" : "session" };
  const userId = await bearerUserId();
  return userId ? { userId, via: "token" } : null;
}

export async function getApiUserId(): Promise<string | null> {
  // Cookie-based session (web UI), including one opened with a token: every
  // route that reads the caller here already takes a token.
  const caller = await resolveSessionCaller();
  if (caller) return caller.userId;
  return bearerUserId();
}

async function bearerUserId(): Promise<string | null> {
  // Bearer token (daemon / CLI agent).
  const headersList = await headers();
  const authHeader = headersList.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const bearer = authHeader.slice(7);

  // DB agent token (ck_*) — preferred path. Per-user, per-device, revocable.
  if (bearer.startsWith("ck_")) {
    const result = await validateAgentToken(bearer);
    if (result) return result.userId;
    // Fall through: a ck_-prefixed bearer can still be a legacy env-var token
    // on single-tenant local installs that haven't minted a per-user token yet.
  }

  // Legacy env-var token → "default" user. Opt-in only; not multi-tenant safe.
  const envToken = envAlias("DAEMON_TOKEN");
  const legacyAllowed = envAliasBool("ALLOW_LEGACY_DAEMON_TOKEN");
  if (envToken && legacyAllowed && bearer === envToken) {
    if (!warnedDeprecatedDaemonToken) {
      warnedDeprecatedDaemonToken = true;
      console.warn(
        "[session] DAEMON_TOKEN bearer is deprecated and unsafe in multi-tenant deployments. " +
          "Mint a ck_* agent token from /settings and use it instead.",
      );
    }
    const { getDefaultUser } = await import("@/db/queries/users");
    const user = await getDefaultUser();
    return user?.id ?? null;
  }

  return null;
}
