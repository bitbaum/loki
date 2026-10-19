/**
 * Claude Code's mode, read off the footer of its screen — what the session
 * sheet marks and walks Shift+Tab towards (lib/claude-mode-footer.ts).
 *
 * Run: npx tsx scripts/test/claude-mode-footer.ts
 */
import assert from "node:assert/strict";
import { modeFromFooter } from "../../src/lib/claude-mode-footer";

const screen = (footer: string, below: string[] = []) => [
  "● Done. The site is renamed.",
  "",
  "╭──────────────────────────────╮",
  "│ >                            │",
  "╰──────────────────────────────╯",
  footer,
  ...below,
];

assert.equal(modeFromFooter(screen("  ⏵⏵ accept edits on (shift+tab to cycle)")), "acceptEdits");
assert.equal(modeFromFooter(screen("  ⏸ plan mode on (shift+tab to cycle)")), "plan");
assert.equal(modeFromFooter(screen("  ⏵⏵ auto mode on (shift+tab to cycle)")), "auto");
assert.equal(
  modeFromFooter(screen("  ⏵⏵ bypass permissions on (shift+tab to cycle)")),
  "bypassPermissions",
);
// What the owner's screen said after "Next mode" (2026-10-19).
assert.equal(modeFromFooter(screen("  ⏸ manual mode on · ? for shortcuts")), "default");
// Older versions name nothing in the asking mode.
assert.equal(modeFromFooter(screen("  ? for shortcuts")), "default");
// The newest footer wins over an older one still higher up the screen.
assert.equal(
  modeFromFooter([...screen("  ⏸ plan mode on"), "", "> ", "  ⏵⏵ accept edits on"]),
  "acceptEdits",
);
// The agent's own words about plan mode, far above the footer, are not it.
assert.equal(
  modeFromFooter(["I will turn plan mode on next.", ...Array(20).fill(""), "  ? for shortcuts"]),
  "default",
);
// No footer at all (a menu open, mid-redraw): unknown, not a guess.
assert.equal(modeFromFooter(["Select model", "  1. Opus", "  2. Sonnet"]), null);
console.log("✓ claude-mode-footer: the mode as the screen shows it");
