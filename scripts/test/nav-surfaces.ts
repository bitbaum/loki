import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOBILE_NAV_ITEMS, SIDEBAR_SECTIONS, FLEET_SURFACES } from "../../src/config/navigation";
import { fleetSurfaceHref } from "../../src/lib/fleet-context";
import { isCurrentPath } from "../../src/lib/navigation";

// ─── How many things are telling the user where they are? ────────────────────
// Loki ran six navigation surfaces at once: the sidebar, the top bar, the
// Profile/Chat/Control/Terminal strip (FleetSurfaceGuide), the mobile bottom
// bar, the Menu sheet, and the command palette. On a phone at /control, four
// of them were on screen simultaneously and three of them were answering the
// same question.
//
// The rule these tests hold: a navigation surface must carry information the
// others do not. Where it cannot, it does not render.

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, "..", "..", "src", p), "utf8");

// ─── 1. The project strip is worthless without a project ─────────────────────
// FleetSurfaceGuide's whole claim is that its four tabs are views of ONE
// project and moving between them preserves it. With no project,
// fleetSurfaceHref falls back to the bare routes — which are sidebar entries.
for (const surface of FLEET_SURFACES) {
  const bare = fleetSurfaceHref(surface.id, null);
  const inSidebar = SIDEBAR_SECTIONS.some((s) => s.items.some((i) => i.href === bare));
  assert.ok(
    inSidebar,
    `fleetSurfaceHref("${surface.id}", null) = ${bare}, which is NOT a sidebar ` +
      `destination. If that ever stops being true this test is the wrong guard — ` +
      `but while it holds, a projectless strip is pure duplication.`,
  );
}
const guide = src("components/shell/FleetSurfaceGuide.tsx");
assert.ok(
  /if\s*\(!project\)\s*return null;/.test(guide),
  "FleetSurfaceGuide must render nothing without an active project — otherwise " +
    "it is four sidebar links shown a second time above every Control, Terminal " +
    "and Projects page.",
);

// With a project, every tab must actually carry it. A strip that drops the
// project on one tab is worse than no strip: it silently changes context.
for (const surface of FLEET_SURFACES) {
  const href = fleetSurfaceHref(surface.id, "printcraft");
  assert.notEqual(
    href,
    fleetSurfaceHref(surface.id, null),
    `the "${surface.id}" tab must carry the active project, not fall back to the bare route`,
  );
}

// ─── 2. The top bar does not repeat the bottom bar ───────────────────────────
// Below md the bottom bar shows Today / Loki / Control as labelled, highlighted
// tabs. On those pages the top bar's title was a third simultaneous answer to
// "where am I?", after the bottom tab and the page's own heading.
const topBar = src("components/shell/AppTopBar.tsx");
assert.ok(
  /onBottomBarTab/.test(topBar) && /MOBILE_NAV_ITEMS/.test(topBar),
  "AppTopBar must suppress its mobile page label on pages the bottom bar already names",
);
for (const tab of MOBILE_NAV_ITEMS) {
  assert.ok(
    MOBILE_NAV_ITEMS.some((i) => isCurrentPath(tab.href, i.href)),
    `${tab.id} must be recognised as a bottom-bar tab by the same isCurrentPath ` +
      `the top bar uses — otherwise the suppression silently never fires`,
  );
}
// And it must still speak where the bottom bar cannot: Menu is not a page, so
// every non-tab destination has no other label on a phone.
const nonTab = SIDEBAR_SECTIONS.flatMap((s) => s.items).filter(
  (i) => !MOBILE_NAV_ITEMS.some((t) => t.id === i.id),
);
assert.ok(
  nonTab.length > 0,
  "there must be destinations outside the bottom bar, or the label is dead code",
);
for (const item of nonTab) {
  assert.equal(
    MOBILE_NAV_ITEMS.some((t) => isCurrentPath(item.href, t.href)),
    false,
    `${item.id} is not a bottom-bar tab, so the top bar must still name it`,
  );
}

// ─── 3. The Menu sheet does not repeat the bottom bar either ─────────────────
const sheet = src("components/shell/MobileNavSheet.tsx");
assert.ok(
  /TAB_IDS|sheetItems/.test(sheet),
  "the Menu sheet must filter out the items the bottom bar already shows",
);
assert.equal(
  /ui-mobile-nav-sheet-footer/.test(sheet),
  false,
  "the Menu sheet must not carry an account footer — AccountMenu in the top bar " +
    "owns Settings, appearance and sign out, on every viewport",
);

console.log(
  `✓ nav surfaces: strip is project-gated, top bar defers to the bottom bar on ` +
    `${MOBILE_NAV_ITEMS.length} tabs and still names ${nonTab.length} other destinations`,
);
