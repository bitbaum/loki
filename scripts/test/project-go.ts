// Opening one of your projects by its name (src/lib/project-go.ts) — the link
// an agent can hand George without knowing the project's id.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectGoTarget, projectNameKey } from "../../src/lib/project-go";

const projects = [
  { name: "Loki", entityProjectId: "11111111-1111-4111-8111-111111111111" },
  { name: "Petvity", entityProjectId: "22222222-2222-4222-8222-222222222222" },
  { name: "unlinked", entityProjectId: null },
];

assert.equal(projectNameKey(" Pet-Vity "), "petvity");
assert.equal(
  projectGoTarget(projects, "petvity", "people"),
  "/projects/22222222-2222-4222-8222-222222222222#people",
  "case and punctuation do not matter; the tab opens",
);
assert.equal(
  projectGoTarget(projects, "PETVITY", null),
  "/projects/22222222-2222-4222-8222-222222222222",
);
assert.equal(
  projectGoTarget(projects, "petvity", "<script>"),
  "/projects/22222222-2222-4222-8222-222222222222",
  "only a known tab reaches the URL",
);
assert.equal(projectGoTarget(projects, "nope", "people"), "/projects", "no match: the list");
assert.equal(projectGoTarget(projects, "unlinked", null), "/projects", "no page to open");
assert.equal(projectGoTarget(projects, "", null), "/projects");
console.log("✓ project-go: a project opens by its name, never anyone else's");

// Every redirect a route handler makes must name the PUBLIC origin. The go
// route redirected to req.nextUrl.origin; behind Caddy that is the standalone
// server's own localhost:PORT, so the live site sent people to a refused
// connection while every local run (where the two are the same) passed.
{
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /route\.tsx?$/.test(f) ? [p] : [];
    });
  const root = join(__dirname, "..", "..", "src", "app");
  const offenders = walk(root).filter((file) =>
    /redirect\([^;]*(nextUrl\.origin|req(uest)?\.url)/s.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, [], "redirect to the request's own origin");
  console.log("✓ no route handler redirects to the request's own origin");
}
