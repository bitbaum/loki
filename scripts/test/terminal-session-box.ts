// The terminal screen offers ONE box for the agent — microphone, screenshots
// and the prompt library in it — in both views and at every width, and names
// each thing once.
//
// Operator asks: 2026-10-03 "make it possible on this screen to attach
// screenshots and talk and make a switch to a chat view easier"; 2026-10-05
// "navigation should be easy and intuitive"; 2026-10-15 "Type … has no way to
// speak … isn't prompt supposed to be the same thing as type?"
// Run: npx tsx scripts/test/terminal-session-box.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { TerminalViewSwitch } from "@/components/terminal/TerminalViewSwitch";

let pass = 0;
let fail = 0;
function ok(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}
const noop = () => {};
const read = (f: string) => readFileSync(join(process.cwd(), "src/components/terminal", f), "utf8");

{
  // Claude | Terminal: the conversation is named after the AGENT in the
  // session, never "Loki" — that is the supervisor, on its own model.
  for (const view of ["chat", "terminal"] as const) {
    const html = renderToStaticMarkup(
      createElement(TerminalViewSwitch, { view, onViewChange: noop, agentLabel: "Claude" }),
    );
    ok(
      html.includes(">Claude</button>") && html.includes(">Terminal</button>"),
      "names both views",
    );
    ok(!html.includes("Loki"), "the agent's conversation is not called Loki");
    const pressed = html.split("<button").find((b) => b.includes('aria-pressed="true"')) ?? "";
    ok(pressed.includes(view === "chat" ? ">Claude<" : ">Terminal<"), `marks ${view} as current`);
  }
  const codex = renderToStaticMarkup(
    createElement(TerminalViewSwitch, { view: "chat", onViewChange: noop, agentLabel: "Codex" }),
  );
  ok(codex.includes(">Codex</button>"), "follows the agent that is actually running");
  const unnamed = renderToStaticMarkup(
    createElement(TerminalViewSwitch, { view: "chat", onViewChange: noop }),
  );
  ok(unnamed.includes(">Chat</button>"), "an unnamed agent reads as Chat, not Loki");
}
{
  // Wired where you look, at every width, and in both views.
  const surface = read("TerminalSurface.tsx");
  ok(read("TerminalMobileHeader.tsx").includes("<TerminalViewSwitch"), "phone header: views");
  ok(read("TerminalModeBar.tsx").includes("<TerminalViewSwitch"), "desktop bar: views");
  ok(
    (surface.match(/onViewChange=\{[^}]*termView\.setView/g) ?? []).length === 2,
    "both switches change the view",
  );
  ok(
    /<TerminalSessionSheet[\s\S]*?onOpenLoki=\{/.test(surface),
    "the Loki panel is reachable from the session sheet",
  );
  ok(
    read("TerminalPaneActions.tsx").includes("\n          Loki\n"),
    "the desktop panel button is the one thing called Loki",
  );
  ok(
    read("TerminalMobileHeader.tsx").includes("agentLabel={agent}") &&
      read("TerminalModeBar.tsx").includes("agentLabel={activeAgent?.label"),
    "both switches are named after the running agent",
  );
  ok(!read("TerminalMobileDock.tsx").includes("onOpenLoki"), "the dock has no second Loki button");
}
{
  // ONE box: the terminal view and the conversation view render the same
  // SessionComposer, and nothing makes a person pick Type, Prompt or Voice.
  const surface = read("TerminalSurface.tsx");
  const chat = read("ClaudeChatView.tsx");
  ok(surface.includes("<SessionComposer"), "the terminal view writes through the session box");
  ok(chat.includes("<SessionComposer"), "the conversation view writes through the same box");
  ok(!/<Composer\b/.test(chat), "the conversation view has no message box of its own");
  for (const f of [
    "TerminalSurface.tsx",
    "TerminalMobileDock.tsx",
    "TerminalModeBar.tsx",
    "TerminalSessionSheet.tsx",
  ])
    ok(!/inputMode|TerminalInputSwitch|TabVoiceMic/.test(read(f)), `${f}: no input-mode switch`);
  ok(!surface.includes("<TerminalComposer"), "no second box for the agent under the terminal");
  ok(/askOnly\b/.test(surface), "Loki's panel only asks; words for the agent go in the box");
  const box = read("SessionComposer.tsx");
  ok(!/voice=\{false\}|attach=\{false\}/.test(box), "the box keeps its microphone and attachments");
  ok(box.includes("onEmptySlash"), "/ opens the prompt library and the agent's commands");
  ok(box.includes("typeMessage(onKey"), "a live session is typed into, as in the terminal");
  ok(box.includes("/api/control/tab-inject"), "with nothing running, the words go as a task");
  ok(
    read("SuggestionChips.tsx").includes("What&apos;s going on?"),
    "Loki's question is the first chip",
  );
}

console.log(`${fail ? "✗" : "✓"} terminal-session-box: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
