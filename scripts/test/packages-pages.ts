/**
 * The Packages surfaces: what a person sees, and that no state is a dead end.
 *
 * Renders the real components with real-shaped rows (no database, no
 * network), and reads the route and page sources for the properties a render
 * cannot show: the sync route answers only a signed-in caller, the pages
 * refresh themselves when the data is stale, and the project's "Built from"
 * panel is on the project page.
 *
 * Run: npx tsx scripts/test/packages-pages.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PackagesList } from "@/components/packages/PackagesList";
import { PackageDependents } from "@/components/packages/PackageDependents";
import { PackageStatusTag } from "@/components/packages/PackageStatusTag";
import { NAV, SIDEBAR_SECTIONS } from "@/config/navigation";
import { packageStatus } from "@/lib/packages/status";
import { buildDependents, type PackageListRow } from "@/lib/packages/view";

const ROOT = join(import.meta.dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

const row = (over: Partial<PackageListRow>): PackageListRow => ({
  slug: "ai-kit",
  name: "@bitbaum/ai-kit",
  summary: "The fleet's one AI layer",
  latest: { version: "1.20.1", from: "npm" },
  usedBy: 0,
  onLatest: 0,
  behind: 0,
  unknown: 0,
  ...over,
});

console.log("packages pages:");

check("the list links every package to its page and counts who is behind", () => {
  const html = renderToStaticMarkup(
    createElement(PackagesList, {
      rows: [
        row({ usedBy: 3, onLatest: 1, behind: 1, unknown: 1 }),
        row({
          slug: "listkit",
          name: "listkit",
          summary: null,
          latest: { version: null, from: "none" },
        }),
      ],
    }),
  );
  assert.match(html, /href="\/packages\/ai-kit"/);
  assert.match(html, /href="\/packages\/listkit"/);
  assert.match(html, /latest v1\.20\.1/);
  assert.match(html, /latest —/, "an unknown latest says so rather than inventing one");
  // One line per row (design reset): who uses it, and only the counts that
  // need a word — on latest is what "used by" means unless the line says so.
  assert.match(html, /used by 3 projects, 1 behind, 1 unknown/);
  assert.match(html, /not in your projects/);
  assert.ok(!/ui-tag|ui-badge/.test(html), "no badge stack on a package row");
  assert.match(html, /type="search"/);
});

check("status tags: one colour per meaning", () => {
  const tag = (v: string | null, l: string | null) =>
    renderToStaticMarkup(createElement(PackageStatusTag, { status: packageStatus(v, l) }));
  assert.match(tag("1.0.0", "1.0.0"), /ui-tag-positive/);
  assert.match(tag("1.0.0", "1.1.0"), /ui-tag-warning/);
  assert.match(tag("0.1.0", "0.2.0"), /ui-tag-warning/, "behind is a warning, never red");
  assert.match(tag("0.1.0", "0.2.0"), /may need changes/, "a breaking bump says so");
  assert.match(tag(null, "1.0.0"), /ui-tag-neutral/);
});

check(
  "dependents: project links, versions, behind first; the empty state says how to start",
  () => {
    const at = new Date("2026-10-14T08:00:00Z");
    const rows = buildDependents(
      [
        {
          projectId: "a",
          entityProjectId: "e-a",
          projectName: "Loki",
          packageName: "listkit",
          spec: "github:bitbaum/listkit#v0.2.0",
          version: "0.2.0",
          source: "git",
          observedAt: at,
        },
        {
          projectId: "b",
          entityProjectId: "e-b",
          projectName: "Heidi",
          packageName: "listkit",
          spec: "github:bitbaum/listkit#v0.1.0",
          version: "0.1.0",
          source: "git",
          observedAt: at,
        },
      ],
      { version: "0.2.0", from: "github" },
    );
    const html = renderToStaticMarkup(createElement(PackageDependents, { rows, install: null }));
    assert.ok(html.indexOf("Heidi") < html.indexOf("Loki"), "the project behind comes first");
    assert.match(html, /href="\/projects\/e-b"/);
    assert.match(html, /v0\.1\.0/);
    assert.match(html, /1 minor version behind/);

    const empty = renderToStaticMarkup(
      createElement(PackageDependents, { rows: [], install: "pnpm add listkit" }),
    );
    assert.match(empty, /None of your projects uses it yet/);
    assert.match(empty, /pnpm add listkit/);
  },
);

check("Packages has a seat under Fleet", () => {
  const fleet = SIDEBAR_SECTIONS.find((s) => s.id === "fleet");
  assert.ok(fleet?.items.some((i) => i.id === "packages"));
  assert.equal(NAV.packages.href, "/packages");
});

check("the sync route answers only a signed-in caller, in the API envelope", () => {
  const route = src("src/app/api/packages/sync/route.ts");
  assert.match(route, /getApiUserId\(\)/);
  assert.match(route, /jsonError\("Unauthorized", 401\)/);
  assert.match(route, /jsonOk\(/);
  assert.match(route, /checkRateLimit\(/, "each read asks GitHub per project — it is rate limited");
});

check(
  "the pages read again on sight when the data is stale, and never 404 an unlisted slug",
  () => {
    const list = src("src/app/(app)/packages/page.tsx");
    const detail = src("src/app/(app)/packages/[slug]/page.tsx");
    assert.match(list, /autoStart=\{coverage\.stale\}/);
    assert.match(detail, /autoStart=\{coverage\.stale\}/);
    assert.ok(!detail.includes("notFound("), "an unknown package explains itself and links back");
    assert.match(detail, /See every package/);
  },
);

check("the project page shows what it is built from", () => {
  const view = src("src/components/projects/ProjectWorkspaceView.tsx");
  assert.match(view, /<ProjectBuiltFrom/);
  const panel = src("src/components/packages/ProjectBuiltFrom.tsx");
  assert.match(panel, /href="\/packages"/, "a project with none links to the fleet's packages");
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
