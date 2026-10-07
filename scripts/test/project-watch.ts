/**
 * "Watch it work" (lib/project-watch): a run told as a conversation.
 *
 * Asked for 2026-09-28 — "watch how things get implemented, like a chat".
 * What has to stay true for that to read like a chat rather than a log:
 *
 *   - you first, then the hops, then the agent's own summary;
 *   - a hundred heartbeats are one "working" line, stamped with the latest;
 *   - a blocked hop says what it needs, in the warning tone;
 *   - the handoff is the agent's message, never also a "Run closed" line;
 *   - the screen tail is words, not escape codes or box borders.
 *
 * Run: npx tsx scripts/test/project-watch.ts
 */
import {
  buildWatchTimeline,
  humanizeRunFailure,
  latestActivityLine,
  tailForWatch,
} from "@/lib/project-watch";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const t = (m: number) => new Date(Date.UTC(2026, 8, 28, 12, m));
const ev = (
  kind: Parameters<typeof buildWatchTimeline>[0]["events"][number]["kind"],
  m: number,
  detail: Record<string, unknown> | null = null,
) => ({
  kind,
  detail,
  createdAt: t(m),
});

check("you, then the hops, then the agent", () => {
  const items = buildWatchTimeline({
    prompt: { text: "Start building Zurich Sublet…", at: t(0) },
    events: [
      ev("dispatched", 0),
      ev("claimed", 1),
      ev("submitted", 2),
      ev("handoff", 30),
      ev("closed", 30),
    ],
    run: {
      outcome: "success",
      finishedAt: t(30),
      summary: { done: "Scaffolded the landing page", next: "Lease checker", commit: "abc123" },
    },
  });
  assert(items[0]!.type === "you", "you are not first");
  assert(items.at(-1)!.type === "agent", "the agent does not close the thread");
  const agent = items.at(-1) as Extract<(typeof items)[number], { type: "agent" }>;
  assert(
    agent.done === "Scaffolded the landing page" && agent.next === "Lease checker",
    "summary lost",
  );
  assert(
    !items.some((i) => i.type === "step" && i.kind === "closed"),
    "closed repeated the handoff",
  );
  assert(!items.some((i) => i.type === "step" && i.kind === "handoff"), "handoff shown as a step");
});

check("heartbeats collapse into one working line with the latest time", () => {
  const items = buildWatchTimeline({
    prompt: null,
    events: [ev("generating", 3), ev("progress", 4), ev("progress", 5), ev("progress", 9)],
    run: null,
  });
  const steps = items.filter((i) => i.type === "step");
  assert(steps.length === 1, `expected one line, got ${steps.length}`);
  assert(steps[0]!.at === t(9).toISOString(), "not stamped with the latest heartbeat");
});

check("blocked says what it needs, in the warning tone", () => {
  const items = buildWatchTimeline({
    prompt: null,
    events: [ev("blocked", 4, { reason: "approve the npm install" })],
    run: null,
  });
  const step = items[0] as Extract<(typeof items)[number], { type: "step" }>;
  assert(step.tone === "warning", "blocked is not a warning");
  assert(/approve the npm install/.test(step.text), `reason lost: ${step.text}`);
});

check("a failure is not dressed up as the agent speaking", () => {
  const items = buildWatchTimeline({
    prompt: null,
    events: [ev("closed", 10, { outcome: "error" })],
    run: { outcome: "error", finishedAt: t(10), summary: null, error: "Agent exited: quota" },
  });
  assert(!items.some((i) => i.type === "agent"), "the runner's error became an agent message");
});

check("failures read as one plain sentence naming the provider", () => {
  const raw =
    "Dispatch failed before the prompt reached the agent: claude cannot generate because its usage limit is exhausted. Switch this project to a provider with available capacity, then Retry.";
  assert(
    humanizeRunFailure(raw, "Claude Code", true) === "Claude Code has run out of usage for now.",
    "quota wall not said plainly",
  );
  assert(
    humanizeRunFailure(
      "Dispatch failed before the prompt reached the agent: workspace missing. Do X.",
      "Codex",
      false,
    ) === "Workspace missing.",
    "prefix or tail not trimmed",
  );
  assert(
    humanizeRunFailure(null, "Codex", false) === "Codex stopped before it finished.",
    "empty error",
  );
});

check("placeholder summaries are dropped, not printed", () => {
  const items = buildWatchTimeline({
    prompt: null,
    events: [],
    run: {
      outcome: "success",
      finishedAt: t(5),
      summary: { done: "Built it", next: "none", commit: "-" },
    },
  });
  const agent = items.at(-1) as Extract<(typeof items)[number], { type: "agent" }>;
  assert(agent.next === null && agent.commit === null, "printed a placeholder");
});

check("the screen tail is words: no escapes, no borders, no blank lines", () => {
  const screen =
    "\x1b[2J\x1b[H╭────────╮\n│ \x1b[1mWriting\x1b[0m src/app/page.tsx │\n\n╰────────╯\n\x1b]0;title\x07✓ tests passed\n";
  const tail = tailForWatch(screen);
  assert(tail.length === 2, `expected 2 lines, got ${JSON.stringify(tail)}`);
  assert(tail[0]!.includes("Writing src/app/page.tsx"), `lost the words: ${tail[0]}`);
  assert(!tail.join("").includes("\x1b"), "escape codes leaked");
  assert(
    tailForWatch(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"), 12).length === 12,
    "not capped",
  );
});

check("the live line is what the agent is doing, not the CLI around it", () => {
  const tail = tailForWatch(
    [
      "⏺ Update(src/app/page.tsx)",
      "  ⎿  Updated src/app/page.tsx with 12 additions",
      "✻ Writing the lease checker… (34s · ↑ 1.2k tokens · esc to interrupt)",
      "╭──────────────╮",
      "│ >            │",
      "╰──────────────╯",
      "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
    ].join("\n"),
  );
  assert(
    latestActivityLine(tail) === "Writing the lease checker…",
    `got ${latestActivityLine(tail)}`,
  );
  assert(latestActivityLine(["│ > │", "   ", "? for shortcuts"]) === null, "chrome became a line");
});

check("a redraw in place is the last frame, not every frame glued together", () => {
  // 2026-10-07, a phone: the screen read "Actioning…●✢4*✶75✻ ✻Actioning…5✻…"
  // because the spinner's CR / cursor-up / erase-line moves were deleted
  // instead of applied.
  const frames = ["✢", "✶", "✻", "●"]
    .map((g, i) => `\r\x1b[2K${g} Actioning… (${i + 1}s · esc to interrupt)`)
    .join("");
  const raw =
    "Running 1 shell command…\r\n  ⎿ $ cd /tmp && sed -n 71,72p i18n.js\r\n" +
    frames +
    "\r\n\x1b[1A\x1b[2K\x1b[G✶ Actioning… (3m 37s · ↓ 6.6k tokens)\r\n  ⎿ Tip: Use /btw to ask\r\n" +
    "──────────\r\n› \r\n──────────\r\n⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt\r\n";
  const tail = tailForWatch(raw);
  assert(
    tail.filter((l) => l.includes("Actioning")).length === 1,
    `frames piled up: ${JSON.stringify(tail)}`,
  );
  assert(
    tail.some((l) => l.includes("3m 37s")),
    "kept a stale frame, not the last one",
  );
  assert(
    latestActivityLine(tail) === "Running 1 shell command…",
    `the headline is the spinner or chrome: ${latestActivityLine(tail)}`,
  );
});

check("a tool call reads as a sentence", () => {
  assert(
    latestActivityLine(["⏺ Write(src/app/page.tsx)"]) === "Writing src/app/page.tsx",
    "raw call",
  );
  assert(
    latestActivityLine(["⏺ Read(i18n.js)", "  ⎿ Read 72 lines"]) === "Reading i18n.js",
    "picked the detail",
  );
});

console.log(`\n✓ project-watch: ${passed} passed`);
