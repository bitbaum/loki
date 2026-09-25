/**
 * SSOT for public demo access — the "explore without an account" door.
 *
 * Fleet standard (George, 2026-08-07): every project offers demo access a
 * visitor can use with no profile. Loki was the last app without one,
 * and it is also the only one where a careless demo is dangerous: this app
 * dispatches Claude agents onto a real box, opens real terminal sessions, and
 * spends real API credit. So the demo is SANDBOXED — it may exercise the
 * product inside its own tenant, and every effect that would leave that tenant
 * is denied.
 *
 * The credentials below are PUBLIC BY DESIGN. They are printed on the sign-in
 * page. Treat them as the key to a shared kiosk, not as a secret — the security
 * boundary is the policy in this file plus the asserts in src/lib/demo-guard.ts,
 * never the obscurity of the password.
 *
 * Two independent layers guard the box, on purpose:
 *
 *   1. ROUTE POLICY (this file) — consumed by the authorized() callback in
 *      src/auth.config.ts, which every authenticated request already passes
 *      through. Denies mutating requests to effect-bearing route families.
 *   2. EFFECT ASSERTS (src/lib/demo-guard.ts) — called at the effects
 *      themselves: enqueuePendingCommand (the single row through which anything
 *      reaches the machine), the RAG reindex, and the handlers listed in
 *      DEMO_HANDLER_ENFORCED. Outbound comms are reachable only through
 *      /api/actions, /api/people and cron, so layer 1 and CRON_SECRET cover
 *      them — there is no assert inside sendTelegramMessage, which takes no
 *      userId to check.
 *
 * They fail differently. Widening layer 1 by editing a list here still cannot
 * reach the box, because layer 2 does not consult this file. That redundancy is
 * the point; do not "simplify" it into one list.
 */

/** Public demo identity. Seeded by scripts/seed-demo.ts, reset nightly. */
export const DEMO_EMAIL = "demo@loki.app";
/** Public by design — shown on the sign-in page. Not a secret. */
export const DEMO_PASSWORD = "explore-the-fleet";
export const DEMO_NAME = "Demo Pilot";
export const DEMO_USERNAME = "demo";

/**
 * Is this the demo account? Compared case-insensitively because the register
 * route lowercases on write but OAuth providers do not.
 */
export function isDemoEmail(email?: string | null): boolean {
  return typeof email === "string" && email.trim().toLowerCase() === DEMO_EMAIL;
}

/**
 * Master switch. Off unless a deployment explicitly opts in, so the demo user
 * cannot exist by accident on an instance holding only real data — and so the
 * nightly reset (which DELETES a user) has a second condition to satisfy before
 * it runs. See src/app/api/crons/reset-demo/route.ts.
 */
export function isDemoEnabled(): boolean {
  return process.env.DEMO_ACCESS_ENABLED === "1";
}

/**
 * Why a demo request was refused. The reason is user-facing: a demo that says
 * "Not available" and nothing else reads as a broken app, which is the opposite
 * of what a demo is for.
 */
export type DemoDenialReason =
  | "dispatch"
  | "terminal"
  | "spend"
  | "outbound"
  | "billing"
  | "credentials"
  | "tenancy"
  | "content"
  | "infrastructure";

export const DEMO_DENIAL_COPY: Record<DemoDenialReason, string> = {
  dispatch:
    "Dispatching an agent runs real work on a real machine, so it is off in the demo. The runs already in here are real history — open one and read it end to end.",
  terminal: "Terminal sessions attach to a live machine, so they are read-only in the demo.",
  spend: "This calls a paid model, so it is off in the demo.",
  outbound: "This would send a real message to a real person, so it is off in the demo.",
  billing:
    "Billing is off in the demo — nothing here can be charged. Create your own account to pick a plan.",
  credentials: "The demo account is shared, so its credentials and tokens are fixed.",
  tenancy: "Team, workspace and integration settings are off in the demo.",
  content:
    "Publishing pushes to a public surface, so it is off in the demo. Existing published items are all readable.",
  infrastructure: "Infrastructure controls are off in the demo.",
};

/**
 * Route families whose MUTATIONS the demo may not perform, with the effect that
 * makes each unsafe.
 *
 * Every entry here MUST be reachable by the proxy matcher in src/proxy.ts —
 * scripts/test-unit.ts asserts exactly that. A deny rule on a path the matcher
 * excludes is worse than no rule: it reads as protection and enforces nothing.
 * Families the matcher excludes are handled in DEMO_HANDLER_ENFORCED instead.
 *
 * Deny by EFFECT, not by URL aesthetics: the question for a new entry is always
 * "can this reach the box, someone's inbox, or a paid API?" — never "does this
 * feel administrative?".
 */
export const DEMO_DENIED_PREFIXES: ReadonlyArray<readonly [string, DemoDenialReason]> = [
  // — reaches the box ————————————————————————————————————————————————
  ["/api/control", "dispatch"],
  ["/api/agents", "dispatch"],
  ["/api/agent", "credentials"], // mints ck_* tokens
  ["/api/agent-tokens", "credentials"], // mints ck_* tokens the runner authenticates with
  // Stores a user's own model API key and calls vendors with it. The demo
  // account is shared: a key saved there would power every visitor's chat on
  // someone's bill, and the probe would turn the server into a key checker.
  ["/api/settings", "credentials"],
  ["/api/orchestration", "dispatch"],
  ["/api/inject", "terminal"],
  ["/api/terminal", "terminal"],
  ["/api/command", "terminal"],

  // — spends API credit ——————————————————————————————————————————————
  ["/api/loki", "spend"],
  ["/api/conversations", "spend"],
  ["/api/frontier", "spend"],
  ["/api/memory", "spend"],
  ["/api/atlas", "spend"],
  ["/api/captures", "spend"],
  ["/api/hermes", "spend"],
  ["/api/ai", "spend"], // form-assist — one model call per submit
  ["/api/widget", "spend"], // widget speech-to-text — one Whisper call per clip

  // — sends something to a real human ————————————————————————————————
  ["/api/actions", "outbound"],
  ["/api/people", "outbound"],
  ["/api/push", "outbound"],

  // — money ——————————————————————————————————————————————————————————
  // /api/checkout lived here until #508 deleted the Stripe rail with it.
  ["/api/subscriptions", "billing"],

  // — identity and tenancy ———————————————————————————————————————————
  ["/api/me/password", "credentials"],
  ["/api/orgs", "tenancy"],
  ["/api/workspaces", "tenancy"],
  ["/api/invitations", "tenancy"],
  ["/api/integrations", "tenancy"],
  ["/api/github", "tenancy"],
  ["/api/decisions", "content"],
] as const;

/**
 * Denied prefixes whose SUB-paths the proxy matcher excludes on purpose, with
 * the reason. The bare path is gated; deeper paths are not.
 *
 * This exists so partial coverage is DECLARED. Without it the reachability test
 * has only two options — demand full coverage (which would force these public
 * routes behind a session and break them) or probe only the bare path (which
 * would let a genuinely unreachable sub-tree hide behind a reachable parent).
 */
export const DEMO_PARTIAL_PREFIXES: Readonly<Record<string, string>> = {
  "/api/invitations":
    "/api/invitations/<token> must answer before a session exists — that IS how an " +
    "invitee accepts. Creating and listing invitations (the bare path) is gated; " +
    "validating and accepting a token is public by design and touches no demo data.",
} as const;

/**
 * Families the proxy matcher deliberately EXCLUDES (they must answer before a
 * session exists), so the demo gate cannot live in middleware for them. Each is
 * enforced inside its own handler via requireNotDemo(); the named file is where.
 *
 * scripts/test-unit.ts asserts the inverse of the list above: every entry here
 * really is matcher-excluded, and every named file really does call the guard.
 * Otherwise this table becomes a comment that documents protection nobody wrote.
 *
 * Not listed, deliberately: /api/system exposes only a GET of host stats — no
 * mutation to deny, and reading uptime costs nothing. /api/newsletter, /api/feedback and /api/widget-boot
 * are public endpoints any anonymous visitor may already call, so gating the
 * demo account specifically would protect nothing. /api/stripe/webhook,
 * /api/orangecat/* and /api/solon/* verify their own HMAC signatures and are not
 * reachable by a browser session at all. /api/crons/* requires CRON_SECRET.
 */
export const DEMO_HANDLER_ENFORCED: ReadonlyArray<readonly [string, DemoDenialReason, string]> = [
  ["/api/auth/forgot-password", "credentials", "src/app/api/auth/forgot-password/route.ts"],
  ["/api/auth/reset-password", "credentials", "src/app/api/auth/reset-password/route.ts"],
  ["/api/beacon/transcribe", "spend", "src/app/api/beacon/transcribe/route.ts"],
] as const;

/**
 * Sub-paths of a denied parent that ARE safe to mutate. A demo that cannot open
 * a project detail page is not a demo, and /api/control owns both the dispatch
 * button and much of the reading surface.
 *
 * Longest match wins, so these override DEMO_DENIED_PREFIXES.
 */
export const DEMO_WRITE_CARVEOUTS: readonly string[] = [
  "/api/control/activity", // records that the operator LOOKED at something
] as const;

/**
 * GET is otherwise allowed — reads are already tenant-scoped, so the demo can
 * only ever read its own seeded rows. These few GETs are the exception because
 * the read itself causes the effect (generates a digest, calls a model).
 */
export const DEMO_DENIED_GET_PREFIXES: ReadonlyArray<readonly [string, DemoDenialReason]> = [
  ["/api/frontier", "spend"],
  ["/api/hermes", "spend"],
] as const;

/**
 * Route families the demo may freely mutate — its own tenant data. Listed
 * EXPLICITLY rather than inferred as "everything not denied", so that
 * scripts/test-unit.ts can assert every family on disk appears in exactly one
 * list.
 *
 * That assertion is the entire point of this list. A deny-list cannot see a
 * route family that did not exist when it was written, and the failure mode is
 * silent: the next feature ships a spending endpoint the demo can call. The
 * test turns that silence into a red build.
 */
export const DEMO_SAFE_FAMILIES: readonly string[] = [
  "activity",
  "alerts",
  "beacon-settings",
  "builder",
  "calendar",
  "commitments",
  "crew",
  "crons",
  "debug-log",
  "event-stream-token",
  "events",
  "feedback",
  "fleet",
  "goals",
  "habits",
  "health",
  "me",
  "metrics",
  "newsletter",
  "notification-preferences",
  "onboarding",
  "orangecat",
  "project",
  "project-states",
  "projects",
  "prompts",
  "providers",
  "robots",
  "sessions",
  "setup",
  "share",
  "solon",
  "system",
  "today",
  "user-projects",
  "weather",
  "widget-boot",
  "x-login",
] as const;
// Two of these deserve their reasoning written down rather than inferred:
//
//   crew  — assignments and the roster are the demo's own tenant rows, and
//           Loki never DELIVERS an assignment: handing one over mints a
//           link the operator copies themselves, so no inbox is reached. The
//           one crew effect that does leave the tenant is publishing a fee to
//           OrangeCat, and that route carries its own denyDemoInHandler call —
//           it cannot live in DEMO_HANDLER_ENFORCED because the matcher does
//           reach /api/crew, and this list is for families it excludes.
//   providers — read-only, and every input is the caller's own: their projects,
//           their preference row, their builder's capability report, their own
//           runs. It spends nothing to answer (the quota evidence is read from
//           runs already recorded, never probed from a vendor), so a demo
//           account asking who else could build is asking about itself.
//   share — the assignee's endpoint. It answers on a token, before and without
//           any session, exactly like /api/invitations/<token>. Gating the demo
//           account on it would protect nothing: a caller holding a share token
//           is not signed in as anybody.

/** Longest-prefix match over the policy above. Pure — safe on the edge runtime. */
export function demoDenialFor(pathname: string, method: string): DemoDenialReason | null {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return DEMO_DENIED_GET_PREFIXES.find(([p]) => under(p))?.[1] ?? null;
  }

  // A carve-out beats its denied parent regardless of list order.
  if (DEMO_WRITE_CARVEOUTS.some(under)) return null;

  let best: readonly [string, DemoDenialReason] | null = null;
  for (const entry of DEMO_DENIED_PREFIXES) {
    if (!under(entry[0])) continue;
    if (!best || entry[0].length > best[0].length) best = entry;
  }
  return best?.[1] ?? null;
}
