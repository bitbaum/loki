// Esc leaves the expanded terminal — but never takes Esc from the session
// itself, where it is how you interrupt an agent (src/lib/terminal-expand.ts).
// Run: npx tsx scripts/test/terminal-expand.ts
import { shouldLeaveExpandedOnKey } from "@/lib/terminal-expand";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) pass++;
  else {
    fail++;
    console.error(`✗ ${label}: expected ${expected}, got ${actual}`);
  }
}

/** An element whose ancestors match the given selectors. */
const inside = (...selectors: string[]) => ({
  closest: (sel: string) => (selectors.includes(sel) ? {} : null),
});

eq(shouldLeaveExpandedOnKey({ key: "Escape", target: inside() }), true, "Esc on the page leaves");
eq(shouldLeaveExpandedOnKey({ key: "Escape" }), true, "Esc with no target leaves");
eq(shouldLeaveExpandedOnKey({ key: "Enter", target: inside() }), false, "other keys do nothing");
eq(
  shouldLeaveExpandedOnKey({ key: "Escape", target: inside(".xterm") }),
  false,
  "Esc typed into the session stays with the agent",
);
eq(
  shouldLeaveExpandedOnKey({ key: "Escape", target: inside('[role="dialog"]') }),
  false,
  "Esc in a sheet closes the sheet, not the full screen",
);
eq(
  shouldLeaveExpandedOnKey({ key: "Escape", defaultPrevented: true, target: inside() }),
  false,
  "a control that already handled Esc (a picker) wins",
);
eq(
  shouldLeaveExpandedOnKey({ key: "Escape", isComposing: true, target: inside() }),
  false,
  "Esc cancelling an IME composition is not a layout command",
);

console.log(`terminal-expand: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
