/**
 * "I have one" opens the projects an account already belongs to.
 *
 * QA's Viewer seat (2026-11-12) owns no project but is a member of
 * qa-agent-walk. Home offered "I have one", which opened the GitHub import
 * ("No GitHub account linked yet") instead of the project it already had.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { composerChips } from "../../src/config/loki-suggested-actions";

const ids = (c: ReturnType<typeof composerChips>) => c.map((x) => x.id);
const href = (c: ReturnType<typeof composerChips>, id: string) =>
  (c.find((x) => x.id === id) as { href?: string } | undefined)?.href;

// A seat: no projects of its own, one shared with it.
const seat = composerChips({ projectCount: 0, sharedProjectCount: 1, selectedProjects: [] });
assert.deepEqual(ids(seat), ["new_project", "your_projects", "import_project"]);
assert.equal(seat[1].label, "I have one");
assert.equal(href(seat, "your_projects"), "/projects", "opens the projects it belongs to");
assert.equal(href(seat, "import_project"), "/control/import", "import stays, second");
assert.equal(seat[2].label, "Import from GitHub");

// Nobody shared anything: "I have one" is still the import (a repo elsewhere).
const fresh = composerChips({ projectCount: 0, sharedProjectCount: 0, selectedProjects: [] });
assert.deepEqual(ids(fresh), ["new_project", "import_project"]);
assert.equal(composerChips({ projectCount: 0, selectedProjects: [] }).length, 2);

// An owner with projects is unchanged.
assert.deepEqual(
  ids(composerChips({ projectCount: 3, sharedProjectCount: 1, selectedProjects: [] })),
  ["new_project", "open_project", "attention"],
);

// The count reaches the composer from the server seed.
const read = (p: string) => fs.readFileSync(p, "utf8");
assert.match(
  read("src/lib/loki/prefetch.ts"),
  /listSharedProjects\(userId\)\.then\(\(rows\) => rows\.length\)/,
);
assert.match(
  read("src/app/(app)/loki/page.tsx"),
  /sharedProjectCount=\{seed\?\.sharedProjectCount \?\? 0\}/,
);
assert.match(
  read("src/components/loki/LokiWorkspace.tsx"),
  /sharedProjectCount=\{sharedProjectCount\}/,
);
assert.match(
  read("src/components/loki/Composer.tsx"),
  /composerChips\(\{\s*projectCount,\s*sharedProjectCount,/,
);

console.log("i-have-one ok");
