/**
 * Who is calling /api/mcp — the MCP server's one door.
 *
 * Two credentials are accepted, and both end at a Loki user id:
 *
 *   Bearer ck_…   A Loki agent token (Settings → Agent tokens). Full access,
 *                 both scopes — exactly what the same token already grants the
 *                 Telegram skill and the Fleet Runner. For Claude Code, Cursor
 *                 and anything else that can send a header.
 *   Bearer <JWT>  An OrangeCat access token minted FOR this resource. How the
 *                 connector UIs (claude.ai, ChatGPT) sign in: they discover
 *                 OrangeCat from the protected-resource metadata, run OAuth
 *                 there, and present what it issued. Scopes are whatever the
 *                 person granted; `sub` is their OrangeCat actor, which a Loki
 *                 user carries once they have signed in with OrangeCat.
 *
 * Anything else is a 401 carrying the WWW-Authenticate challenge that tells a
 * client where to go to get a token — which is how the connector flow starts:
 * the first `initialize` arrives with no token at all, on purpose.
 *
 * The DB-bound lookups are injected (and lazily imported by default) so this
 * module loads, and is tested, without a database.
 */
import {
  MCP_AUTHORIZATION_SERVER,
  MCP_JWKS_URL,
  MCP_RESOURCE,
  MCP_RESOURCE_METADATA_URL,
  MCP_SCOPES_SUPPORTED,
  type McpScope,
} from "@/config/mcp";
import { createJwksResolver, verifyAccessToken, type KeyResolver } from "@/lib/mcp/jwt";
import type { McpCaller } from "@/lib/mcp/types";

export type McpAuthResult =
  | { ok: true; caller: McpCaller }
  /** No credential, or one that did not verify: answer 401 with the challenge. */
  | { ok: false; status: 401; tokenPresented: boolean; description: string }
  /** The issuer's keys could not be fetched: not the caller's fault, so not a 401. */
  | { ok: false; status: 503; description: string };

export type McpAuthDeps = {
  validateAgentToken: (token: string) => Promise<{ userId: string } | null>;
  userIdForActor: (actorId: string) => Promise<string | null>;
  keys: KeyResolver;
  issuer: string;
  audience: string;
  nowSeconds?: number;
};

const ALL_SCOPES: ReadonlySet<McpScope> = new Set(MCP_SCOPES_SUPPORTED);

/**
 * The challenge a 401 carries (RFC 6750 + RFC 9728). `resource_metadata` is
 * what lets a client that has never heard of Loki find OrangeCat; `scope` is
 * what it should ask for; `error` is added only when a token WAS presented,
 * because a request that simply had none is not an invalid token.
 */
export function wwwAuthenticate(opts: { tokenPresented: boolean; description?: string }): string {
  const parts = [
    `resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
    `scope="${MCP_SCOPES_SUPPORTED.join(" ")}"`,
  ];
  if (opts.tokenPresented) {
    parts.push(`error="invalid_token"`);
    if (opts.description) parts.push(`error_description="${opts.description.replace(/"/g, "'")}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/** The HTTP reply for a failed door: status, `{ error }` envelope, and the challenge. */
export function authFailureReply(auth: Extract<McpAuthResult, { ok: false }>): {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  if (auth.status === 503) {
    return { status: 503, body: { error: auth.description }, headers: { "Retry-After": "30" } };
  }
  return {
    status: 401,
    body: { error: "Unauthorized", error_description: auth.description },
    headers: {
      "WWW-Authenticate": wwwAuthenticate({
        tokenPresented: auth.tokenPresented,
        description: auth.description,
      }),
    },
  };
}

export async function resolveMcpCallerWith(
  authorization: string | null,
  deps: McpAuthDeps,
): Promise<McpAuthResult> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  if (!match) {
    return { ok: false, status: 401, tokenPresented: false, description: "No bearer token" };
  }
  const token = match[1];

  if (token.startsWith("ck_")) {
    const agent = await deps.validateAgentToken(token);
    return agent
      ? { ok: true, caller: { userId: agent.userId, scopes: ALL_SCOPES, via: "agent-token" } }
      : { ok: false, status: 401, tokenPresented: true, description: "Unknown or revoked token" };
  }

  let verified;
  try {
    verified = await verifyAccessToken(token, {
      issuer: deps.issuer,
      audience: deps.audience,
      keys: deps.keys,
      nowSeconds: deps.nowSeconds,
    });
  } catch (e) {
    console.error("[mcp] JWKS unavailable:", e instanceof Error ? e.message : e);
    return { ok: false, status: 503, description: "Could not reach the token issuer" };
  }
  if (!verified.ok) {
    return { ok: false, status: 401, tokenPresented: true, description: verified.reason };
  }

  const granted = new Set(
    verified.token.scopes.filter((s): s is McpScope => ALL_SCOPES.has(s as McpScope)),
  );
  return {
    ok: true,
    caller: {
      userId: await deps.userIdForActor(verified.token.sub),
      scopes: granted,
      via: "orangecat",
      clientId: verified.token.clientId,
    },
  };
}

/** One key cache per process — rotation is found by the refetch on an unknown kid. */
let sharedKeys: KeyResolver | null = null;

function defaultKeys(): KeyResolver {
  sharedKeys ??= createJwksResolver(async () => {
    const res = await fetch(MCP_JWKS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    return (await res.json()) as { keys?: unknown };
  });
  return sharedKeys;
}

/** The production door: real token table, real user lookup, OrangeCat's live keys. */
export async function resolveMcpCaller(req: Request): Promise<McpAuthResult> {
  return resolveMcpCallerWith(req.headers.get("authorization"), {
    validateAgentToken: async (t) =>
      (await import("@/db/queries/agent-tokens")).validateAgentToken(t),
    userIdForActor: async (actorId) => {
      const { getUserByOrangeCatActorId } = await import("@/db/queries/users");
      return (await getUserByOrangeCatActorId(actorId))?.id ?? null;
    },
    keys: defaultKeys(),
    issuer: MCP_AUTHORIZATION_SERVER,
    audience: MCP_RESOURCE,
  });
}
