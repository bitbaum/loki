/**
 * Loki as an MCP server — the SSOT for what a connected AI app is told.
 *
 * A remote MCP connector (claude.ai, ChatGPT, Claude Code, Cursor, …) reaches
 * Loki at ONE url and learns everything else from that url: the protected
 * resource metadata names OrangeCat as the authorization server, the scopes
 * say what can be granted, and each tool says which scope it needs. Those four
 * facts are stated here and nowhere else, because OrangeCat's authorization
 * server is built against the same strings — a scope spelled differently on
 * either side is a consent screen that grants nothing.
 *
 * Pure on purpose: no @/db, so the unit suite and the metadata route can load
 * it without a database. See docs/development/mcp.md for how it is used.
 */
import { APP_DOMAIN, APP_NAME } from "@/config/brand";
import { ROUTES } from "@/config/auth";
import { ORANGECAT_OAUTH_ISSUER } from "@/config/orangecat";

/**
 * The resource indicator (RFC 8707). OrangeCat mints a token FOR this url —
 * `aud` must equal it — and that audience check is what stops a token minted
 * for some other OrangeCat client from being replayed here.
 */
export const MCP_RESOURCE = process.env.LOKI_MCP_RESOURCE ?? `https://${APP_DOMAIN}/api/mcp`;

/** Who issues the access tokens Loki accepts. */
export const MCP_AUTHORIZATION_SERVER = ORANGECAT_OAUTH_ISSUER;

/** Where the issuer publishes its signing keys. Part of the shared contract. */
export const MCP_JWKS_URL = `${ORANGECAT_OAUTH_ISSUER.replace(/\/+$/, "")}/oauth/jwks.json`;

/**
 * Two scopes, split on the one line that matters to someone granting access:
 * can this app only TALK to Loki, or can it make things HAPPEN.
 *
 *   loki.chat — ask Loki, read the fleet and the approval queue.
 *   loki.act  — dispatch work, book appointments, decide queued actions.
 */
export const MCP_SCOPE = {
  chat: "loki.chat",
  act: "loki.act",
} as const;

export type McpScope = (typeof MCP_SCOPE)[keyof typeof MCP_SCOPE];

export const MCP_SCOPES_SUPPORTED: readonly McpScope[] = [MCP_SCOPE.chat, MCP_SCOPE.act];

/**
 * Tool → the scope it needs. A tool missing from this map does not typecheck
 * in lib/mcp/tools.ts, so there is no way to ship one without deciding.
 */
export const MCP_TOOL_SCOPES = {
  ask_loki: MCP_SCOPE.chat,
  loki_pending_approvals: MCP_SCOPE.chat,
  loki_projects: MCP_SCOPE.chat,
  loki_decide: MCP_SCOPE.act,
  loki_dispatch: MCP_SCOPE.act,
  loki_book: MCP_SCOPE.act,
} as const satisfies Record<string, McpScope>;

export type McpToolName = keyof typeof MCP_TOOL_SCOPES;

/**
 * Protocol revisions this server speaks, newest first. `initialize` echoes the
 * client's when it is here and otherwise offers the first entry — the spec's
 * negotiation, and the reason the order is load-bearing.
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

/** The origin of the resource url — the base every discovery url hangs off. */
export const MCP_RESOURCE_ORIGIN = new URL(MCP_RESOURCE).origin;

/**
 * Protected resource metadata (RFC 9728). Served at the origin's well-known
 * path AND at the path-suffixed one, because clients disagree about which they
 * derive from a resource that has a path; both answer with this.
 */
export const MCP_RESOURCE_METADATA_URL = `${MCP_RESOURCE_ORIGIN}/.well-known/oauth-protected-resource`;

export function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_AUTHORIZATION_SERVER],
    scopes_supported: [...MCP_SCOPES_SUPPORTED],
    bearer_methods_supported: ["header"],
    resource_name: APP_NAME,
  };
}

/**
 * Where a person with a valid OrangeCat token but no Loki account goes. Signing
 * in once with OrangeCat is what writes their actor id onto a Loki user, which
 * is the only link the token can be resolved through.
 */
export const MCP_LINK_ACCOUNT_URL = `${MCP_RESOURCE_ORIGIN}${ROUTES.SIGN_IN}`;

/** Longest message ask_loki forwards. Loki's own chat route caps history turns at 4000. */
export const MCP_MESSAGE_MAX_CHARS = 4000;

/**
 * Sent once, at `initialize`. The connecting model reads this before any tool
 * description, so it carries the two things a tool description cannot: what
 * Loki IS, and the rule that acting and approving are the owner's decisions.
 */
export const MCP_SERVER_INSTRUCTIONS = [
  `${APP_NAME} is the owner's execution layer: it holds their registered software projects, the AI agent fleet that works on them, their calendar, and an approval queue for anything done in their name.`,
  "Use ask_loki for questions about their projects, fleet activity, people, commitments or schedule — it answers from their own records.",
  "Use loki_projects to find the exact project name before loki_dispatch, which sends a coding task to that project's agent; the outcome arrives later as a notification, so do not poll for it.",
  "Use loki_book to put an appointment in their calendar, with absolute ISO 8601 times that include the offset. Report the returned status literally: 'awaiting-approval' is not booked.",
  "Use loki_pending_approvals to see what waits for the owner's yes, and loki_decide only when the owner has explicitly approved or rejected that specific item in this conversation — approving executes it.",
].join("\n");
