/**
 * "Delivered" needs the request in the agent's own conversation log, and the
 * builder tells the server when it delivered.
 *
 * Probe 9e3658d9, 2026-11-12: a request was typed into a project's live
 * session, which then went on with its own plan. A busy CLI looks the same
 * whether it is answering the request or doing something else; its log does
 * not. And the builder's ack built `deliveredAt` and `workspaceId` and then
 * dropped them on the way out, so delivery was stamped at ack time.
 *
 * Run: npx tsx scripts/test/prompt-in-transcript.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  newTranscriptState,
  reduceTranscriptLine,
  type TranscriptItem,
} from "@/lib/claude-transcript";
import { transcriptShowsPrompt } from "@/lib/prompt-evidence";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const INJECTED = Date.parse("2026-11-12T03:47:00Z");
const PROMPT =
  "Only run `git status --short --branch` in this repository, then stop.\n\nDo not edit any file.\n\n## Exit\nWrite the handoff to ~/.loki/sessions/orangecat.md";

/** Claude Code's own log lines, through the same reducer the runner uses. */
function log(lines: object[]): TranscriptItem[] {
  const state = newTranscriptState();
  return lines.flatMap((l) => reduceTranscriptLine(state, JSON.stringify(l)));
}
const user = (uuid: string, at: string, content: unknown) => ({
  type: "user",
  uuid,
  timestamp: at,
  message: { role: "user", content },
});
const assistant = (uuid: string, at: string, text: string) => ({
  type: "assistant",
  uuid,
  timestamp: at,
  message: { role: "assistant", content: [{ type: "text", text }] },
});

check("the request typed after the inject is found", () => {
  const items = log([
    user("u1", "2026-11-12T03:47:01Z", PROMPT),
    assistant("a1", "2026-11-12T03:47:03Z", "Running git status."),
  ]);
  assert(transcriptShowsPrompt(items, PROMPT, INJECTED), "not found");
});

check("found when the log keeps the text as content blocks, with other whitespace", () => {
  const items = log([
    user("u1", "2026-11-12T03:47:01Z", [
      { type: "text", text: PROMPT.replace(/\n/g, "\r\n").replace(/ /g, "  ") },
    ]),
  ]);
  assert(transcriptShowsPrompt(items, PROMPT, INJECTED), "not found");
});

// The message exactly as Claude Code 2.1.322 logged it, measured by driving
// the CLI in a pseudo-terminal the way the runner does (bracketed paste, then
// a separate Enter).
const MEASURED_PROMPT = Array.from(
  { length: 30 },
  (_, i) => `Line ${i + 1}: reply with the single word OK and do nothing else.`,
).join("\n");
const MEASURED_LOGGED =
  '\n\n<pasted_content id="57da">\nLine 1: reply with the single word OK and do nothing else.\nLine 2: reply with the single word OK and do nothing else.\nLine 3: reply with the single word OK and do nothing else.\nLine 4: reply with the single word OK and do nothing else.\nLine 5: reply with the single word OK and do nothing else.\nLine 6: reply with the single word OK and do nothing else.\nLine 7: reply with the single word OK and do nothing else.\nLine 8: reply with the single word OK and do nothing else.\nLine 9: reply with the single word OK and do nothing else.\nLine 10: reply with the single word OK and do nothing else.\nLine 11: reply with the single word OK and do nothing else.\nLine 12: reply with the single word OK and do nothing else.\nLine 13: reply with the single word OK and do nothing else.\nLine 14: reply with the single word OK and do nothing else.\nLine 15: reply with the single word OK and do nothing else.\nLine 16: reply with the single word OK and do nothing else.\nLine 17: reply with the single word OK and do nothing else.\nLine 18: reply with the single word OK and do nothing else.\nLine 19: reply with the single word OK and do nothing else.\nLine 20: reply with the single word OK and do nothing else.\nLine 21: reply with the single word OK and do nothing else.\nLine 22: reply with the single word OK and do nothing else.\nLine 23: reply with the single word OK and do nothing else.\nLine 24: reply with the single word OK and do nothing else.\nLine 25: reply with the single word OK and do nothing else.\nLine 26: reply with the single word OK and do nothing else.\nLine 27: reply with the single word OK and do nothing else.\nLine 28: reply with the single word OK and do nothing else.\nLine 29: reply with the single word OK and do nothing else.\nLine 30: reply with the single word OK and do nothing else.\n</pasted_content id="57da">\n';

check("found in a paste as Claude Code really logs it, inside pasted_content tags", () => {
  assert(MEASURED_LOGGED.includes("<pasted_content"), "fixture drifted");
  const items = log([user("u1", "2026-11-12T03:47:01Z", MEASURED_LOGGED)]);
  assert(
    transcriptShowsPrompt(items, MEASURED_PROMPT, INJECTED),
    "the real logged paste was missed",
  );
});

check("an older Claude Code's paste placeholder after the inject counts as the turn", () => {
  const items = log([user("u1", "2026-11-12T03:47:01Z", "[Pasted text #1 +30 lines]")]);
  assert(transcriptShowsPrompt(items, MEASURED_PROMPT, INJECTED), "the placeholder was missed");
  const old = log([user("u0", "2026-11-12T03:20:00Z", "[Pasted text #1 +30 lines]")]);
  assert(!transcriptShowsPrompt(old, MEASURED_PROMPT, INJECTED), "an earlier placeholder counted");
});

check("the incident: a busy session carrying on with its own plan has no request in it", () => {
  const items = log([
    user("u0", "2026-11-12T03:30:00Z", "Continue with the plan in NEXT.md."),
    assistant("a1", "2026-11-12T03:47:05Z", "Editing tests/home.spec.ts for the next step."),
  ]);
  assert(!transcriptShowsPrompt(items, PROMPT, INJECTED), "an unrelated session counted");
});

check("the same request from an earlier run does not count for this one", () => {
  const items = log([user("u0", "2026-11-12T03:20:00Z", PROMPT)]);
  assert(!transcriptShowsPrompt(items, PROMPT, INJECTED), "an old copy counted");
});

check("the agent's own reply quoting the request does not count", () => {
  const items = log([assistant("a1", "2026-11-12T03:47:05Z", PROMPT)]);
  assert(!transcriptShowsPrompt(items, PROMPT, INJECTED), "the reply counted");
});

check("a request that is only a fragment of another is not taken for it", () => {
  const items = log([user("u1", "2026-11-12T03:47:01Z", "Only run")]);
  assert(!transcriptShowsPrompt(items, PROMPT, INJECTED), "a fragment counted");
  assert(!transcriptShowsPrompt(items, "  ", INJECTED), "an empty prompt matched");
});

check("a few seconds of clock difference between builder and log is allowed", () => {
  const items = log([user("u1", "2026-11-12T03:46:57Z", PROMPT)]);
  assert(transcriptShowsPrompt(items, PROMPT, INJECTED), "3s early was rejected");
});

check("the builder checks the log before it calls a Claude dispatch delivered", () => {
  const src = read("desktop/src/main/poller.ts");
  assert(
    /if \(verified && agent === 'claude' && injectedAt\) \{\s*const seen = await waitForPromptInTranscript\(/.test(
      src,
    ),
    "the check is not on the dispatch path",
  );
  assert(
    /if \(seen === false\) \{\s*verified = false/.test(src),
    "a missing request still verifies",
  );
  assert(/return sawLog \? false : null/.test(src), "no log is treated as a refusal");
  assert(
    /\} else if \(!verified && !warning\) \{/.test(src),
    "a working agent without the request would be failed and retried",
  );
});

check("the ack sends the delivery time and workspace it was built with", () => {
  const src = read("desktop/src/main/poller.ts");
  assert(
    /\.\.\.\(body\.deliveredAt \? \{ deliveredAt: body\.deliveredAt \} : \{\}\),/.test(src),
    "deliveredAt is dropped",
  );
  assert(
    /\.\.\.\(body\.workspaceId \? \{ workspaceId: body\.workspaceId \} : \{\}\),/.test(src),
    "workspaceId is dropped",
  );
  const route = read("src/app/api/control/commands/[id]/route.ts");
  assert(
    /body\.deliveredAt/.test(route) && /body\.workspaceId/.test(route),
    "server stopped reading them",
  );
});

if (failures) {
  console.log(`\nprompt-in-transcript: ${failures} failed`);
  process.exit(1);
}
console.log("\nprompt-in-transcript: all passed");
