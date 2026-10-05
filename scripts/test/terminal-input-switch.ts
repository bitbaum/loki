// The terminal screen must offer screenshots, talking and chat without a menu.
// It opened in Type (raw keystrokes: no attach, no mic), the switch to Prompt —
// where THE composer attaches screenshots and dictates — lived only inside the
// phone's session sheet, and Chat was an unlabeled icon. Operator ask,
// 2026-10-03: "make it possible on this screen to attach screenshots and talk
// and make a switch to a chat view easier".
//
// 2026-10-05: the switch ended in a "Loki" chip that opened the same panel as
// the header's Loki button, while the operator expected it to show the session
// as a conversation. Chat is now the switch's first position; the panel keeps
// its one header button.
// Run: npx tsx scripts/test/terminal-input-switch.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { TerminalInputSwitch } from "@/components/terminal/TerminalInputSwitch";
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

{
  const html = render({
    inputMode: "type",
    onInputModeChange: noop,
    chat: { active: false, onSelect: noop },
  });
  for (const mode of TERMINAL_INPUT_MODES)
    ok(html.includes(`>${mode.label}</button>`), `offers ${mode.label}`);
  ok(html.includes(">Chat</button>"), "offers the conversation view");
  ok(html.indexOf(">Chat</button>") < html.indexOf(">Type</button>"), "Chat comes first");
  ok(!html.includes(">Loki</button>"), "no second Loki button beside the header's");
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
}
{
  const html = render({ inputMode: "prompt", onInputModeChange: noop });
  ok(!html.includes(">Chat</button>"), "no Chat for an agent with no conversation view");
}
{
  const html = render({
    inputMode: "prompt",
    onInputModeChange: noop,
    chat: { active: true, onSelect: noop },
  });
  ok(
    (html.match(/aria-pressed="true"/g) ?? []).length === 1 &&
      /aria-pressed="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)*Chat</.test(html),
    "while the chat shows, only Chat is pressed",
  );
}
{
  // Wired where the operator writes: the phone dock and the desktop session bar.
  const read = (f: string) =>
    readFileSync(join(process.cwd(), "src/components/terminal", f), "utf8");
  ok(
    read("TerminalMobileDock.tsx").includes("<TerminalInputSwitch"),
    "phone dock shows the switch",
  );
  ok(
    read("TerminalModeBar.tsx").includes("<TerminalInputSwitch"),
    "desktop session bar shows the switch",
  );
  ok(
    read("ClaudeChatView.tsx").includes("{modeSwitch}"),
    "the chat view carries the switch back to the terminal",
  );
  ok(
    read("TerminalSurface.tsx").includes("onShowChat={chatAvailable ? termView.showChat"),
    "the dock's Chat chip shows the conversation",
  );
}

console.log(`${fail ? "✗" : "✓"} terminal-input-switch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
