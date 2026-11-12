import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { DEFAULT_USER_NAME } from "@/lib/constants";
import { ROUTES } from "@/config/auth";
import { validateAgentToken } from "@/db/queries/agent-tokens";
import { tokenMayActAsRunner } from "@/lib/agent-token-kind";
import { getUserById, getUserByEmail } from "@/db/queries/users";
import { envAlias, envAliasBool } from "@/lib/brand-env";
import { isValidUuid } from "@/lib/utils";

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
export async function resolveSessionUserId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user) return null;

  const id = session.user.id;
  if (id && isValidUuid(id)) {
    const user = await getUserById(id);
    if (user) return id;
    // valid UUID but no such user → orphaned token; fall through to email recovery
  }

  const email = session.user.email;
  if (email) {
    const byEmail = await getUserByEmail(email);
    if (byEmail) return byEmail.id;
  }

  return null;
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
  const sessionUserId = await resolveSessionUserId();
  if (sessionUserId) return { userId: sessionUserId, via: "session" };
  const userId = await getApiUserId();
  return userId ? { userId, via: "token" } : null;
}

export async function getApiUserId(): Promise<string | null> {
  return apiUserId({ asRunner: false });
}

/**
 * Who is calling a route only a builder may call: claiming and acking
 * commands, posting the PTY's frames, transcript, runtime state and a run's
 * progress. A person's session passes, as does any token except one minted as
 * kind "agent" (see agent-tokens schema).
 *
 * Why: until 2026-11-12 every ck_ token could do all of it, so a token handed
 * to an agent so it could drive sessions could also claim another builder's
 * work, or post a screen or a "working" beat that no PTY ever printed — and
 * the owner reads those as the truth (RUN-STATUS-SSOT's one alive bit).
 */
export async function getRunnerApiUserId(): Promise<string | null> {
  return apiUserId({ asRunner: true });
}

async function apiUserId({ asRunner }: { asRunner: boolean }): Promise<string | null> {
  // Cookie-based session (web UI).
  const userId = await resolveSessionUserId();
  if (userId) return userId;

  // Bearer token (daemon / CLI agent).
  const headersList = await headers();
  const authHeader = headersList.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const bearer = authHeader.slice(7);

  // DB agent token (ck_*) — preferred path. Per-user, per-device, revocable.
  if (bearer.startsWith("ck_")) {
    const result = await validateAgentToken(bearer);
    if (result) return asRunner && !tokenMayActAsRunner(result.kind) ? null : result.userId;
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
