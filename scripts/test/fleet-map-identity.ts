// The fleet map publishes a project's identity to the public internet, so the
// question this file answers is not "does it render" but "what does it let
// out". Every projection here is an ALLOW-list, and each one drops a column
// that sits right next to the one it keeps:
//
//   identity   — four attrs; the same table holds business_plan, competitors,
//                partnerships and security_vulnerability
//   roadmap    — goal titles and progress; NOT goal descriptions, which in
//                production carry acceptance criteria ("HMAC entitlement
//                webhook verified") written for an engineer, not a reader
//   changelog  — dev-log `done` and the day; NOT next/tests/todos/health
//
// A test that only checked the happy shape would pass just as well if the
// filters were deleted, so every case below also asserts the NEGATIVE: the
// adjacent field is absent from the output.
// Run: npx tsx scripts/test/fleet-map-identity.ts
import {
  publicIdentity,
  publicChangelog,
  publicRoadmap,
  buildFleetMap,
  type MapProfile,
} from "@/lib/register/map";
import { PUBLIC_IDENTITY_ATTRS } from "@/config/project-attrs";
import type { RegisterRow } from "@/lib/register/build";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// ---------------------------------------------------------------- identity --

const fullIdentity: MapProfile = {
  identity: {
    problem: "The environment withdraws exposure precisely when a learner needs it.",
    solution: "A source of exposure that does not withdraw.",
    mission: "Calibrated exposure at the learner's frontier.",
    vision: "Understanding comes first.",
  },
};

const id1 = publicIdentity(fullIdentity);
ok(id1.problem?.startsWith("The environment") === true, "problem is published");
ok(id1.solution === "A source of exposure that does not withdraw.", "solution is published");
ok(id1.mission === "Calibrated exposure at the learner's frontier.", "mission is published");
ok(id1.vision === "Understanding comes first.", "vision is published");
ok(Object.keys(id1).length === 4, "exactly four keys, never a fifth");

// The negative that matters: an attribute outside the allowlist must not
// survive, even when the loader hands one over. The query filters too, so this
// is defence in depth — and the day someone loosens the query, this goes red.
const smuggled = publicIdentity({
  identity: {
    problem: "real",
    // @ts-expect-error — deliberately outside PublicIdentityAttr
    business_plan: "Raise at 8m post. Runway to March.",
    // @ts-expect-error — deliberately outside PublicIdentityAttr
    competitors: "Duolingo, Babbel",
    // @ts-expect-error — deliberately outside PublicIdentityAttr
    security_vulnerability: "auth bypass on /api/groups",
  },
});
ok(
  JSON.stringify(smuggled).includes("Raise at 8m") === false,
  "business_plan never reaches output",
);
ok(JSON.stringify(smuggled).includes("Duolingo") === false, "competitors never reaches output");
ok(
  JSON.stringify(smuggled).includes("auth bypass") === false,
  "security_vulnerability never reaches output",
);
ok(smuggled.problem === "real", "...while the allowed key still passes through");
ok(PUBLIC_IDENTITY_ATTRS.length === 4, "the allowlist is four keys");

const blank = publicIdentity({ identity: { problem: "   ", solution: "" } });
ok(blank.problem === null, "whitespace is not an answer");
ok(blank.solution === null, "neither is an empty string");
const none = publicIdentity(undefined);
ok(
  none.problem === null && none.solution === null && none.mission === null && none.vision === null,
  "a project with no profile yields four nulls, not a missing key",
);

// ----------------------------------------------------------------- roadmap --

const withGoals: MapProfile = {
  goals: [
    {
      title: "Deploy on origin/main + auto-migrate + rollback",
      status: "active",
      progress: 75,
      targetDate: "2026-10-01T00:00:00.000Z",
      milestones: [
        { title: "ledger-base migration", done: true },
        { title: "rollback on drift", done: false },
      ],
    },
    { title: "Launch OrangeCat", status: "completed", progress: 100 },
    { title: "   ", status: "active", progress: 0 },
  ],
};

const road = publicRoadmap(withGoals);
ok(road.length === 2, "a goal with a blank title is not a roadmap item");
ok(road[0].title === "Deploy on origin/main + auto-migrate + rollback", "title survives");
ok(road[0].progress === 75, "progress survives");
ok(road[0].targetDate === "2026-10-01", "target date is a DAY, not a timestamp");
ok(road[0].milestones.length === 2, "milestone titles survive");
ok(road[0].milestones[0].title === "ledger-base migration", "...with the title");
ok(
  road[0].milestones[0].done === true && road[0].milestones[1].done === false,
  "...and with `done`, which is the one column of a roadmap a reader cannot infer",
);
ok(
  road.some((r) => r.status === "completed"),
  "completed goals stay — a roadmap that hides what shipped reads as though nothing does",
);

// A `Source: <url>` entry is provenance that goal seeding leaves in the
// milestone list. Published as a step it is untickable, and as prose it is an
// unbreakable 90-character token in a 390px column — which is exactly how
// /fleet/heidi came to clip 47% of every roadmap line behind an ancestor's
// overflow:hidden. It is lifted out, not dropped: the reader still gets it.
const seeded = publicRoadmap({
  goals: [
    {
      title: "Build a consent-aware learner model",
      status: "active",
      progress: 0,
      milestones: [
        { title: "Capture what the learner did not understand", done: false },
        {
          title:
            "Source: https://github.com/bitbaum/heidi/blob/e75493f917f88a19bd9c61882fbe6a8b9965a4b0/HEIDI.md",
          done: false,
        },
      ],
    },
  ],
});
ok(seeded[0].milestones.length === 1, "a Source: pointer is not a milestone");
ok(
  seeded[0].source ===
    "https://github.com/bitbaum/heidi/blob/e75493f917f88a19bd9c61882fbe6a8b9965a4b0/HEIDI.md",
  "...it is published as the item's source instead",
);
ok(
  publicRoadmap({ goals: [{ title: "g", milestones: [{ title: "Sourcing the recordings" }] }] })[0]
    .milestones.length === 1,
  "a real step that merely starts with the word Source is untouched",
);

// The negative: goal descriptions are internal and must never appear. This is
// the exact shape read from production on 2026-09-15.
const internal = publicRoadmap({
  goals: [
    {
      title: "OC seam: verify BTC pass with a real sats purchase",
      status: "active",
      progress: 90,
      // @ts-expect-error — the column exists on the row and must not be published
      description: "Acceptance: HMAC entitlement webhook verified against prod",
    },
  ],
});
ok(
  JSON.stringify(internal).includes("Acceptance") === false,
  "goal descriptions (acceptance criteria) never reach output",
);
ok(internal[0].title.startsWith("OC seam"), "...while the title still does");
ok(publicRoadmap(undefined).length === 0, "no goals is an empty roadmap, not a crash");

// --------------------------------------------------------------- changelog --

const withLog: MapProfile = {
  devLog: [
    {
      date: "2026-09-12T08:00:00.000Z",
      done: "Fixed the Diktieren button on /de.",
      next: "Ship the group invite flow",
    },
    { date: "2026-09-14T08:00:00.000Z", done: "Citations you can actually follow." },
    { date: "2026-09-10T08:00:00.000Z", done: "   " },
  ],
};

const log = publicChangelog(withLog);
ok(log.length === 2, "an entry with no `done` is not a changelog entry");
ok(log[0].date === "2026-09-14", "newest first, dated by day");
ok(log[0].done === "Citations you can actually follow.", "the done line survives");
ok(
  JSON.stringify(log).includes("Ship the group invite flow") === false,
  "`next` is the map's own field and is never smuggled into an entry",
);

const noisy = publicChangelog({
  devLog: [
    {
      date: "2026-09-14T08:00:00.000Z",
      done: "shipped",
      // @ts-expect-error — operator working notes, present on the row
      tests: "7 Playwright scenarios, 1 negative control",
      // @ts-expect-error
      todos: "ask George about the pricing page",
      // @ts-expect-error
      health: "red",
    },
  ],
});
ok(Object.keys(noisy[0]).join(",") === "date,done", "an entry has exactly two keys");
ok(JSON.stringify(noisy).includes("Playwright") === false, "`tests` never reaches output");
ok(JSON.stringify(noisy).includes("George") === false, "`todos` never reaches output");
ok(JSON.stringify(noisy).includes("red") === false, "`health` never reaches output");

// Run bookkeeping is not a changelog. These four lines are the exact shape
// `hostedRunDevLogEntry` writes, and three of Heidi's six public entries were
// this — two of them announcing a FAILED dispatch, stored truncated mid-word
// by the bug #584 fixed. The run and its error keep their homes (the
// orchestration run, the activity feed, the catalogue's last-run outcome);
// what they lose is a slot in the public account of what the product does.
const bookkeeping = publicChangelog({
  devLog: [
    {
      date: "2026-09-10T20:05:44.767Z",
      done: "Hosted dispatch (Hermes) FAILED — Repo: https://github.com/bitbaum/heidi (Next.js 16 App Route",
    },
    { date: "2026-09-10T19:12:27.041Z", done: "Hosted dispatch (Hermes) — opened PR #3" },
    { date: "2026-09-10T18:00:00.000Z", done: "Hosted analysis — read the repo" },
    { date: "2026-09-11T00:11:28.000Z", done: "Added app/sitemap.ts and app/robots.ts." },
  ],
});
ok(bookkeeping.length === 1, "hosted dispatch/analysis lines are not changelog entries");
ok(bookkeeping[0].done.startsWith("Added app/sitemap.ts"), "...and real entries are untouched");
ok(
  publicChangelog({
    devLog: [{ date: "2026-09-11T00:00:00.000Z", done: "Hosted the docs on the box" }],
  }).length === 1,
  "the filter keys on the machine's exact prefix, never on prose that resembles it",
);

const many = publicChangelog({
  devLog: Array.from({ length: 50 }, (_, i) => ({
    date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    done: `entry ${i}`,
  })),
});
ok(many.length === 20, "a changelog is a front page, not an export — capped at 20");

// ------------------------------------------------------------ the map join --

const row: RegisterRow = {
  slug: "heidi",
  name: "Heidi",
  description: "Understand Zurich German, then take part.",
  repo: "heidi",
  site: {
    url: "https://heidi.orangecat.ch",
    host: "heidi.orangecat.ch",
    kind: "product",
    status: "live",
    owner: "bitbaum",
    since: "2026-09-10",
  },
  loki: { id: "l-1", liveUrl: "https://heidi.orangecat.ch" },
  orangecat: { projectId: "oc-1" },
  solon: null,
} as unknown as RegisterRow;

const map = buildFleetMap(
  [row],
  new Map([["heidi", { ...fullIdentity, ...withGoals, ...withLog }]]),
  new Map(),
  new Date("2026-09-15T00:00:00.000Z"),
);
const entry = map.projects[0];
ok(entry.identity.problem !== null, "the map entry carries identity");
ok(entry.roadmap.length === 2, "the map entry carries a roadmap");
ok(entry.changelog.length === 2, "the map entry carries a changelog");
ok(entry.what === "Understand Zurich German, then take part.", "`what` still comes from the row");

// A project nobody has written anything for must still produce the six keys,
// so a consumer can tell "not written yet" from "this field does not exist".
const emptyMap = buildFleetMap([row], new Map(), new Map(), new Date());
const emptyEntry = emptyMap.projects[0];
ok(emptyEntry.identity.mission === null, "an unwritten project has null identity fields");
ok(Array.isArray(emptyEntry.roadmap) && emptyEntry.roadmap.length === 0, "...an empty roadmap");
ok(Array.isArray(emptyEntry.changelog) && emptyEntry.changelog.length === 0, "...and changelog");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
