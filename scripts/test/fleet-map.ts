/**
 * Unit tests for the fleet map (pure half, src/lib/register/map.ts).
 *
 * Contract: the map is the register plus purpose/layer/state/activity, sorted
 * pillars-first, and its overview text names every project once with its
 * facts in a fixed order so the assistant can answer "what do we have?".
 *
 * Run: npx tsx scripts/test/fleet-map.ts
 */
import assert from "node:assert/strict";
import { buildFleetMap, layerFor, renderFleetMapOverview, PILLARS } from "@/lib/register/map";
import type { RegisterRow } from "@/lib/register/build";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const site = (over: Partial<NonNullable<RegisterRow["site"]>> = {}): RegisterRow["site"] => ({
  url: "https://x.orangecat.ch",
  host: "x.orangecat.ch",
  kind: "product",
  status: "live",
  owner: "bitbaum",
  since: "2026-06-01",
  ...over,
});

const rows: RegisterRow[] = [
  {
    slug: "kivvi",
    name: "Kivvi",
    description: "Nanny booking",
    repo: "kivvi",
    site: site({ kind: "client-app", owner: "kivvi" }),
    loki: { id: "1", liveUrl: null },
    orangecat: null,
    solon: null,
  },
  {
    slug: "loki",
    name: "Loki",
    description: "A captain over a fleet of agents",
    repo: "loki",
    site: site({ url: "https://loki.orangecat.ch", host: "loki.orangecat.ch" }),
    loki: { id: "2", liveUrl: "https://loki.orangecat.ch" },
    orangecat: { projectId: "oc-1" },
    solon: null,
  },
  {
    slug: "aoz-demo",
    name: "AOZ demo",
    description: null,
    repo: "aoz-begleitung",
    site: site({ kind: "demo", status: "demo" }),
    loki: null,
    orangecat: null,
    solon: null,
  },
  {
    slug: "townsism",
    name: "Townsism",
    description: "The social layer",
    repo: null,
    site: null,
    loki: { id: "3", liveUrl: null },
    orangecat: null,
    solon: null,
  },
  {
    slug: "orangecat",
    name: "OrangeCat",
    description: "The economy",
    repo: "orangecat",
    site: site({ url: "https://orangecat.ch", host: "orangecat.ch" }),
    loki: { id: "4", liveUrl: "https://orangecat.ch" },
    orangecat: null,
    solon: { slug: "orangecat" },
  },
];

check("layers: pillars by name, clients by owner, demos by kind, no site = next", () => {
  assert.equal(layerFor(rows[1]), "execution");
  assert.equal(layerFor(rows[4]), "economic");
  assert.equal(layerFor(rows[0]), "client");
  assert.equal(layerFor(rows[2]), "demo");
  assert.equal(layerFor(rows[3]), "next");
});

check("pillars come first, then products, clients, demos, the rest", () => {
  const map = buildFleetMap(rows, new Map(), new Map(), new Date("2026-09-14T00:00:00Z"));
  assert.deepEqual(
    map.projects.map((p) => p.slug),
    ["loki", "orangecat", "kivvi", "aoz-demo", "townsism"],
  );
  assert.equal(map.pillars.length, PILLARS.length);
  assert.equal(map.generatedAt, "2026-09-14T00:00:00.000Z");
});

check("activity and the dev log land on the right project", () => {
  const map = buildFleetMap(
    rows,
    new Map([
      [
        "loki",
        {
          stack: "Next.js",
          devLog: [
            { date: "2026-09-10", done: "old", next: "older next" },
            { date: "2026-09-13", done: "Renamed the product", next: "Close the chat loop" },
          ],
        },
      ],
    ]),
    new Map([
      [
        "loki",
        { openRuns: 2, lastRun: { outcome: "success", at: new Date("2026-09-13T22:00:00Z") } },
      ],
    ]),
  );
  const loki = map.projects.find((p) => p.slug === "loki")!;
  assert.equal(loki.stack, "Next.js");
  assert.equal(loki.now.openRuns, 2);
  assert.equal(loki.now.lastRun?.outcome, "success");
  assert.equal(loki.now.lastLog?.done, "Renamed the product");
  assert.equal(loki.next, "Close the chat loop");
  assert.equal(loki.urls.repo, "https://github.com/bitbaum/loki");
  assert.equal(loki.urls.orangecat, "https://orangecat.ch/projects/oc-1");
  assert.equal(map.summary.inFlight, 2);
});

check("summary counts live, clients and in-flight honestly", () => {
  const map = buildFleetMap(rows, new Map(), new Map());
  assert.deepEqual(map.summary, { projects: 5, live: 3, clients: 1, inFlight: 0 });
});

check("a client site is owned by the client, not by us", () => {
  const map = buildFleetMap(rows, new Map(), new Map());
  assert.equal(map.projects.find((p) => p.slug === "kivvi")!.owner, "kivvi");
  assert.equal(map.projects.find((p) => p.slug === "townsism")!.status, "not live");
});

check("no hosting row but a live URL counts as live; a timestamped dev log speaks in days", () => {
  const hostless: RegisterRow = {
    ...rows[1],
    slug: "orangecat-hostless",
    site: null,
    loki: { id: "9", liveUrl: "https://orangecat.ch" },
  };
  const map = buildFleetMap(
    [hostless],
    new Map([
      ["orangecat-hostless", { devLog: [{ date: "2026-09-12T19:59:17.000Z", done: "x" }] }],
    ]),
    new Map(),
  );
  assert.equal(map.projects[0]!.status, "live");
  assert.equal(map.projects[0]!.urls.live, "https://orangecat.ch");
  assert.equal(map.projects[0]!.now.lastLog?.date, "2026-09-12");
  assert.equal(map.summary.live, 1);
});

check("the overview names every project once, with facts in a fixed order", () => {
  const map = buildFleetMap(
    rows,
    new Map([
      ["loki", { devLog: [{ date: "2026-09-13", done: "Renamed", next: "Close the loop" }] }],
    ]),
    new Map(),
  );
  const text = renderFleetMapOverview(map);
  for (const r of rows)
    assert.equal(text.split(`\n${r.slug} — `).length, 2, `${r.slug} appears once`);
  assert.match(text, /^Fleet map \(5 projects, 3 live, 1 client systems\)/);
  assert.match(
    text,
    /loki — A captain over a fleet of agents; execution, live; live at https:\/\/loki\.orangecat\.ch; code https:\/\/github\.com\/bitbaum\/loki; last log 2026-09-13: Renamed; next: Close the loop/,
  );
  assert.match(text, /kivvi — Nanny booking; client, live, for kivvi/);
  assert.match(text, /aoz-demo — \(no description yet\)/);
});

console.log(`\nfleet-map: ${pass} passed`);
