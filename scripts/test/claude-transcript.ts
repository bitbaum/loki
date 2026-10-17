// Claude Code's session log read as a conversation (src/lib/claude-transcript.ts).
// Run: npx tsx scripts/test/claude-transcript.ts
import {
  CYCLE_MODE_KEY,
  sessionMode,
  sessionModel,
  sessionEffort,
  modelLabel,
  describeToolStep,
  turnElapsedLabel,
  describeToolRun,
  groupTranscript,
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

// A single call names itself, the way the Claude app writes a step.
const lone = {
  id: "3",
  at: null,
  kind: "tool" as const,
  name: "Bash",
  summary: "cd /home/user/loki && git status",
  status: "done" as const,
  result: null,
};
ok(
  describeToolStep(lone).verb === "Ran" && describeToolStep(lone).target === lone.summary,
  "a finished command reads Ran + the command",
);
ok(
  describeToolStep({ ...lone, status: "running" }).verb === "Running",
  "a running command reads Running",
);
ok(
  describeToolStep({ ...lone, name: "Mystery" }).verb === "Mystery",
  "an unknown tool keeps its name",
);

// The turn clock.
const t0 = "2026-10-05T13:00:00.000Z";
ok(turnElapsedLabel(t0, Date.parse(t0) + 13_000) === "13 s", "13 s");
ok(turnElapsedLabel(t0, Date.parse(t0) + 125_000) === "2 min 5 s", "2 min 5 s");
ok(turnElapsedLabel(t0, Date.parse(t0) + 120_000) === "2 min", "2 min");
ok(
  turnElapsedLabel(null, 0) === null && turnElapsedLabel("nope", 0) === null,
  "no start, no clock",
);

// The permission mode rides on what you send (operator, 2026-10-05: the
// Claude app's Auto / Accept edits / Plan, in Loki's conversation view).
{
  const st = newTranscriptState();
  const sent = (uuid: string, mode: string | undefined, text: string) =>
    reduceTranscriptLine(
      st,
      JSON.stringify({
        type: "user",
        uuid,
        timestamp: "2026-10-05T13:00:00Z",
        ...(mode ? { permissionMode: mode } : {}),
        message: { role: "user", content: text },
      }),
    );
  const first = sent("u1", "acceptEdits", "fix it");
  ok(first[0]?.kind === "user" && first[0].mode === "acceptEdits", "a message carries its mode");
  const listItems = [...first, ...sent("u2", "plan", [{ type: "text", text: "plan it" }] as never)];
  ok(sessionMode(listItems)?.label === "Plan only", "the newest message's mode wins");
  ok(sessionMode(sent("u3", "auto", "go"))?.label === "Auto", "auto reads Auto");
  ok(sessionMode(sent("u4", "default", "go"))?.label === "Ask first", "default is named");
  ok(
    sessionMode(sent("u5", "someNewMode", "go"))?.label === "someNewMode",
    "an unknown mode keeps its name",
  );
  ok(sessionMode(sent("u6", undefined, "go")) === null, "an older log says nothing");
  const asst = reduceTranscriptLine(
    st,
    JSON.stringify({
      type: "assistant",
      uuid: "a1",
      permissionMode: "plan",
      message: { role: "assistant", content: "hi" },
    }),
  );
  ok(asst[0] && !("mode" in asst[0]), "only your messages carry a mode");
  ok(CYCLE_MODE_KEY === "\x1b[Z", "the switch key is Shift+Tab");
}

{
  // Which model answered is read off the log, and named in words
  // (2026-10-15: "I have no idea what model is being used").
  const st = newTranscriptState();
  const answer = (uuid: string, model: string) =>
    reduceTranscriptLine(
      st,
      JSON.stringify({
        type: "assistant",
        uuid,
        message: { role: "assistant", model, content: "done" },
      }),
    );
  const items = [...answer("m1", "claude-sonnet-4-5-20250929"), ...answer("m2", "claude-opus-5-5")];
  ok(sessionModel(items) === "claude-opus-5-5", "the newest answer's model wins");
  ok(
    !("model" in (answer("m3", "<synthetic>")[0] ?? {})),
    "Claude Code's own synthetic lines name no model",
  );
  ok(modelLabel("claude-opus-5-5") === "Opus 5.5", "an id reads as a name");
  ok(modelLabel("claude-sonnet-4-5-20250929") === "Sonnet 4.5", "a dated id drops the date");
  ok(modelLabel("claude-3-5-haiku-20241022") === "Haiku 3.5", "the old id order still reads");
  ok(modelLabel("gpt-5") === "gpt-5", "an unknown id is shown as given, not guessed");
}

{
  // How hard it thinks is on the same answer line (Claude Code 2.1+: `effort`).
  const st = newTranscriptState();
  const answer = (uuid: string, extra: Record<string, unknown>, model = "claude-opus-5-5") =>
    reduceTranscriptLine(
      st,
      JSON.stringify({
        type: "assistant",
        uuid,
        ...extra,
        message: { role: "assistant", model, content: "done" },
      }),
    );
  const items = [...answer("e1", { effort: "medium" }), ...answer("e2", { effort: "high" })];
  ok(sessionEffort(items)?.id === "high", "the newest answer's effort wins");
  ok(sessionEffort(items)?.label === "High effort", "an effort reads in words");
  ok(sessionEffort(answer("e3", { effort: "xhigh" }))?.label === "Extra-high effort", "xhigh");
  ok(
    sessionEffort(answer("e4", { effort: "turbo" }))?.label === "turbo",
    "an unknown level keeps its name",
  );
  ok(sessionEffort(answer("e5", {})) === null, "an older log says nothing about effort");
  ok(
    !("effort" in (answer("e6", { effort: "high" }, "<synthetic>")[0] ?? {})),
    "a synthetic line carries no effort",
  );
  ok(
    !("effort" in (answer("e7", { effort: "<script>" })[0] ?? {})),
    "only a plain word is taken as an effort",
  );
}

console.log(`${pass}/${pass + fail} claude-transcript cases passed`);
if (fail > 0) process.exit(1);
