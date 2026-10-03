// Pure unit test: transcript usage collection + model pricing + display format.
// No DB, no server — auto-discovered by scripts/test-unit.ts.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeProjectSlug, collectClaudeUsage } from "../../src/lib/usage/claude-transcript-usage";
import { priceUsage, rateForModel } from "../../src/config/model-pricing";
import { formatRunUsage, formatTokens, formatCostUsd } from "../../src/lib/usage/format";

// --- claudeProjectSlug: dots AND slashes become dashes (worktree paths!) ---
assert.equal(claudeProjectSlug("/home/g/dev/app"), "-home-g-dev-app");
assert.equal(
  claudeProjectSlug("/home/g/dev/app/.claude/worktrees/x"),
  "-home-g-dev-app--claude-worktrees-x",
);
// Every non-alphanumeric becomes "-", as Claude Code does — "_" and "~" too.
// The old rule kept them and looked in folders that never exist.
assert.equal(claudeProjectSlug("/home/loki/dev/my_app"), "-home-loki-dev-my-app");
assert.equal(claudeProjectSlug("/w/solon~ab12cd34"), "-w-solon-ab12cd34");

// --- collectClaudeUsage over a fixture transcript ---
const home = fs.mkdtempSync(path.join(os.tmpdir(), "fc-usage-test-"));
const dir = "/home/g/dev/app/.claude/worktrees/x";
const projDir = path.join(home, ".claude", "projects", claudeProjectSlug(dir));
fs.mkdirSync(projDir, { recursive: true });

const T0 = Date.parse("2026-08-02T10:00:00Z");
const line = (offsetMs: number, msgId: string, model: string, usage: Record<string, number>) =>
  JSON.stringify({
    type: "assistant",
    uuid: `u-${msgId}-${offsetMs}`,
    timestamp: new Date(T0 + offsetMs).toISOString(),
    message: { id: msgId, model, usage },
  });

fs.writeFileSync(
  path.join(projDir, "session-a.jsonl"),
  [
    // Before the window — excluded.
    line(-60_000, "m0", "claude-opus-5-20260501", { input_tokens: 999, output_tokens: 999 }),
    // In window.
    line(10_000, "m1", "claude-opus-5-20260501", {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 4000,
    }),
    // Same message id repeated (multi-block turn) — must dedupe, not double.
    line(10_500, "m1", "claude-opus-5-20260501", {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 4000,
    }),
    // Second model in window, unknown to pricing.
    line(20_000, "m2", "future-model-x", { input_tokens: 100, output_tokens: 50 }),
    // Non-assistant line with usage-looking content — ignored.
    JSON.stringify({
      type: "user",
      timestamp: new Date(T0 + 21_000).toISOString(),
      message: { usage: { input_tokens: 5 } },
    }),
    // Malformed line — skipped without throwing.
    "{not json",
    // After the window — excluded.
    line(600_000, "m3", "claude-opus-5-20260501", { input_tokens: 777, output_tokens: 777 }),
  ].join("\n"),
);

const usage = collectClaudeUsage(dir, T0, T0 + 120_000, home);
assert.ok(usage, "usage should not be null");
assert.equal(usage.totals.input, 1100);
assert.equal(usage.totals.output, 550);
assert.equal(usage.totals.cacheRead, 200_000);
assert.equal(usage.totals.cacheWrite, 4000);
assert.equal(usage.messageCount, 2);
assert.deepEqual(usage.sessionIds, ["session-a"]);
assert.equal(Object.keys(usage.models).length, 2);

// Missing project dir → null (non-Claude agent), not a throw.
assert.equal(collectClaudeUsage("/nowhere/at/all", T0, T0 + 1000, home), null);

// --- pricing ---
assert.ok(rateForModel("claude-opus-5-20260501"), "opus 5 must be priced");
assert.equal(rateForModel("totally-unknown"), null);

const priced = priceUsage(usage.models);
// opus-5: 1000 in @$5/M + 500 out @$25/M + 200k cacheRead @$0.5/M + 4k cacheWrite @$6.25/M
const expected = (1000 / 1e6) * 5 + (500 / 1e6) * 25 + (200_000 / 1e6) * 0.5 + (4000 / 1e6) * 6.25;
assert.ok(
  priced.costUsd !== null && Math.abs(priced.costUsd - Math.round(expected * 1e4) / 1e4) < 1e-9,
);
assert.deepEqual(priced.unpricedModels, ["future-model-x"]);

// Nothing priced at all → null cost, not $0 (an honest "don't know").
assert.equal(
  priceUsage({ mystery: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 } }).costUsd,
  null,
);

// --- display format ---
assert.equal(formatTokens(950), "950");
assert.equal(formatTokens(132_400), "132k");
assert.equal(formatTokens(1_240_000), "1.2M");
assert.equal(formatCostUsd(0.421), "~$0.42");
assert.equal(formatCostUsd(12.4), "~$12");
assert.equal(formatCostUsd(0.001), "<$0.01");
assert.equal(formatCostUsd(null), null);
assert.equal(
  formatRunUsage({ tokensIn: 1100, tokensOut: 550, tokensCacheRead: 200_000, costUsd: 0.13 }),
  "201k → 550 tok · ~$0.13",
);
assert.equal(formatRunUsage({ tokensIn: null, tokensOut: null, costUsd: null }), null);

fs.rmSync(home, { recursive: true, force: true });
console.log("run-usage: all assertions passed");
