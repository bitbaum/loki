/**
 * "What's going on?" on a phone opens the ANSWER, not a second chat: Loki's
 * panel in sheet form has no box of its own, no model picker, no run-status
 * filler — the answer, its next steps, and one way to Loki chat. The rail
 * beside the session on a wide screen keeps all of that.
 *
 * The phone's sheet used to be the whole rail (owner, 2026-10-19: "too
 * many different screens… spaghetti UI"): "Nothing running on Xhiva Art.
 * Send a task below…" above an answer, above a composer with Loki's model
 * picker reading "Auto" — a hand's width from the session box reading
 * "Opus 5.5".
 *
 * Run: npx tsx scripts/test/terminal-loki-sheet.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalLokiRail } from "@/components/terminal/TerminalLokiRail";

const render = (presentation: "rail" | "sheet") =>
  renderToStaticMarkup(
    createElement(TerminalLokiRail, {
      presentation,
      project: "Xhiva Art",
      tab: "xhiva-art",
      runId: null,
      ptyState: "live",
      projectId: null,
      canSwitchAgent: false,
      onSwitchAgent: () => {},
      askOnly: true,
      agent: "claude",
      onKey: () => {},
    }),
  );

const sheet = render("sheet");
assert.ok(!sheet.includes("ck-composer"), "the sheet has no composer of its own");
assert.ok(!sheet.includes("ui-loki-model-trigger"), "and no model picker of Loki's");
assert.ok(!sheet.includes("Nothing running on"), "no run-status filler");
assert.ok(!sheet.includes("Checking this run"), "no run-status filler while loading");
assert.ok(sheet.includes("Continue in Loki chat"), "one way to Loki chat, at the foot");
assert.ok(sheet.includes("Loki on Xhiva Art"), "it says whose session it reads");
assert.ok(
  /aria-label="What&#x27;s going on\?"[^>]*>(?:(?!sr-only).)*What&#x27;s going on\?/s.test(sheet),
  "the question is a labelled button, visible at phone width",
);
assert.ok(!sheet.includes('aria-label="Open the full Loki chat"'), "no second link up top");

const rail = render("rail");
assert.ok(rail.includes("ck-composer"), "the rail beside the session keeps its Ask box");
assert.ok(rail.includes("Nothing running on"), "and says what the run is doing");
assert.ok(!rail.includes("Continue in Loki chat"), "with the chat link in its header instead");

// The surface renders the one panel in the split as the rail and in the
// phone's sheet as the sheet — one component, told which it is.
const surface = readFileSync("src/components/terminal/TerminalSurface.tsx", "utf8");
assert.match(surface, /<TerminalLokiSheet[^]*?renderLokiRail\("sheet"\)/, "the sheet is the sheet");
assert.match(surface, /ui-term-split-rail[^]*?renderLokiRail\("rail"\)/, "the split is the rail");

console.log("✓ terminal-loki-sheet: the phone's answer sheet has no second chat in it");
