// ROADMAP.md / CHANGELOG.md in a project's repository become its canonical
// roadmap and changelog on the fleet map — unless Loki's own rows exist.
import assert from "node:assert/strict";
import {
  parseRoadmapMarkdown,
  parseChangelogMarkdown,
  githubRepoPath,
  recordsFromFiles,
  loadRepoRecords,
  clearRepoRecordsCache,
  plainText,
} from "../../src/lib/register/repo-records";
import { publicRoadmap, publicChangelog, recordSources } from "../../src/lib/register/map";

const ROADMAP = `# Roadmap

One line of lede that the parser ignores.

## Now
### Tenancy on the box
One Linux user per builder account.
Target: 2026-Q4
- [x] Design note
- [ ] Per-account runner service
- [ ] Credential file per tenant

## Next
### One box → a pool
- [ ] Runners on N boxes claim from one queue

## Shipped
### "Watch the fix" walkthrough
`;

const CHANGELOG = `# Changelog

Intro prose is ignored.

## 2026-09-28
### Added
- **Watch the fix.** A [walkthrough](https://loki.orangecat.ch/thoughts/x) on the live page.
  - nested detail is dropped
- Failed rows say *why*.
### Fixed
- The \`Live\` chip is a status, not a link.

## [0.8.0] - 2026-08-14
- The terminal names its agents.
`;

// ---- roadmap ----
{
  const items = parseRoadmapMarkdown(ROADMAP);
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => [i.title, i.status, i.progress, i.targetDate]),
    [
      ["Tenancy on the box", "in progress", 33, "2026-Q4"],
      ["One box → a pool", "planned", 0, null],
      ["“Watch the fix” walkthrough".replace(/[“”]/g, '"'), "done", 100, null],
    ],
  );
  assert.equal(items[0].line, "One Linux user per builder account.");
  assert.equal(items[1].line, null);
  assert.deepEqual(items[0].milestones, [
    { title: "Design note", done: true },
    { title: "Per-account runner service", done: false },
    { title: "Credential file per tenant", done: false },
  ]);
  assert.deepEqual(parseRoadmapMarkdown("# Roadmap\n\nNothing yet."), []);
}

// ---- changelog ----
{
  const entries = parseChangelogMarkdown(CHANGELOG);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, "2026-09-28");
  assert.equal(
    entries[0].done,
    "Watch the fix. A walkthrough (https://loki.orangecat.ch/thoughts/x) on the live page.\nFailed rows say why.\nThe Live chip is a status, not a link.",
  );
  assert.equal(entries[1].date, "2026-08-14", "the [version] - date heading form is accepted");
  assert.equal(plainText("**Bold.** _em_ `code` [t](/x)"), "Bold. em code t");
}

// ---- repo path ----
{
  assert.equal(githubRepoPath("https://github.com/bitbaum/loki.git"), "bitbaum/loki");
  assert.equal(githubRepoPath("git@github.com:bitbaum/loki"), "bitbaum/loki");
  assert.equal(githubRepoPath("https://gitlab.com/x/y"), null);
  assert.equal(githubRepoPath(null), null);
}

// ---- the map: rows win, files fill the gap, provenance is published ----
{
  const repo = recordsFromFiles("bitbaum/loki", { roadmap: ROADMAP, changelog: CHANGELOG });
  assert.equal(repo.source.roadmap, "https://github.com/bitbaum/loki/blob/HEAD/ROADMAP.md");

  const fromFiles = publicRoadmap({ goals: [], devLog: [], repo });
  assert.equal(fromFiles.length, 3);
  assert.equal(
    fromFiles[0].source,
    repo.source.roadmap,
    "each item links to the file it came from",
  );
  assert.equal(fromFiles[0].milestones.length, 3);
  assert.equal(fromFiles[0].line, "One Linux user per builder account.");
  assert.equal(publicChangelog({ goals: [], devLog: [], repo })[0].date, "2026-09-28");
  assert.deepEqual(recordSources({ goals: [], devLog: [], repo }), {
    roadmap: "repo",
    changelog: "repo",
    source: repo.source,
  });

  const seeded = [{ title: "Make x development and verification public" }];
  assert.deepEqual(
    publicRoadmap({ goals: seeded, devLog: [], repo }).map((r) => r.title),
    fromFiles.map((r) => r.title),
    "the file wins over goal rows: a seeded placeholder goal is scaffolding, not a roadmap",
  );
  assert.equal(recordSources({ goals: seeded, devLog: [], repo }).roadmap, "repo");
  const empty = recordsFromFiles("bitbaum/x", { roadmap: null, changelog: null });
  assert.deepEqual(
    publicRoadmap({ goals: seeded, devLog: [], repo: empty }).map((r) => r.title),
    seeded.map((g) => g.title),
    "no file → the goal rows are still the record",
  );
  assert.equal(recordSources({ goals: seeded, devLog: [], repo: empty }).roadmap, "goals");
  const log = [{ date: "2026-09-01", done: "from the dev log" }];
  assert.equal(
    publicChangelog({ goals: [], devLog: log, repo })[0].date,
    "2026-09-28",
    "file first",
  );
  assert.equal(
    publicChangelog({ goals: [], devLog: log, repo: empty })[0].done,
    "from the dev log",
  );
  assert.deepEqual(recordSources({ goals: [], devLog: [], repo: null }), {
    roadmap: null,
    changelog: null,
    source: { roadmap: null, changelog: null },
  });
}

async function fetchCases() {
  // ---- fetch: both files in parallel, cached, private/missing → empty, never a throw ----
  {
    clearRepoRecordsCache();
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("ROADMAP.md")) return new Response(ROADMAP, { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const first = await loadRepoRecords("https://github.com/bitbaum/loki", fetcher, 1_000);
    assert.equal(first?.roadmap.length, 3);
    assert.deepEqual(first?.changelog, []);
    assert.equal(first?.source.changelog, null, "a 404 is 'not written', not a broken link");
    assert.equal(calls.length, 2);
    const again = await loadRepoRecords("https://github.com/bitbaum/loki", fetcher, 2_000);
    assert.equal(calls.length, 2, "served from cache inside the TTL");
    assert.equal(again, first);
    const thrower = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const down = await loadRepoRecords("https://github.com/bitbaum/other", thrower, 1_000);
    assert.deepEqual(down?.roadmap, []);
    assert.equal(await loadRepoRecords(null, fetcher), null, "no repo → nothing to read");
  }
}

fetchCases().then(() => console.log("repo-records: ok"));
