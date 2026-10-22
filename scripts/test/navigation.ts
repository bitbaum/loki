import assert from "node:assert/strict";
import {
  ACCOUNT_NAV_ITEMS,
  FLEET_SURFACES,
  MOBILE_NAV_ITEMS,
  NAV,
  NAV_ITEMS,
  SIDEBAR_SECTIONS,
  SITE_NAV_ITEMS,
} from "../../src/config/navigation";

// ─── The loop is the taxonomy ────────────────────────────────────────────────
// Loki's sidebar answers three operator questions and nothing else. This test
// exists because the previous structure decayed in a way a reviewer could not
// see: a section literally named "More" accumulated Approvals, Terminal,
// Prompts, Activity, System, Thoughts and the public /fleet register — seven
// unrelated pages whose only shared property was that nobody had decided where
// they went. A landfill does not announce itself; it has to be made
// unrepresentable.

const LOOP = [
  // Grouped by thing (2026-10-19), not by question: the work, Loki, what
  // waits for a yes, the plumbing.
  { id: "build", items: ["control", "missions", "projects", "terminal", "prompts"] },
  { id: "ask", items: ["loki", "voice", "today", "suggestions"] },
  { id: "review", items: ["approvals", "feedback"] },
  { id: "fleet", items: ["packages", "activity", "system"] },
] as const;

for (const expected of LOOP) {
  const section = SIDEBAR_SECTIONS.find((s) => s.id === expected.id);
  assert.ok(section, `${expected.id} section exists`);
  assert.deepEqual(
    section.items.map((i) => i.id),
    [...expected.items],
    `${expected.id} holds exactly the pages that answer its question`,
  );
  assert.ok(
    section.question.trim().length > 0,
    `${expected.id} states the operator question it answers — a section that ` +
      `cannot state its question is the "More" failure starting over`,
  );
}

// The landfill, by every name it might return under.
for (const banned of ["more", "other", "misc", "site", "tools"]) {
  assert.equal(
    SIDEBAR_SECTIONS.some((s) => s.id === banned),
    false,
    `"${banned}" is not a section — a section is one operator question, not a drawer`,
  );
}

// ─── Nothing is listed twice ─────────────────────────────────────────────────
const sidebarIds = SIDEBAR_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
assert.equal(new Set(sidebarIds).size, sidebarIds.length, "no nav item is listed in two sections");

// The sidebar navigates; the account menu acts on the account. An item in both
// is how the sidebar footer quietly became a second settings page.
for (const item of ACCOUNT_NAV_ITEMS) {
  assert.equal(
    sidebarIds.includes(item.id),
    false,
    `${item.id} belongs to the account menu, not the sidebar`,
  );
}

// ─── Marketing pages left the signed-in shell, but stay findable ─────────────
// "Investors" was in the authenticated sidebar. Curating the sidebar must not
// make a page unreachable, so the palette still indexes every one of them.
for (const item of SITE_NAV_ITEMS) {
  assert.equal(
    sidebarIds.includes(item.id),
    false,
    `${item.id} is a public marketing page — not an operator surface`,
  );
  assert.ok(
    NAV_ITEMS.some((i) => i.id === item.id),
    `${item.id} stays in NAV_ITEMS so Cmd-K can still reach it`,
  );
}

// ─── Retired routes are deleted, not hidden ──────────────────────────────────
// `agents` → /control and `atlas` → /projects survived as NAV entries pointing
// at the pages that replaced them. Because NAV_ITEMS is what AppTopBar and
// PageTitle search for "which page am I on?", the first match won: /control
// would have been titled "Agents". The redirect pages reference their TARGETS
// (NAV.control, NAV.projects), so the redirects stay honest without them.
for (const retired of ["agents", "atlas", "duet"]) {
  assert.equal(
    retired in NAV,
    false,
    `${retired} is retired — a nav entry pointing at its own replacement shadows it`,
  );
}

// No two nav items may share an href, for the same reason.
const hrefs = NAV_ITEMS.map((i) => i.href);
assert.equal(
  new Set(hrefs).size,
  hrefs.length,
  "no two nav items share an href — the 'which page am I on?' lookup takes the first match",
);

// ─── Mobile bottom bar mirrors the loop ──────────────────────────────────────
// Home, Projects, Loki, plus More. A tab that is not in a section would mean
// the bar and the sheet describe different products.
assert.deepEqual(
  MOBILE_NAV_ITEMS.map((i) => i.id),
  ["control", "projects", "loki"],
  "the bottom bar carries what is opened daily — Home, Projects, Loki — and More holds the rest",
);
assert.equal(NAV.control.label, "Home", "Control is called Home");
for (const tab of MOBILE_NAV_ITEMS) {
  assert.ok(sidebarIds.includes(tab.id), `${tab.id} is a real sidebar destination`);
}
// A heading over a single row reads as a menu that lost its contents ("Your
// day" over Today alone, "Build" over Terminal alone — owner, 2026-10-19).
// On the phone the tabs are filtered out of More, so count what is left.
const tabIds = new Set(MOBILE_NAV_ITEMS.map((i) => i.id));
for (const section of SIDEBAR_SECTIONS.filter((s) => !s.private)) {
  const inMore = section.items.filter((i) => !tabIds.has(i.id));
  assert.ok(
    inMore.length >= 2,
    `"${section.label}" shows ${inMore.length} row(s) in the phone's More sheet — at least two, or fold it into another section`,
  );
}
assert.equal(NAV.terminal.label, "Sessions", "the page of agent sessions is called Sessions");

// ─── Private zone ────────────────────────────────────────────────────────────
const priv = SIDEBAR_SECTIONS.find((s) => s.id === "private");
assert.ok(priv, "private section exists");
assert.ok(priv.private, "private section is PIN-gated");
for (const id of ["people", "robots", "crew"] as const) {
  assert.ok(
    priv.items.some((i) => i.id === id),
    `${id} stays in the private book`,
  );
  assert.equal(NAV[id].href, `/${id}`, `${id} has its own route`);
}

// ─── Project workspace tabs ──────────────────────────────────────────────────
assert.ok(
  FLEET_SURFACES.some((s) => s.id === "terminal"),
  "Terminal stays a project-scoped fleet tab",
);
for (const surface of FLEET_SURFACES) {
  assert.ok(
    NAV_ITEMS.some((i) => i.href === surface.href),
    `${surface.id} points at a real nav destination`,
  );
}

console.log("✓ navigation IA tests passed");
