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
  // The switch moved into the actions component (2026-10-12), which also
  // decides whether a download is honest for this account — it is, only
  // while the cloud builder is private; an account with the cloud is offered
  // the cloud first.
  ok(surface.includes("onSwitch={setSource}"), "offline/gated empty state can switch builders");
  ok(
    actions.includes('onSwitch("machine")') && actions.includes('onSwitch("cloud")'),
    "…in both directions: to this computer, and to the cloud builder",
  );
  ok(actions.includes('href="/download"'), "offline/gated empty state links Fleet Runner");
  ok(
    actions.includes("downloadIsTheWayForward(way)"),
    "…only when the download is the way forward for this account",
  );
}
{
  // The phone's tab bar is on every app page, so a launcher directive on it
  // decides the whole phone. It used to say "hidden" and the button was gone
  // from every page; then nothing, and the owner's wide pill floated over
  // Control's cards (2026-10-18). It says "tab": the slim edge handle with the
  // same live dot. The account menu holds the one on/off switch.
  const nav = read("src/components/shell/MobileNav.tsx");
  const menu = read("src/components/shell/AccountMenu.tsx");
  ok(!/<nav[^>]*data-fc-place="hidden"/.test(nav), "phone nav does not hide the widget launcher");
  ok(/<nav[^>]*data-fc-place="tab"/.test(nav), "phone nav asks for the edge tab, not the pill");
  ok(
    menu.includes("Hide feedback button") && menu.includes("Show feedback button"),
    "menu offers the feedback button's on/off switch",
  );
  const opener = read("src/lib/open-feedback.ts");
  ok(
    menu.includes("Report a problem") &&
      menu.includes("openFeedback(") &&
      opener.includes(".report()"),
    "menu offers Report a problem",
  );
}
{
  // Under the phone's terminal: the session box, with the model chip in its
  // row and Keys on the terminal's corner — never a bar of modes to choose
  // between before saying anything.
  const dock = read("src/components/terminal/TerminalMobileDock.tsx");
  ok(dock.includes("{box(<TerminalSessionInfo"), "the dock shows the session box");
  ok(
    !/Type|Prompt|TerminalInputSwitch/.test(dock.replace(/\/\*[\s\S]*?\*\//g, "")),
    "no Type / Prompt switch",
  );
  ok(dock.includes("useState(!immersive)"), "normal opens writing, full screen opens watching");
  ok(dock.includes("ui-term-watchbar"), "full screen keeps a slim bar with Esc and Enter");
  ok(dock.includes("<TerminalKeyDeck"), "the keys a phone lacks are one button away");
}

console.log(`${fail ? "✗" : "✓"} phone-chrome: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
