// Phone chrome that must stay calm (operator, 2026-10-05: "it looks
// Frankenstein … too much cognitive load"). Each case is one thing that used
// to stack, repeat, or dead-end on a phone.
// Run: npx tsx scripts/test/phone-chrome.ts
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function ok(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

{
  // A builder that never sends the conversation is shown as the terminal —
  // not as a screen explaining Fleet Runner versions.
  const chat = read("src/components/terminal/ClaudeChatView.tsx");
  const surface = read("src/components/terminal/TerminalSurface.tsx");
  ok(!/Fleet Runner 0\.8\.38/.test(chat), "no runner-version dead end in the conversation view");
  ok(chat.includes("onUnavailable"), "the conversation view reports when it cannot load");
  ok(surface.includes("onUnavailable={"), "the terminal surface falls back to the terminal");
  ok(!/attach=\{false\}/.test(chat), "the conversation view can attach a screenshot");
}
{
  // The empty terminal names a way forward and offers it as a button.
  const surface = read("src/components/terminal/TerminalSurface.tsx");
  const actions = read("src/components/terminal/TerminalOfflineActions.tsx");
  ok(surface.includes("<TerminalOfflineActions"), "offline/gated empty state offers actions");
  ok(surface.includes('setSource("machine")'), "offline/gated empty state can switch builders");
  ok(actions.includes('href="/download"'), "offline/gated empty state links Fleet Runner");
}
{
  // One floating thing at a time on a phone: the bottom nav hides Loki's own
  // feedback launcher, and reporting moves into the account menu.
  const nav = read("src/components/shell/MobileNav.tsx");
  const menu = read("src/components/shell/AccountMenu.tsx");
  ok(/ui-mobile-nav"[^>]*data-fc-place="hidden"/.test(nav), "phone nav hides the widget launcher");
  ok(
    menu.includes("Report a problem") && menu.includes(".report()"),
    "menu offers Report a problem",
  );
}
{
  // The dock is one bar with one panel open in BOTH phone layouts — never the
  // old stack of key rows + chips + composer.
  const dock = read("src/components/terminal/TerminalMobileDock.tsx");
  ok(!dock.includes("if (!immersive)"), "no separate stacked layout for the normal page");
  ok(
    dock.includes('immersive ? "none" : "write"'),
    "normal opens on Write, full screen on nothing",
  );
  ok(dock.includes("ui-term-watchbar"), "the single bar is rendered");
}

console.log(`${fail ? "✗" : "✓"} phone-chrome: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
