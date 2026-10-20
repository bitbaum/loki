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
  // Chat | Terminal: named for what you SEE, the same for every agent —
  // the agent is named once, under the session's name. "Claude | Terminal"
  // under a page called "Terminal" read as two kinds of word (2026-10-19).
  for (const agentLabel of ["Claude", "Codex", undefined]) {
    for (const view of ["chat", "terminal"] as const) {
      const html = renderToStaticMarkup(
        createElement(TerminalViewSwitch, { view, onViewChange: noop, agentLabel }),
      );
      ok(
        html.includes(">Chat</button>") && html.includes(">Terminal</button>"),
        "names both views for what they show",
      );
      ok(!html.includes(">Loki<") && !html.includes(">Claude<"), "never named after an agent");
      const pressed = html.split("<button").find((b) => b.includes('aria-pressed="true"')) ?? "";
      ok(pressed.includes(view === "chat" ? ">Chat<" : ">Terminal<"), `marks ${view} as current`);
    }
  }

  // Every tap changes the screen: tapping the view you are in flips to the
  // other, so "Terminal" toggles the terminal pane instead of doing nothing.
  const tap = (view: "chat" | "terminal", label: string) => {
    let picked: string | null = null;
    const root = TerminalViewSwitch({ view, onViewChange: (v) => (picked = v) });
    const buttons = root.props.children as {
      props: { children: unknown[]; onClick: () => void };
    }[];
    buttons.find((b) => b.props.children.includes(label))!.props.onClick();
    return picked;
  };
  ok(tap("chat", "Terminal") === "terminal", "Terminal from chat opens the terminal");
  ok(tap("terminal", "Terminal") === "chat", "Terminal again toggles back to chat");
  ok(tap("terminal", "Chat") === "chat", "Chat from the terminal opens chat");
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
    /<TerminalMoreSheet[\s\S]*?onExplain=\{/.test(surface),
    "the Loki panel is reachable from the header's ⋮",
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
  ok(
    surface.includes("suggestions={keysOpen ? [] : screenNext.steps.slice(0, 2)}"),
    "keys open: the next-step row steps aside so the terminal keeps its lines",
  );
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
