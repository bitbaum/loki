/**
 * A token minted for an agent drives sessions; it never acts as a builder.
 *
 * Until 2026-11-12 every ck_ token could claim the next command, ack it, and
 * post a PTY's screen, transcript, runtime state and a run's progress. A token
 * handed to an agent so it could start, send to and read sessions could
 * therefore take another builder's work, or show the owner a screen or a
 * "working" beat no PTY printed. The `kind` column ("runner" | "agent") and
 * getRunnerApiUserId close that, without touching any token minted before.
 *
 * Run: npx tsx scripts/test/agent-token-kind.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokenMayActAsRunner } from "@/lib/agent-token-kind";
import { AGENT_TOKEN_KINDS } from "@/db/schema/agent-tokens";

let n = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  n++;
};

ok(tokenMayActAsRunner("runner"), "a builder's token acts as a builder");
ok(!tokenMayActAsRunner("agent"), "an agent's token does not");
ok(
  AGENT_TOKEN_KINDS.join(",") === "runner,agent",
  "two kinds; a new kind needs a decision here, not a default",
);

/** The body of one exported handler, up to the next export. */
function handler(file: string, method: string): string {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf(`export async function ${method}(`);
  assert.ok(start >= 0, `${file} exports ${method}`);
  const next = src.indexOf("export async function", start + 10);
  return src.slice(start, next < 0 ? undefined : next);
}

// The builder's own calls: each resolves its caller as a runner.
const RUNNER_ONLY: [string, string][] = [
  ["src/app/api/control/commands/route.ts", "GET"], // claim the next command
  ["src/app/api/control/commands/[id]/route.ts", "PATCH"], // ack it
  ["src/app/api/control/peek-frame/route.ts", "POST"], // the PTY's screen
  ["src/app/api/control/transcript-frame/route.ts", "POST"], // its conversation
  ["src/app/api/control/runtime-state/route.ts", "POST"], // what is running
  ["src/app/api/control/runs/[id]/progress/route.ts", "PATCH"], // the alive beat
];
for (const [file, method] of RUNNER_ONLY) {
  const body = handler(file, method);
  ok(
    body.includes("getRunnerApiUserId()") && !body.includes("getApiUserId()"),
    `${method} ${file} admits builders only`,
  );
}

// What an agent does stays open to its token: reading a dispatch's status.
ok(
  handler("src/app/api/control/commands/[id]/route.ts", "GET").includes("getApiUserId()"),
  "an agent still reads the status of what it dispatched",
);

// Nothing minted before the column existed loses a power on deploy.
const migration = readFileSync("drizzle/0138_agent_token_kind.sql", "utf8");
ok(
  /ADD COLUMN "kind" text DEFAULT 'runner' NOT NULL/.test(migration),
  "existing tokens become runners",
);
ok(
  /kind: z\.enum\(AGENT_TOKEN_KINDS\)\.optional\(\)/.test(
    readFileSync("src/app/api/agent-tokens/route.ts", "utf8"),
  ) && /kind \?\? "runner"/.test(readFileSync("src/app/api/agent-tokens/route.ts", "utf8")),
  "a client that sends no kind (a builder's pairing) still gets a runner token",
);

console.log(`✓ agent-token-kind: ${n} checks passed`);
