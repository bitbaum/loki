// Claude Code's session log read as a conversation (src/lib/claude-transcript.ts).
// Run: npx tsx scripts/test/claude-transcript.ts
import {
  describeToolRun,
  groupTranscript,
  looksBlockedOnApproval,
  mergeTranscriptItems,
  newTranscriptState,
  reduceTranscriptLine,
  summariseToolInput,
  type TranscriptItem,
} from "@/lib/claude-transcript";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const L = (o: unknown) => JSON.stringify(o);
const s = newTranscriptState();
let items: TranscriptItem[] = [];
const feed = (raw: string) => {
  const out = reduceTranscriptLine(s, raw);
  items = mergeTranscriptItems(items, out);
  return out;
};

// A typed prompt (string content) becomes a user message.
feed(
  L({
    type: "user",
    uuid: "u1",
    timestamp: "t1",
    message: { role: "user", content: "Fix the header" },
  }),
);
ok(
  items.length === 1 && items[0].kind === "user" && items[0].text === "Fix the header",
  "user prompt",
);

// Assistant text + a tool call in one line → two items, tool running.
feed(
  L({
    type: "assistant",
    uuid: "a1",
    timestamp: "t2",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm" },
        { type: "text", text: "Looking at it." },
        { type: "tool_use", id: "tu1", name: "Bash", input: { command: "git   status\n--short" } },
      ],
    },
  }),
);
ok(items.length === 3, "thinking dropped, text + tool kept");
ok(items[1].kind === "assistant" && items[1].text === "Looking at it.", "assistant text");
const tool = items[2];
ok(
  tool.kind === "tool" && tool.status === "running" && tool.summary === "git status --short",
  "tool call summarised, whitespace folded",
);
ok(looksBlockedOnApproval(items), "a running last tool reads as maybe-waiting");

// Its result arrives on a later user line → the SAME item updates in place.
feed(
  L({
    type: "user",
    uuid: "u2",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu1",
          content: [{ type: "text", text: "M src/a.ts" }],
        },
      ],
    },
  }),
);
ok(items.length === 3, "result does not add a row");
const done = items[2];
ok(
  done.kind === "tool" && done.status === "done" && done.result === "M src/a.ts",
  "tool row updated with result",
);
ok(!looksBlockedOnApproval(items), "finished tool is not waiting");

// Errors are marked.
feed(
  L({
    type: "assistant",
    uuid: "a2",
    message: {
      content: [{ type: "tool_use", id: "tu2", name: "Edit", input: { file_path: "/x/y.ts" } }],
    },
  }),
);
feed(
  L({
    type: "user",
    uuid: "u3",
    message: {
      content: [{ type: "tool_result", tool_use_id: "tu2", is_error: true, content: "boom" }],
    },
  }),
);
const err = items.find((i) => i.id === "tu2");
ok(
  err?.kind === "tool" && err.status === "error" && err.summary === "/x/y.ts",
  "error result + path summary",
);

// Noise yields nothing: harness text, sidechains, meta, summaries, junk.
const before = items.length;
feed(L({ type: "user", uuid: "n1", message: { content: "<command-name>/clear</command-name>" } }));
feed(
  L({
    type: "assistant",
    uuid: "n2",
    isSidechain: true,
    message: { content: [{ type: "text", text: "sub" }] },
  }),
);
feed(L({ type: "user", uuid: "n3", isMeta: true, message: { content: "meta" } }));
feed(L({ type: "summary", summary: "x", leafUuid: "a1" }));
feed("{not json");
feed(
  L({
    type: "user",
    uuid: "n4",
    message: { content: [{ type: "tool_result", tool_use_id: "unknown", content: "x" }] },
  }),
);
ok(items.length === before, "noise and orphan results ignored");

// Results are previews, never whole files.
feed(
  L({
    type: "assistant",
    uuid: "a3",
    message: {
      content: [{ type: "tool_use", id: "tu3", name: "Read", input: { file_path: "/big" } }],
    },
  }),
);
feed(
  L({
    type: "user",
    uuid: "u4",
    message: {
      content: [{ type: "tool_result", tool_use_id: "tu3", content: "x".repeat(50_000) }],
    },
  }),
);
const big = items.find((i) => i.id === "tu3");
ok(big?.kind === "tool" && (big.result?.length ?? 0) <= 1200, "result clipped to a preview");

ok(summariseToolInput("Grep", { pattern: "foo" }) === "foo", "grep summary");
ok(
  summariseToolInput("Task", { description: "Map it", prompt: "long" }) === "Map it",
  "task summary prefers description",
);

// Grouping: consecutive tools fold into one block between messages.
const blocks = groupTranscript(items);
ok(blocks[0].type === "message" && blocks[1].type === "message", "user + assistant are messages");
ok(blocks[2].type === "tools" && blocks[2].items.length === 3, "tu1..tu3 fold into one run");
ok(
  describeToolRun([
    { id: "1", at: null, kind: "tool", name: "Bash", summary: "", status: "done", result: null },
    { id: "2", at: null, kind: "tool", name: "Bash", summary: "", status: "done", result: null },
    { id: "3", at: null, kind: "tool", name: "Edit", summary: "", status: "done", result: null },
  ]) === "Ran 2 commands, edited a file",
  "run described in words",
);

ok(
  describeToolRun([
    { id: "1", at: null, kind: "tool", name: "Bash", summary: "ls", status: "done", result: null },
    {
      id: "2",
      at: null,
      kind: "tool",
      name: "Bash",
      summary: "git push",
      status: "running",
      result: null,
    },
  ]) === "Running git push",
  "a live run says what is happening now",
);

console.log(`${pass}/${pass + fail} claude-transcript cases passed`);
if (fail > 0) process.exit(1);
