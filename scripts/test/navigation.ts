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
  { id: "now", items: ["today", "approvals", "feedback"] },
  { id: "fleet", items: ["control", "projects", "activity", "system"] },
  { id: "command", items: ["loki", "terminal", "prompts"] },
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
for (const banned of ["more", "other", "misc", "work", "site", "tools"]) {
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
// One tab per loop section, plus Menu. If a tab is not in a section, the bar
// and the sheet are describing different products.
assert.deepEqual(
  MOBILE_NAV_ITEMS.map((i) => i.id),
  ["today", "loki", "control"],
  "the bottom bar carries one entry point per loop section",
);
for (const tab of MOBILE_NAV_ITEMS) {
  assert.ok(sidebarIds.includes(tab.id), `${tab.id} is a real sidebar destination`);
}

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
