// Pins Loki's MCP server — the door an AI app walks through to act as the owner.
//
// Why it earns a test: every other surface that can dispatch, book or approve
// in Loki is either the owner's own session or a token they minted. This one
// accepts credentials minted by ANOTHER service, for apps Loki has never seen.
// Its failure modes are all silent and all in the dangerous direction:
//
//   • a token minted for some other OrangeCat client (aud = its client id) is a
//     perfectly signed OrangeCat JWT — accept it and any app holding a user's
//     OrangeCat login drives their Loki;
//   • `alg` is chosen by the attacker — honour it and `none` walks in;
//   • a chat-only grant that can still reach an act tool is a consent screen
//     that lied;
//   • a 401 without the challenge header is a connector that can never sign in,
//     and looks exactly like "Loki is down".
//
// So the negative cases are the point. Pure: keys are generated here, tokens
// are signed here, the services are fakes — no database, no network.
// Run: npx tsx scripts/test/mcp-server.ts
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import {
  MCP_PROTOCOL_VERSIONS,
  MCP_RESOURCE,
  MCP_RESOURCE_METADATA_URL,
  MCP_SCOPE,
  MCP_TOOL_SCOPES,
  protectedResourceMetadata,
  type McpScope,
} from "@/config/mcp";
import { createJwksResolver, verifyAccessToken } from "@/lib/mcp/jwt";
import {
  authFailureReply,
  resolveMcpCallerWith,
  wwwAuthenticate,
  type McpAuthDeps,
} from "@/lib/mcp/auth";
import { handleMcpPost, isAcceptableProtocolHeader, JSONRPC } from "@/lib/mcp/server";
import { resolveActionId } from "@/lib/mcp/tools";
import type { McpCaller, McpServices } from "@/lib/mcp/types";
import { defineTool, readOnlyRegistry } from "@/lib/agent/tools/registry";

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

// ── keys and tokens, minted here ────────────────────────────────────────────
const ISSUER = "https://orangecat.example";
const NOW = 1_800_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function mint(
  claims: Record<string, unknown>,
  opts: { key?: KeyObject; header?: Record<string, unknown> } = {},
): string {
  const head = b64(opts.header ?? { alg: "RS256", typ: "at+jwt", kid: "k1" });
  const body = b64({
    iss: ISSUER,
    sub: "actor-1",
    uid: "oc-user-1",
    aud: MCP_RESOURCE,
    client_id: "claude-ai",
    scope: "loki.chat loki.act",
    exp: NOW + 600,
    ...claims,
  });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), opts.key ?? privateKey);
  return `${head}.${body}.${sig.toString("base64url")}`;
}

let jwksFetches = 0;
let clockMs = NOW * 1000;
let published: unknown[] = [jwk];
const keys = createJwksResolver(
  async () => {
    jwksFetches += 1;
    return { keys: published };
  },
  () => clockMs,
);
const verifyAt = (t: string) =>
  verifyAccessToken(t, { issuer: ISSUER, audience: MCP_RESOURCE, keys, nowSeconds: NOW });

async function main() {
  // ── JWT verification ──────────────────────────────────────────────────────
  const good = await verifyAt(mint({}));
  check("a token signed by the issuer, for this resource, verifies", good.ok);
  check(
    "…and yields the actor, client and scopes",
    good.ok &&
      good.token.sub === "actor-1" &&
      good.token.clientId === "claude-ai" &&
      good.token.scopes.join(" ") === "loki.chat loki.act",
  );
  check(
    "an audience ARRAY that contains the resource is accepted",
    (await verifyAt(mint({ aud: ["other", MCP_RESOURCE] }))).ok,
  );

  const clientAud = await verifyAt(mint({ aud: "loki-oidc-client-id" }));
  check(
    "a token whose audience is a client id is REJECTED (wrong audience)",
    !clientAud.ok && clientAud.reason === "wrong audience",
  );
  check("a token with no audience is rejected", !(await verifyAt(mint({ aud: undefined }))).ok);
  check(
    "a token from another issuer is rejected",
    !(await verifyAt(mint({ iss: "https://evil.example" }))).ok,
  );
  check("an expired token is rejected", !(await verifyAt(mint({ exp: NOW - 120 }))).ok);
  check(
    "…but a few seconds of clock skew are tolerated",
    (await verifyAt(mint({ exp: NOW - 10 }))).ok,
  );
  check("a token with no exp is rejected", !(await verifyAt(mint({ exp: undefined }))).ok);
  check("a not-yet-valid token is rejected", !(await verifyAt(mint({ nbf: NOW + 3600 }))).ok);
  check("a token with no subject is rejected", !(await verifyAt(mint({ sub: "" }))).ok);

  const noneAlg = mint({}, { header: { alg: "none", kid: "k1" } });
  check("alg:none is rejected even with a valid signature attached", !(await verifyAt(noneAlg)).ok);
  check(
    "alg:HS256 is rejected (no HMAC-with-the-public-key forgery)",
    !(await verifyAt(mint({}, { header: { alg: "HS256", kid: "k1" } }))).ok,
  );
  const signedByRogue = await verifyAt(mint({}, { key: rogue.privateKey }));
  check(
    "a token signed by some other key is rejected",
    !signedByRogue.ok && signedByRogue.reason === "bad signature",
  );
  const [h, , s] = mint({}).split(".");
  const tampered = `${h}.${b64({ iss: ISSUER, sub: "actor-2", aud: MCP_RESOURCE, exp: NOW + 600, scope: "loki.act" })}.${s}`;
  check("a payload edited after signing is rejected", !(await verifyAt(tampered)).ok);
  check("garbage is rejected, not thrown", !(await verifyAt("not.a.jwt!")).ok);

  // ── JWKS cache: one fetch, and one refetch for a rotated key ──────────────
  check("the key set was fetched once for all of the above", jwksFetches === 1);
  const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rotatedJwk = { ...rotated.publicKey.export({ format: "jwk" }), kid: "k2" };
  const rotatedToken = mint({}, { key: rotated.privateKey, header: { alg: "RS256", kid: "k2" } });
  published = [jwk, rotatedJwk];
  check(
    "an unknown kid inside the refetch floor is NOT refetched (no fetch amplifier)",
    !(await verifyAt(rotatedToken)).ok && jwksFetches === 1,
  );
  clockMs += 31_000;
  check(
    "past the floor, an unknown kid refetches once and the rotated key verifies",
    (await verifyAt(rotatedToken)).ok && jwksFetches === 2,
  );
  await verifyAt(mint({}, { header: { alg: "RS256", kid: "made-up" } }));
  check("a second unknown kid right after does not refetch again", jwksFetches === 2);
  clockMs += 11 * 60 * 1000;
  await verifyAt(mint({}));
  check("the key set is refetched once its 10-minute TTL lapses", jwksFetches === 3);

  // ── the door ──────────────────────────────────────────────────────────────
  const linked = new Map([["actor-1", "user-1"]]);
  const deps: McpAuthDeps = {
    validateAgentToken: async (t) => (t === "ck_good" ? { userId: "user-ck" } : null),
    userIdForActor: async (a) => linked.get(a) ?? null,
    keys,
    issuer: ISSUER,
    audience: MCP_RESOURCE,
    nowSeconds: NOW,
  };

  const none = await resolveMcpCallerWith(null, deps);
  check(
    "no Authorization header → 401, no token presented",
    !none.ok && none.status === 401 && !none.tokenPresented,
  );
  const ck = await resolveMcpCallerWith("Bearer ck_good", deps);
  check(
    "a valid ck_ agent token → that user, BOTH scopes (as today)",
    ck.ok &&
      ck.caller.userId === "user-ck" &&
      ck.caller.scopes.has("loki.act") &&
      ck.caller.scopes.has("loki.chat"),
  );
  const badCk = await resolveMcpCallerWith("Bearer ck_revoked", deps);
  check(
    "a revoked ck_ token → 401 with a token presented",
    !badCk.ok && badCk.status === 401 && badCk.tokenPresented,
  );

  const chatOnly = await resolveMcpCallerWith(
    `Bearer ${mint({ scope: "loki.chat openid" })}`,
    deps,
  );
  check(
    "an OrangeCat token → the linked user, only the loki scopes it was granted",
    chatOnly.ok &&
      chatOnly.caller.userId === "user-1" &&
      chatOnly.caller.via === "orangecat" &&
      [...chatOnly.caller.scopes].join(" ") === "loki.chat",
  );
  const unlinked = await resolveMcpCallerWith(`Bearer ${mint({ sub: "actor-new" })}`, deps);
  check(
    "a valid token for an actor with no Loki account → authenticated, userId null (not a 401)",
    unlinked.ok && unlinked.caller.userId === null,
  );
  const wrongAud = await resolveMcpCallerWith(`Bearer ${mint({ aud: "some-client" })}`, deps);
  check(
    "a wrong-audience JWT → 401 invalid_token",
    !wrongAud.ok && wrongAud.status === 401 && wrongAud.tokenPresented,
  );

  const down = await resolveMcpCallerWith(`Bearer ${mint({})}`, {
    ...deps,
    keys: createJwksResolver(async () => {
      throw new Error("ECONNREFUSED");
    }),
  });
  check(
    "an unreachable issuer → 503, never a 401 that sends the client back to OAuth",
    !down.ok && down.status === 503,
  );

  // ── the 401 shape ─────────────────────────────────────────────────────────
  check(
    "the metadata url hangs off the resource's origin",
    MCP_RESOURCE_METADATA_URL ===
      `${new URL(MCP_RESOURCE).origin}/.well-known/oauth-protected-resource`,
  );
  check(
    "no token: challenge carries resource_metadata + scope, and NO error",
    wwwAuthenticate({ tokenPresented: false }) ===
      `Bearer resource_metadata="${MCP_RESOURCE_METADATA_URL}", scope="loki.chat loki.act"`,
  );
  const reply401 = !wrongAud.ok ? authFailureReply(wrongAud) : null;
  check(
    'bad token: challenge adds error="invalid_token"',
    reply401?.status === 401 &&
      reply401.headers["WWW-Authenticate"].startsWith(
        `Bearer resource_metadata="${MCP_RESOURCE_METADATA_URL}", scope="loki.chat loki.act", error="invalid_token"`,
      ) &&
      reply401.body.error === "Unauthorized",
  );
  const reply503 = !down.ok ? authFailureReply(down) : null;
  check(
    "an issuer outage replies 503 with no challenge",
    reply503?.status === 503 && !reply503.headers["WWW-Authenticate"],
  );

  const meta = protectedResourceMetadata();
  check(
    "protected resource metadata names the resource, OrangeCat and both scopes",
    meta.resource === MCP_RESOURCE &&
      meta.authorization_servers.length === 1 &&
      meta.scopes_supported.join(" ") === "loki.chat loki.act" &&
      meta.bearer_methods_supported.join() === "header" &&
      meta.resource_name === "Loki",
  );

  // ── JSON-RPC ──────────────────────────────────────────────────────────────
  const calls: string[] = [];
  const asked: Array<{ sessionKey: string; readOnly: boolean }> = [];
  const services: McpServices = {
    ask: async (_u, message, opts) => {
      calls.push("ask");
      asked.push(opts);
      if (message === "over budget") {
        return { status: 429, body: { error: "You've used today's free AI turns." } };
      }
      return {
        status: 200,
        body: {
          ok: true,
          text: "Two runs failed on orangecat [F1].",
          sources: [
            { id: "F1", label: "orangecat", detail: "runs · failed: 2" },
            { id: "F2", label: "unrelated", detail: "x" },
          ],
        },
      };
    },
    pendingApprovals: async () => {
      calls.push("pending");
      return [
        {
          id: "8337d0fe-1bb1-4c40-98e5-4961196b8de2",
          type: "create_event",
          title: "Dentist",
          description: null,
          reasoning: null,
          createdAt: null,
          expiresAt: null,
        },
        {
          id: "8337d0ff-0000-4000-8000-000000000000",
          type: "send_message",
          title: "Ping Elena",
          description: null,
          reasoning: null,
          createdAt: null,
          expiresAt: null,
        },
      ];
    },
    decide: async (_u, id) => {
      calls.push(`decide:${id}`);
      return { found: true, id, status: "approved", result: { executed: true } };
    },
    dispatch: async () => {
      calls.push("dispatch");
      return { status: 200, body: { ok: true, tab: "loki", mode: "queued", channel: "cloud" } };
    },
    book: async () => {
      calls.push("book");
      return {
        action: { id: "a-1" } as never,
        status: "awaiting-approval",
        reason: "guests on the invitation",
      };
    },
    projects: async () => [
      {
        name: "loki",
        description: "Execution layer",
        liveUrl: "https://loki.orangecat.ch",
        builderPref: null,
        lastDispatchAt: "2026-09-27T10:00:00Z",
      },
    ],
  };
  const caller = (scopes: McpScope[], userId: string | null = "user-1"): McpCaller => ({
    userId,
    scopes: new Set(scopes),
    via: "orangecat",
    clientId: "claude-ai",
  });
  const both = caller([MCP_SCOPE.chat, MCP_SCOPE.act]);
  const rpc = (body: unknown, who: McpCaller = both) =>
    handleMcpPost(typeof body === "string" ? body : JSON.stringify(body), {
      caller: who,
      services,
    });
  type Res = {
    id: unknown;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
  const result = async (method: string, params?: unknown, who?: McpCaller) =>
    (await rpc({ jsonrpc: "2.0", id: 1, method, params }, who)).body as Res;
  const call = async (name: string, args: unknown, who?: McpCaller) =>
    (await result("tools/call", { name, arguments: args }, who)).result as {
      content: Array<{ text: string }>;
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };

  const init = await result("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t" },
  });
  check("initialize echoes a revision we speak", init.result?.protocolVersion === "2025-06-18");
  check(
    "initialize offers our newest for one we do not",
    (await result("initialize", { protocolVersion: "2024-11-05" })).result?.protocolVersion ===
      MCP_PROTOCOL_VERSIONS[0],
  );
  check(
    "initialize declares tools, names the server loki, and carries instructions",
    JSON.stringify(init.result?.capabilities) ===
      JSON.stringify({ tools: { listChanged: false } }) &&
      (init.result?.serverInfo as { name: string }).name === "loki" &&
      typeof init.result?.instructions === "string" &&
      (init.result?.instructions as string).includes("loki_dispatch"),
  );
  const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  check("a notification → 202 with no body", note.status === 202 && note.body === null);
  check("ping → empty result", JSON.stringify((await result("ping")).result) === "{}");
  const unknown = await result("resources/list");
  check("an unknown method → -32601", unknown.error?.code === JSONRPC.METHOD_NOT_FOUND);
  const parse = await rpc("{not json");
  check(
    "unparseable body → 400 with -32700",
    parse.status === 400 && (parse.body as Res).error?.code === JSONRPC.PARSE_ERROR,
  );
  const notTwo = (await rpc({ id: 1, method: "ping" })).body as Res;
  check("a non-2.0 message → -32600", notTwo.error?.code === JSONRPC.INVALID_REQUEST);
  const batch = await rpc([
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "nope" },
  ]);
  check(
    "a batch answers each request, skips each notification",
    batch.status === 200 && Array.isArray(batch.body) && (batch.body as Res[]).length === 2,
  );
  check("an empty batch is invalid", (await rpc([])).status === 400);

  const listed = (await result("tools/list")).result?.tools as Array<{
    name: string;
    description: string;
    inputSchema: { type: string };
    annotations: { readOnlyHint: boolean };
  }>;
  check(
    "tools/list lists exactly the tools in the scope map",
    listed
      .map((t) => t.name)
      .sort()
      .join() === Object.keys(MCP_TOOL_SCOPES).sort().join(),
  );
  check(
    "every tool has an object input schema and names its scope",
    listed.every(
      (t) =>
        t.inputSchema.type === "object" &&
        t.description.includes(MCP_TOOL_SCOPES[t.name as keyof typeof MCP_TOOL_SCOPES]),
    ),
  );
  check(
    "only chat-scoped tools claim to be read-only",
    listed.every(
      (t) =>
        t.annotations.readOnlyHint ===
        (MCP_TOOL_SCOPES[t.name as keyof typeof MCP_TOOL_SCOPES] === "loki.chat"),
    ),
  );
  check(
    "an unknown tool → -32602",
    (await result("tools/call", { name: "rm_rf" })).error?.code === JSONRPC.INVALID_PARAMS,
  );

  // ── scope gating: the consent screen must not lie ─────────────────────────
  const chat = caller([MCP_SCOPE.chat]);
  for (const name of ["loki_dispatch", "loki_book", "loki_decide"] as const) {
    calls.length = 0;
    const r = await call(
      name,
      {
        project: "loki",
        task: "x",
        title: "x",
        start: "2026-10-01",
        action_id: "8337d0fe",
        decision: "approve",
      },
      chat,
    );
    check(
      `${name} without loki.act → isError naming loki.act, and nothing ran`,
      r.isError === true && r.content[0].text.includes("loki.act") && calls.length === 0,
    );
  }
  const noChat = await call("ask_loki", { message: "hi" }, caller([MCP_SCOPE.act]));
  check(
    "ask_loki without loki.chat → isError naming loki.chat",
    noChat.isError === true && noChat.content[0].text.includes("loki.chat"),
  );

  calls.length = 0;
  const unlinkedCall = await call("ask_loki", { message: "hi" }, caller([MCP_SCOPE.chat], null));
  check(
    "an unlinked OrangeCat account gets the way forward, not a 500",
    unlinkedCall.isError === true &&
      unlinkedCall.content[0].text.includes("Sign in to Loki once with OrangeCat at https://") &&
      unlinkedCall.content[0].text.includes("/sign-in, then retry") &&
      calls.length === 0,
  );

  asked.length = 0;
  const answer = await call(
    "ask_loki",
    { message: "what failed?", conversation_id: "thread-7" },
    chat,
  );
  check(
    "ask_loki returns the answer with only the sources it cited",
    !answer.isError &&
      answer.content[0].text.includes("[F1] orangecat") &&
      !answer.content[0].text.includes("unrelated"),
  );
  check(
    "a chat-only grant asks Loki READ-ONLY, on an MCP session key",
    asked[0]?.readOnly === true && asked[0].sessionKey === "agent:main:mcp:user-1:thread-7",
  );
  await call("ask_loki", { message: "x" }, both);
  check(
    "a grant with loki.act asks Loki normally",
    asked[1]?.readOnly === false && asked[1].sessionKey === "agent:main:mcp:user-1",
  );
  const budget = await call("ask_loki", { message: "over budget" }, chat);
  check(
    "a budget refusal surfaces as Loki's own sentence",
    budget.isError === true &&
      budget.content[0].text.startsWith("You've used today's free AI turns"),
  );
  check(
    "an over-long message is refused as bad arguments",
    (await call("ask_loki", { message: "x".repeat(5000) }, chat)).isError === true,
  );
  check(
    "a conversation_id with odd characters is refused",
    (await call("ask_loki", { message: "x", conversation_id: "a:b" }, chat)).isError === true,
  );

  const booked = await call("loki_book", {
    title: "Dentist",
    start: "2026-10-01T14:00:00+02:00",
    end: "2026-10-01T15:00:00+02:00",
  });
  check(
    "loki_book reports awaiting-approval as NOT booked",
    !booked.isError &&
      booked.content[0].text.includes("not booked yet") &&
      booked.structuredContent?.status === "awaiting-approval",
  );
  calls.length = 0;
  check(
    "loki_book refuses a time with no offset",
    (await call("loki_book", { title: "x", start: "2026-10-01T14:00:00" })).isError === true &&
      calls.length === 0,
  );
  check(
    "loki_book refuses an end before its start",
    (
      await call("loki_book", {
        title: "x",
        start: "2026-10-01T14:00:00Z",
        end: "2026-10-01T13:00:00Z",
      })
    ).isError === true,
  );

  calls.length = 0;
  const decided = await call("loki_decide", { action_id: "8337d0fe", decision: "approve" });
  check(
    "loki_decide resolves a unique prefix, decides that id, and echoes WHAT was approved",
    calls.includes("decide:8337d0fe-1bb1-4c40-98e5-4961196b8de2") &&
      decided.content[0].text.includes('"Dentist"'),
  );
  calls.length = 0;
  const ambiguous = await call("loki_decide", { action_id: "8337d0f", decision: "approve" });
  check(
    "an ambiguous prefix decides NOTHING",
    ambiguous.isError === true && !calls.some((c) => c.startsWith("decide")),
  );
  check(
    "resolveActionId: a full id passes through, a miss is answered",
    resolveActionId("8337D0FE-1BB1-4C40-98E5-4961196B8DE2", []).ok &&
      !resolveActionId("dead", ["beef"]).ok,
  );

  const dispatched = await call("loki_dispatch", { project: "loki", task: "fix the header" });
  check(
    "loki_dispatch says queued and that the outcome arrives as a notification",
    !dispatched.isError &&
      dispatched.content[0].text.includes("Queued") &&
      dispatched.content[0].text.includes("notification"),
  );
  const projects = await call("loki_projects", {}, chat);
  check(
    "loki_projects lists names with a one-line status",
    projects.content[0].text.includes("- loki: Execution layer"),
  );

  // ── protocol header ───────────────────────────────────────────────────────
  check(
    "MCP-Protocol-Version: absent or known is fine, unknown is refused",
    isAcceptableProtocolHeader(null) &&
      isAcceptableProtocolHeader("2025-03-26") &&
      !isAcceptableProtocolHeader("1999-01-01"),
  );

  // ── Loki's own propose tools are out of reach of a chat-only turn ─────────
  const registry = {
    look: defineTool({
      name: "look",
      kind: "read",
      description: "",
      params: z.object({}),
      example: "",
      handler: async () => ({ facts: [] }),
    }),
    draft: defineTool({
      name: "draft",
      kind: "propose",
      description: "",
      params: z.object({}),
      example: "",
      handler: async () => ({ facts: [] }),
    }),
  };
  check(
    "readOnlyRegistry drops every propose tool and keeps the reads",
    Object.keys(readOnlyRegistry(registry)).join() === "look",
  );

  for (const [name, okCase] of cases) console.log(`${okCase ? "✓" : "✗"} ${name}`);
  console.log(`\n${pass}/${cases.length} passed`);
  if (pass !== cases.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
