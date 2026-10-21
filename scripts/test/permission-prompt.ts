import assert from "node:assert/strict";
import { detectPermissionPrompt, RUN_BLOCKED, shouldBeat } from "@/lib/run-progress";
import { summarizeRunStep } from "@/lib/feedback/run-step";

// Gemini 0.65 (Substrata, 2026-10-21) — shown as Working while it waited.
const gemini =
  "\x1b[2K │ ✓ ReadFile src/app/chat/page.tsx\r\n" +
  "╭──────────────────────────────╮\r\n│ ? Shell npm run build\r\n│ Allow execution of [Shell]?\r\n" +
  "│ ● 1. Allow once\r\n│   2. Allow for this session\r\n│   3. No, suggest changes (esc)\r\n╰──────╯";
assert.equal(detectPermissionPrompt(gemini), "Allow execution of [Shell]?");

const claude =
  "Bash command\r\n  npm test\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. Yes, and don't ask again for npm test\r\n  3. No";
assert.equal(detectPermissionPrompt(claude), "Do you want to proceed?");

const codex =
  "Allow command?\r\n  $ git push\r\n› 1. Yes, proceed\r\n  2. No, and tell Codex what to do differently";
assert.equal(detectPermissionPrompt(codex), "Allow command?");

const cursor = "Run this command?\r\n  rm -rf dist\r\n → Run (once) (y)\r\n   Skip (esc or n)";
assert.equal(detectPermissionPrompt(cursor), "Run this command?");

// Not questions: plain work, a numbered plan, the agent's own prose.
assert.equal(detectPermissionPrompt("✦ I'll fix the scroll container.\r\n✓ Edit page.tsx"), null);
assert.equal(
  detectPermissionPrompt("Plan:\r\n1. Read the page\r\n2. Fix scrolling\r\n3. Test"),
  null,
);
// A question long scrolled past by new work no longer counts.
assert.equal(
  detectPermissionPrompt(
    gemini + "\r\n" + Array.from({ length: 30 }, (_, i) => `✓ Edit file${i}.ts`).join("\r\n"),
  ),
  null,
);

// A blocked agent beats even though it prints nothing.
assert.equal(
  shouldBeat({
    bytesSinceBeat: 0,
    lastBeatAt: 0,
    startedAt: Date.now(),
    blocked: RUN_BLOCKED.PERMISSION,
  }),
  "beat",
);

// The row says Needs you with the question, never Working.
const step = summarizeRunStep({
  blocked: "permission",
  blockedQuestion: "Allow execution of [Shell]?",
  lastProgressAt: new Date().toISOString(),
});
assert.equal(step.kind, "blocked");
assert.match(step.summary, /Needs you/);
assert.equal(step.detail, "Allow execution of [Shell]?");

const dead = summarizeRunStep({
  blocked: "exited",
  blockedQuestion: "the agent process was killed",
  lastProgressAt: new Date().toISOString(),
});
assert.equal(dead.kind, "blocked");
assert.equal(dead.summary, "Agent stopped");

console.log("✓ permission prompts read as Needs you");
