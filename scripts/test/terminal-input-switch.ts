// The terminal screen must offer screenshots, talking and the conversation
// view without a menu, and name each thing once.
//
// Operator asks: 2026-10-03 "make it possible on this screen to attach
// screenshots and talk and make a switch to a chat view easier"; 2026-10-05
// "Switch to Loki would show it as a loki session, which would be a view like
// the view of this chat" and "navigation should be easy and intuitive".
// Run: npx tsx scripts/test/terminal-input-switch.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { TerminalInputSwitch } from "@/components/terminal/TerminalInputSwitch";
import { TerminalViewSwitch } from "@/components/terminal/TerminalViewSwitch";
import { TERMINAL_INPUT_MODES } from "@/config/terminal-modes";

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
const render = (props: Parameters<typeof TerminalInputSwitch>[0]) =>
  renderToStaticMarkup(createElement(TerminalInputSwitch, props));
const read = (f: string) => readFileSync(join(process.cwd(), "src/components/terminal", f), "utf8");

{
  const html = renderToStaticMarkup(
    createElement(TerminalInputSwitch, { inputMode: "type", onInputModeChange: noop }),
  );
  for (const mode of TERMINAL_INPUT_MODES)
    ok(html.includes(`>${mode.label}</button>`), `offers ${mode.label}`);
  ok(/aria-pressed="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)*Type</.test(html), "marks the current mode");
  const prompt = html.split("<button").find((b) => b.includes(">Prompt</button>")) ?? "";
  ok(
    prompt.includes("lucide-paperclip") && prompt.includes("lucide-mic"),
    "Prompt shows attach and mic icons",
  );
  ok(
    /screenshot/i.test(TERMINAL_INPUT_MODES.find((m) => m.id === "prompt")!.hint),
    "Prompt's hint names screenshots",
  );
  ok(!html.includes("Loki"), "input modes only — Loki is a view, not an input mode");
}
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
  ok(read("TerminalMobileDock.tsx").includes("<TerminalInputSwitch"), "phone dock: input modes");
  ok(read("TerminalModeBar.tsx").includes("<TerminalInputSwitch"), "desktop bar: input modes");
  ok(read("TerminalMobileHeader.tsx").includes("<TerminalViewSwitch"), "phone header: views");
  ok(read("TerminalModeBar.tsx").includes("<TerminalViewSwitch"), "desktop bar: views");
  const surface = read("TerminalSurface.tsx");
  ok(
    (surface.match(/onViewChange=\{[^}]*termView\.setView/g) ?? []).length === 2,
    "both switches change the view",
  );
  ok(
    /<TerminalSessionSheet[\s\S]*?onOpenLoki=\{/.test(surface),
    "the Loki panel is reachable from the session sheet",
  );
  ok(!read("TerminalMobileHeader.tsx").includes("onOpenLoki"), "no second 'Loki' in the header");
  ok(
    read("TerminalPaneActions.tsx").includes("\n          Loki\n"),
    "the desktop panel button is the one thing called Loki",
  );
  ok(
    read("TerminalMobileHeader.tsx").includes("agentLabel={agent}") &&
      read("TerminalModeBar.tsx").includes("agentLabel={activeAgent?.label"),
    "both switches are named after the running agent",
  );
  // One Loki entry point on a phone: the header's. The dock's chip was the
  // same button a second time, one row below (2026-10-05).
  ok(
    !read("TerminalMobileDock.tsx").includes("onOpenLoki"),
    "the phone dock does not repeat the header's Loki button",
  );
}
{
  // The phone hides Voice (the composer's mic dictates) — but never strands
  // someone who is already in it.
  const hidden = render({ inputMode: "prompt", onInputModeChange: noop, hide: ["voice"] });
  ok(!hidden.includes(">Voice</button>"), "a hidden mode is not offered");
  const current = render({ inputMode: "voice", onInputModeChange: noop, hide: ["voice"] });
  ok(current.includes(">Voice</button>"), "the current mode is always shown");
}

console.log(`${fail ? "✗" : "✓"} terminal-input-switch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
