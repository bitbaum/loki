// A viewer's terminal-query answers never become agent input, and a prompt
// counts as accepted only on evidence the agent took it (Substrata on
// Antigravity, 2026-10-21: `1;2c1;2c…` in Gemini's composer, "Working" 14 min).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripReportResidue, stripTerminalReports } from "../../src/lib/terminal-reports";
import { promptAcceptedEvidence } from "../../src/lib/prompt-evidence";
import { decideAutoReimplement } from "../../src/lib/feedback/auto-reimplement-policy";
import { runBranchName, startRunBranch } from "../../src/lib/agent-execution/box-workspace";

// 1. Reports are dropped; keys survive.
assert.equal(stripTerminalReports("\x1b[?1;2c"), "", "DA1 answer (xterm.js reply to ESC[c)");
assert.equal(stripTerminalReports("\x1b[?1;2c".repeat(40)), "", "every replaying viewer's answer");
assert.equal(stripTerminalReports("\x1b[>0;276;0c"), "", "DA2");
assert.equal(stripTerminalReports("\x1b[12;40R"), "", "cursor position report");
assert.equal(stripTerminalReports("\x1b[0n"), "", "DSR ok");
assert.equal(stripTerminalReports("\x1b[?1u"), "", "kitty keyboard flags");
assert.equal(stripTerminalReports("\x1b]11;rgb:1e1e/1e1e/1e1e\x07"), "", "OSC 11 colour");
assert.equal(stripTerminalReports("\x1bP>|xterm.js(5.5.0)\x1b\\"), "", "XTVERSION");
assert.equal(stripTerminalReports("ls\r"), "ls\r");
assert.equal(
  stripTerminalReports("\x1b[A\x1b[B\x1b[C\x1b[D"),
  "\x1b[A\x1b[B\x1b[C\x1b[D",
  "arrows",
);
assert.equal(stripTerminalReports("\x03"), "\x03", "Ctrl-C");
assert.equal(
  stripTerminalReports("\x1b[200~hi\x1b[201~"),
  "\x1b[200~hi\x1b[201~",
  "bracketed paste",
);
assert.equal(stripTerminalReports("a\x1b[?1;2cb"), "ab", "answer between keys");

// 2. Exactly what xterm.js answers to ESC[c / ESC[>c (its DA1/DA2 replies).
assert.equal(stripTerminalReports("\x1b[?1;2c\x1b[>0;276;0c"), "");

// 3. Evidence that the prompt was accepted.
const prompt = "Fix /chat: I can't scroll the response. And keyboard covers things";
const daJunk = "\x1b[2K\r> " + "1;2c".repeat(200);
assert.equal(promptAcceptedEvidence(daJunk, "gemini", prompt), false, "DA residue is not work");
assert.equal(
  promptAcceptedEvidence(daJunk, "grok", prompt),
  false,
  "DA residue is not work (generic)",
);
assert.equal(
  promptAcceptedEvidence(`\x1b[2K> ${prompt}\r\n`, "gemini", prompt),
  false,
  "our own paste echoed back is not work",
);
assert.equal(promptAcceptedEvidence(`> ${prompt}\r\n`, "grok", prompt), false, "echo (generic)");
assert.equal(
  promptAcceptedEvidence("⠋ Reading src/app/chat/page.tsx (esc to cancel, 2s)", "gemini", prompt),
  true,
  "Gemini's working line",
);
assert.equal(
  promptAcceptedEvidence(
    "I'll start by looking at the chat page layout and its scroll container.",
    "grok",
    prompt,
  ),
  true,
);
// Gemini CLI 0.65.0 (sealed builder, 2026-10-21): no "esc to cancel" anywhere.
assert.equal(
  promptAcceptedEvidence(
    "\x1b[2K │ ✓ Shell sleep 8\r\n │ ✓ ReadFolder . → Found 1 item(s).",
    "gemini",
    prompt,
  ),
  true,
  "Gemini 0.65 tool lines",
);
assert.equal(promptAcceptedEvidence("\r\n✦ PONG\r\n", "gemini", prompt), true, "Gemini 0.65 reply");
assert.equal(
  promptAcceptedEvidence("\x1b[2K\r> " + "1;2c".repeat(50) + `> ${prompt}`, "gemini", prompt),
  false,
  "0.65 markers do not fire on residue or echo",
);
assert.equal(stripReportResidue("1;2c1;2c?62;22cok"), "ok");

// 4. A prompt that was never accepted fails over to the next provider.
const nack =
  "launched gemini (pty) + injected, but Loki could not verify generation. Antigravity never accepted the prompt: …";
const d = decideAutoReimplement(nack, null);
assert.equal(d.retry && d.failover, true, JSON.stringify(d));
assert.equal(
  decideAutoReimplement(nack, { feedbackAutoRetriedAt: "x" }).retry,
  false,
  "one hop per run",
);

// 5. A run starts on a fresh branch off origin's default, not the leftover one.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-branch-"));
  const g = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a])
      .toString()
      .trim();
  const origin = path.join(tmp, "origin");
  fs.mkdirSync(origin);
  g(origin, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(origin, "a"), "1");
  g(origin, "add", "a");
  g(origin, "commit", "-qm", "init");
  const box = path.join(tmp, "box");
  execFileSync("git", ["clone", "-q", `file://${origin}`, box]);
  g(box, "checkout", "-qb", "fix/atlas-title-hierarchy");
  fs.writeFileSync(path.join(box, "a"), "unrelated");
  g(box, "commit", "-qam", "unrelated");
  fs.writeFileSync(path.join(box, "dirty"), "x");
  const branch = startRunBranch(box, "ef05ca9f-8749-422c-bdf6-df1734808a0e", null);
  assert.equal(branch, runBranchName("ef05ca9f-8749"));
  assert.equal(branch, "loki/run-ef05ca9f");
  assert.equal(g(box, "rev-parse", "--abbrev-ref", "HEAD"), "loki/run-ef05ca9f");
  assert.equal(g(box, "rev-parse", "HEAD"), g(origin, "rev-parse", "HEAD"), "based on origin/main");
  assert.equal(fs.readFileSync(path.join(box, "a"), "utf8"), "1");
  assert.match(
    g(box, "stash", "list"),
    /left on fix\/atlas-title-hierarchy/,
    "leftovers stashed, not lost",
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("prompt-delivery: all checks passed");
