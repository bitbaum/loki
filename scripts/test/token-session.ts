/**
 * A browser session opened with an agent's token has the token's power, no
 * more (src/lib/auth/token-session.ts).
 *
 * QA's Viewer seat could call the API with its `ck_` token, but every page
 * (/projects, /terminal, the workbench, history, feedback) sent its browser
 * to sign-in, because a page load cannot carry a Bearer header. The token now
 * mints a single-use, two-minute link that opens a one-hour session. This
 * pins what that session may and may not do. The database half (single use,
 * expiry, revocation) is scripts/test/token-session-db.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { authConfig } from "../../src/auth.config";
import {
  LINK_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  TOKEN_SESSION_AUTH_PATHS,
  TOKEN_SESSION_OPEN_PATH,
  TOKEN_SESSION_WRITE_HEADER,
  isReadMethod,
  safeNextPath,
  tokenSessionDenial,
} from "../../src/lib/auth/token-session";
import { isOpenSharedPath } from "../../src/lib/auth/shared/open-paths";

const read = (p: string) => fs.readFileSync(p, "utf8");

// ── short lives ────────────────────────────────────────────────────────────
assert.ok(LINK_TTL_SECONDS <= 300, "a link lives minutes, not longer");
assert.ok(SESSION_TTL_SECONDS <= 4 * 60 * 60, "a token session lives hours at most");

// ── where a link may land ──────────────────────────────────────────────────
assert.equal(safeNextPath("/projects"), "/projects");
assert.equal(safeNextPath("/terminal?project=qa-agent-walk"), "/terminal?project=qa-agent-walk");
for (const bad of [
  "https://evil.example/",
  "//evil.example/",
  "/\\evil.example",
  "javascript:alert(1)",
  "/api/agent-tokens",
  "/api/auth/sign-out",
  "",
  undefined,
  42,
]) {
  assert.equal(safeNextPath(bad), "/", `lands on / for ${String(bad)}`);
}

// ── what a token session never reaches ─────────────────────────────────────
for (const denied of [
  "/api/agent-tokens",
  ["/api", "agent-tokens", "abc"].join("/"), // a child of a refused route
  "/api/event-stream-token",
  "/api/token-session",
  "/api/me/password",
  "/api/me/connected-accounts/github",
  "/api/me/export",
  "/api/shell/open",
]) {
  assert.ok(tokenSessionDenial(denied), `${denied} is refused`);
}
for (const allowed of [
  "/api/user-projects",
  "/api/me",
  "/api/projects/0b6f0a5e-0000-4000-8000-000000000000",
  "/api/control/transcript-stream",
  "/api/control/tab-inject",
  "/api/sessions",
  ["/api", "agent-tokens-help"].join("/"), // a prefix match is a whole segment, not a substring
]) {
  assert.equal(tokenSessionDenial(allowed), null, `${allowed} is not refused`);
}
assert.equal(isReadMethod("get"), true);
assert.equal(isReadMethod("POST"), false);

// ── the middleware applies it, to token sessions only ──────────────────────
type AuthorizedArgs = Parameters<typeof authConfig.callbacks.authorized>[0];
async function decide(path: string, viaToken: boolean, method = "GET") {
  const request = new NextRequest(new URL(path, "https://loki.example"), { method });
  const auth = { user: { id: "u", onboardingComplete: true, viaToken }, expires: "" };
  return authConfig.callbacks.authorized({ auth, request } as unknown as AuthorizedArgs);
}
async function main() {
  const refused = await decide("/api/agent-tokens", true, "POST");
  assert.ok(refused instanceof Response && refused.status === 403, "a token session cannot mint");
  assert.equal(await decide("/api/agent-tokens", false, "POST"), true, "a person still can");
  assert.equal(await decide("/api/user-projects", true), true, "a token session reads");
  assert.equal(await decide("/projects", true), true, "a token session opens pages");
  const shell = await decide("/api/shell/open", true, "POST");
  assert.ok(shell instanceof Response && shell.status === 403, "a token session gets no shell");

  // ── the wiring ────────────────────────────────────────────────────────────
  // The proxy marks a token session's writes and drops a mark a client sent.
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /session\?\.user\?\.viaToken\) && !isReadMethod\(req\.method\)/);
  assert.match(proxy, /headers\.delete\(TOKEN_SESSION_WRITE_HEADER\)/);
  assert.equal(TOKEN_SESSION_WRITE_HEADER.startsWith("x-loki-"), true);

  // A person-only route reads a token session's write as signed out; a route
  // that takes a token takes the session, and calls it a token (shells stay out).
  const session = read("src/lib/session.ts");
  assert.match(session, /caller\.viaToken && \(await isTokenSessionWrite\(\)\)\) return null/);
  assert.match(session, /via: caller\.viaToken \? "token" : "session"/);

  // A session is marked from its row, and a revoked token signs it out.
  const compat = read("src/lib/auth/shared/compat.ts");
  assert.match(compat, /tokenSession\(shared\.session\.id\)/);
  assert.match(compat, /if \(viaToken && !viaToken\.live\) return null;/);

  // The link opens through AccountKit itself, and the session is recorded as
  // the token's before its cookie exists; it is never refreshed.
  assert.equal(isOpenSharedPath("/api/auth/loki/token-session"), true);
  const plugin = read("src/lib/auth/shared/token-session-plugin.ts");
  assert.ok(
    plugin.indexOf("bindTokenSession(link.id, session.id)") <
      plugin.indexOf("setSessionCookie(ctx, { session, user }, true)"),
    "marked before the cookie is set",
  );
  assert.match(plugin, /deleteSession\(session\.token\)/, "an unmarked session is ended");
  assert.match(read("src/lib/auth/shared/runtime.ts"), /lokiTokenSession\(\)/);
  // AccountKit's own endpoints: a token session reads and ends itself, nothing else.
  assert.deepEqual([...TOKEN_SESSION_AUTH_PATHS].sort(), [
    "/get-session",
    "/loki/token-session",
    "/sign-out",
  ]);

  // Minting takes a token, never a browser session, and never echoes it.
  const route = read("src/app/api/token-session/route.ts");
  assert.ok(
    route.includes(["", "api", "auth"].join("/") + TOKEN_SESSION_OPEN_PATH),
    "the link opens the plugin's endpoint",
  );
  assert.match(route, /header\.startsWith\("Bearer ck_"\)/);
  assert.doesNotMatch(route, /getSessionUserId|getApiUserId|getApiActor/);
  assert.doesNotMatch(route, /bearer\s*[,}]/, "the token is not in the answer");

  console.log("token-session ok");
}
void main();
