/**
 * What the terminal needs TYPED, read off its screen (lib/terminal-commands).
 * The report (2026-10-12): a person looking at the terminal "doesn't know what
 * to do" — signed out, or wanting Opus instead of the current model — and
 * nothing on the page told them the answer was a command.
 */
import { commandsFor } from "@/config/agent-commands";
import { commandIn, commandGuide, runAction, screenActions } from "@/lib/terminal-commands";
import { typeCommand } from "@/lib/session-keystrokes";
import { summaryPrompt, terminalContextAttachment } from "@/lib/terminal-summary";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const signedOut = screenActions(
  ["╭────────────╮", "│ > fix the header", "Invalid API key · Please run /login"],
  "claude",
);
check("signed out → /login, first", signedOut[0]?.display === "/login");
check("typed with Enter", signedOut[0]?.bytes === "/login\r");
check("a command is TYPED: the words, then Enter on its own", signedOut[0]?.typed === "/login");
check("says why in plain words", /signed out/i.test(signedOut[0]?.why ?? ""));

check(
  "an agent with no sign-in command gets none invented",
  screenActions(["Invalid API key · Please run /login"], "cursor").length === 0,
);
check(
  "gemini signs in with its own command",
  screenActions(["Please sign in: not logged in"], "gemini")[0]?.display === "/auth",
);

const quota = screenActions(["Claude usage limit reached. Your limit will reset at 5pm"], "claude");
check("out of quota → choose another model", quota[0]?.display === "/model");

const lowContext = screenActions(["Context left until auto-compact: 6%"], "claude");
check("memory nearly full → /compact", lowContext[0]?.display === "/compact");
check(
  "plenty of memory left → nothing",
  screenActions(["Context left until auto-compact: 42%"], "claude").length === 0,
);

const menu = screenActions(
  [" Select model", "   1. Default (recommended)", " ❯ 2. Opus", "   3. Haiku"],
  "claude",
);
check("an open menu → Enter first", menu[0]?.bytes === "\r");
check("names the highlighted choice", menu[0]?.why.includes("2. Opus") === true);
check(
  "and a way out",
  menu.some((a) => a.bytes === "\x1b"),
);
check(
  "a menu is answered before anything else on screen",
  screenActions(["Invalid API key · Please run /login", "❯ 1. Yes", "  2. No"], "claude")[0]
    ?.bytes === "\r",
);

check(
  "a working screen needs nothing typed",
  screenActions(["✻ Building the header…", "Read 3 files"], "claude").length === 0,
);

// A summary or answer's step: commands are typed, prose stays a task.
check("bare command", commandIn("/model opus", "claude") === "/model opus");
check("in backticks", commandIn("`/login`", "claude") === "/login");
check("with a verb in front", commandIn("Type /compact.", "claude") === "/compact");
check(
  "a path is a task, not a command",
  commandIn("/api/users returns 500 — fix it", "claude") === null,
);
check("an unknown command is not typed", commandIn("/deploy now", "claude") === null);
check("no commands known → never a command", commandIn("/model", "cursor") === null);

const guide = commandGuide("claude") ?? "";
check(
  "the guide lists every command",
  commandsFor("claude").every((c) => guide.includes(c.text)),
);
check("the summary knows the commands", summaryPrompt("skif", "claude").includes("/model opus"));
check(
  "an unknown agent's summary has no command rule",
  !summaryPrompt("skif", null).includes("/login"),
);
const ctx = terminalContextAttachment("claude", "Invalid API key · Please run /login");
check(
  "an Ask carries the agent, commands and screen",
  ctx.content.includes("claude") &&
    ctx.content.includes("/login —") &&
    ctx.content.includes("Invalid API key"),
);

// A command and its Enter are two writes with a beat between: in one write
// Claude Code reads them as a paste, the CR becomes a newline, and the next
// message is typed after the half-typed command ("/model opusWhy is the
// name of the repo…" → "Model 'opusWhy…' not found", owner, 2026-10-19).
const typed = (async () => {
  const writes: { bytes: string; at: number }[] = [];
  const record = (bytes: string) => {
    writes.push({ bytes, at: Date.now() });
  };
  await typeCommand(record, "/model opus\r");
  check(
    "the words first, Enter second, as separate writes",
    writes.map((w) => w.bytes).join("|") === "/model opus|\r",
  );
  check("with a beat between them", writes[1]!.at - writes[0]!.at >= 100);
  writes.length = 0;
  await runAction(record, signedOut[0]!);
  check("a screen action that is a command is typed the same way", writes.length === 2);
  await runAction(record, { id: "k", label: "Enter", display: "⏎", bytes: "\r", why: "" });
  check("a key is still its bytes, at once", writes.at(-1)!.bytes === "\r" && writes.length === 3);
  writes.length = 0;
  // Two commands at once (Sonnet, then High, tapped within the beat) go one
  // after the other, each with its own Enter — never "/model sonnet/effort high".
  await Promise.all([typeCommand(record, "/model sonnet"), typeCommand(record, "/effort high")]);
  check(
    "two quick commands never interleave",
    writes.map((w) => w.bytes).join("|") === "/model sonnet|\r|/effort high|\r",
  );
})();

// The runner loads this file without top-level await: finish on the promise.
typed.then(
  () => console.log(`\n${passed} passed`),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
