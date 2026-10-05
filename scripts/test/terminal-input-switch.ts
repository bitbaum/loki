// The terminal screen must offer screenshots, talking and chat without a menu.
// It opened in Type (raw keystrokes: no attach, no mic), the switch to Prompt —
// where THE composer attaches screenshots and dictates — lived only inside the
// phone's session sheet, and Chat was an unlabeled icon. Operator ask,
// 2026-10-03: "make it possible on this screen to attach screenshots and talk
// and make a switch to a chat view easier".
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
  const html = render({ inputMode: "type", onInputModeChange: noop, onOpenLoki: noop });
  for (const mode of TERMINAL_INPUT_MODES)
    ok(html.includes(`>${mode.label}</button>`), `offers ${mode.label}`);
  ok(html.includes(">Loki</button>"), "offers the Loki panel when there is a project");
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
  ok(!html.includes(">Loki</button>"), "no Loki panel without a project");
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
    read("TerminalSurface.tsx").includes("onOpenLoki={projectKey ?"),
    "the header's Loki button opens the Loki sheet",
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
