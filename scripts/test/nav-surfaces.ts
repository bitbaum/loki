import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOBILE_NAV_ITEMS, SIDEBAR_SECTIONS, FLEET_SURFACES } from "../../src/config/navigation";
import { fleetSurfaceHref } from "../../src/lib/fleet-context";
import { isCurrentPath, isProjectWorkspacePath } from "../../src/lib/navigation";

assert.equal(isProjectWorkspacePath("/projects/example"), true);
assert.equal(isProjectWorkspacePath("/projects/example/"), true);
assert.equal(isProjectWorkspacePath("/projects"), false);
assert.equal(isProjectWorkspacePath("/projects/example/watch"), false);

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

// Never on a phone, where the bottom bar is the menu; never on Control, which
// is every project at once and so is not a view of the one the strip names.
assert.ok(
  /className=\{cn\(\s*"max-md:hidden"/.test(guide),
  "FleetSurfaceGuide must not render below md: the bottom bar is the phone's menu",
);
assert.ok(
  /pathname === "\/control"[^\n]*return null;/.test(guide),
  "FleetSurfaceGuide must not render on /control: it named one project above a page about all of them",
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

// ─── 2. One name for the page on a phone, and one <h1> ──────────────────────
// Until 2026-10-21 the top bar went quiet on the bottom-bar tabs, because the
// page's own heading and the tab already said where you were. The design reset
// (docs/development/design-reset-2026-10.md, rule 1) moved the name to where
// the reference apps keep it: the top bar names EVERY page on a phone, and the
// page does not repeat it (PageTitle is read but not drawn there). So the name
// is said once on screen, and the DOM holds exactly one <h1>: the top bar's
// name is plain text whenever the page draws its own h1.
const topBar = src("components/shell/AppTopBar.tsx");
assert.equal(
  /onBottomBarTab/.test(topBar),
  false,
  "AppTopBar names every page on a phone — it no longer goes quiet on the bottom-bar tabs",
);
assert.ok(
  /useMainHasHeading/.test(topBar) &&
    /<h1/.test(topBar) &&
    /<p className="ui-app-topbar-title/.test(topBar),
  "AppTopBar's name must be an <h1> only when the page in <main> has none (exactly one h1)",
);
const pageTitle = src("components/ui/page-title.tsx");
assert.ok(
  /max-md:sr-only/.test(pageTitle) && !/hidden md:block/.test(pageTitle),
  "PageTitle must stay in the accessibility tree on a phone (sr-only), never display:none",
);
for (const tab of MOBILE_NAV_ITEMS) {
  assert.ok(
    MOBILE_NAV_ITEMS.some((i) => isCurrentPath(tab.href, i.href)),
    `${tab.id} must be recognised as a bottom-bar tab by the same isCurrentPath ` +
      `the bottom bar uses to highlight it`,
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
// Feedback on Loki's own pages is a top-bar icon (FeedbackLauncher, the
// widget's data-fc-place="host"); the bottom bar keeps asking for the edge tab
// as the fallback for when a page hides the top bar. The sheet repeating it as
// its first row read as one more unexplained thing (owner, 2026-10-19).
assert.ok(
  /data-fc-place="host"/.test(src("components/shell/FeedbackLauncher.tsx")) &&
    /FeedbackLauncher/.test(topBar),
  'the top bar must draw the feedback launcher (data-fc-place="host") on Loki\'s own pages',
);
assert.ok(
  /data-fc-place="tab"/.test(src("components/shell/MobileNav.tsx")),
  "the bottom bar must keep the edge tab as the launcher's fallback on a phone",
);
assert.equal(
  /openFeedback/.test(sheet),
  false,
  "the Menu sheet must not repeat the feedback tab as a row of its own",
);

console.log(
  `✓ nav surfaces: strip is project-gated, top bar names every page (${MOBILE_NAV_ITEMS.length} tabs ` +
    `and ${nonTab.length} other destinations) with one h1`,
);
