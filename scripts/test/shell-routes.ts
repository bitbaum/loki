/**
 * The shell's doors are gated where the requests arrive, and its audit trail
 * only ever grows. These read the source because the routes need a session and
 * a database; the decisions they call are tested in plain-shell.ts.
 * Run: npx tsx scripts/test/shell-routes.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(p, "utf8");

// Every route under /api/shell gates through the shell's own check, on the
// SESSION (getSessionUserId) — except the builder's event report, which is the
// runner's bearer token and informational only.
for (const name of ["open", "close"]) {
  const src = read(`src/app/api/shell/${name}/route.ts`);
  assert.match(src, /requireShellAccess\(/, `${name} is gated`);
  assert.doesNotMatch(src, /getApiUserId/, `${name} never accepts a bearer token`);
}
assert.match(
  read("src/app/api/shell/open/route.ts"),
  /needUnlock: true/,
  "opening needs the unlock",
);
assert.match(
  read("src/app/api/shell/open/route.ts"),
  /checkRateLimit\(/,
  "opening is rate limited",
);
for (const name of ["status", "unlock"]) {
  const src = read(`src/app/api/shell/${name}/route.ts`);
  assert.match(src, /loadShellCaller\(\)/, `${name} reads the operator from the session`);
  assert.doesNotMatch(src, /getApiUserId/);
}
assert.match(
  read("src/app/api/shell/unlock/route.ts"),
  /checkRateLimit\(/,
  "PIN tries are limited",
);
assert.match(
  read("src/app/api/shell/unlock/route.ts"),
  /decideShellAccess\(caller\.signals, false\)/,
  "non-operators cannot even try a PIN",
);

// Typing and reading: the shell branch comes BEFORE the bearer-token auth.
const raw = read("src/app/api/control/tab-inject-raw/route.ts");
assert.ok(
  raw.indexOf("isShellTab(body.tab)") < raw.indexOf("getApiUserId()"),
  "shell keys never reach bearer auth",
);
assert.match(raw, /needUnlock: true/);
assert.match(raw, /refusalResponse\("no-channel"/, "a shell key must name its builder");
const peek = read("src/app/api/control/peek-stream/route.ts");
assert.match(peek, /isShellTab\(tab\)[\s\S]*requireShellAccess/, "a shell's screen is gated");
assert.match(peek, /SHELL_IDLE_MS/, "an idle shell stream closes itself");
assert.match(
  read("src/app/api/control/close-tab/route.ts"),
  /isShellTab/,
  "agent close refuses shells",
);

// Nothing that makes commands can make one that names a shell, except the gate.
assert.match(
  read("src/db/queries/pending-commands.ts"),
  /shellCommandRefusal\(command\.type, command\.payload\)/,
);
assert.match(read("desktop/src/main/command-validator.ts"), /cannot target a shell tab/);
assert.match(read("desktop/src/main/pty-runtime.ts"), /refusing to inject a prompt into a shell/);

// The audit trail: appended to, never changed, and carries no content.
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
for (const file of walk("src")) {
  const src = read(file);
  if (!src.includes("shellAuditEvents")) continue;
  assert.doesNotMatch(
    src,
    /\.(update|delete)\(\s*shellAuditEvents/,
    `${file} must not edit the audit trail`,
  );
}
const schema = read("src/db/schema/shell-audit-events.ts");
for (const forbidden of ["command", "keystroke", "output", "content", "input"])
  assert.doesNotMatch(
    schema.replace(/\/\*[\s\S]*?\*\//g, ""),
    new RegExp(`"${forbidden}`),
    `no ${forbidden} column`,
  );

console.log("✓ shell-routes: every door is gated, the queue refuses shells, the audit only grows");
