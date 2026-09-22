/**
 * Reading a stored git URL, and the three answers GitHub can give.
 * Run: npx tsx scripts/test/github-repo-ref.ts
 *
 * The parsing half is where the edge cases are: `git_url` is a free-text
 * column filled by humans, by the GitHub importer, and by project scaffolding,
 * so it holds ssh remotes and trailing `.git` alongside tidy https URLs. A
 * parser that quietly returns null for an ssh remote would make the health
 * check skip exactly the projects a developer set up by hand.
 *
 * The status half pins the distinction the checker is built on: 404 is `gone`
 * (a human must decide), a different full_name is `moved` (Loki can just fix
 * it), and anything else — a dead token, a timeout — is `unchecked` and must
 * never read as healthy.
 */
import assert from "node:assert/strict";
import {
  canSeePrivateRepos,
  checkRepo,
  parseGithubRepo,
  tokenScopes,
} from "../../src/lib/github-repo-ref";

// ---- parsing -------------------------------------------------------------

const PARSES: Array<[string, string | null]> = [
  ["https://github.com/bitbaum/loki", "bitbaum/loki"],
  ["https://github.com/bitbaum/loki.git", "bitbaum/loki"],
  ["http://github.com/bitbaum/loki", "bitbaum/loki"],
  ["https://www.github.com/bitbaum/loki", "bitbaum/loki"],
  ["github.com/bitbaum/loki", "bitbaum/loki"],
  ["git@github.com:bitbaum/loki.git", "bitbaum/loki"],
  ["  https://github.com/bitbaum/loki  ", "bitbaum/loki"],
  // A deep link still identifies the repo — take the first two segments.
  ["https://github.com/bitbaum/loki/tree/main/src", "bitbaum/loki"],
  ["https://github.com/bitbaum/loki?tab=readme", "bitbaum/loki"],
  // A dot in the name is legal and appears in production (one-shot.slop).
  ["https://github.com/bitbaum/one-shot.slop-the-machine", "bitbaum/one-shot.slop-the-machine"],
  // Not GitHub, not this checker's business.
  ["https://gitlab.com/bitbaum/loki", null],
  ["https://git.example.com/bitbaum/loki", null],
  ["", null],
  ["   ", null],
  ["not a url", null],
];

for (const [input, expected] of PARSES) {
  const got = parseGithubRepo(input);
  assert.equal(
    got?.slug ?? null,
    expected,
    `parseGithubRepo(${JSON.stringify(input)}) → ${got?.slug ?? null}, expected ${expected}`,
  );
}
assert.equal(parseGithubRepo(null), null);
assert.equal(parseGithubRepo(undefined), null);

// ---- statuses ------------------------------------------------------------

async function main(): Promise<void> {
  const ref = { owner: "bitbaum", repo: "loki", slug: "bitbaum/loki" };
  const realFetch = globalThis.fetch;

  async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
    globalThis.fetch = impl;
    try {
      return await fn();
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const ok = await withFetch(
    async () => json(200, { full_name: "bitbaum/loki" }),
    () => checkRepo(ref, "t"),
  );
  assert.equal(ok.state, "ok");

  const moved = await withFetch(
    async () => json(200, { full_name: "bitbaum/renamed" }),
    () => checkRepo(ref, "t"),
  );
  assert.equal(moved.state, "moved");
  assert.equal(moved.state === "moved" && moved.newSlug, "bitbaum/renamed");

  // Case alone is not a move — GitHub is case-insensitive about owner/repo, and
  // healing on case would rewrite rows forever without changing anything.
  const sameButCased = await withFetch(
    async () => json(200, { full_name: "BitBaum/Loki" }),
    () => checkRepo(ref, "t"),
  );
  assert.equal(sameButCased.state, "ok");

  const gone = await withFetch(
    async () => json(404, { message: "Not Found" }),
    () => checkRepo(ref, "t"),
  );
  assert.equal(gone.state, "gone");

  // A dead or rate-limited token is NOT a verdict about the repo.
  for (const status of [401, 403, 500, 502]) {
    const res = await withFetch(
      async () => json(status, { message: "nope" }),
      () => checkRepo(ref, "t"),
    );
    assert.equal(res.state, "unchecked", `HTTP ${status} must be unchecked, got ${res.state}`);
  }

  // Neither is a network failure.
  const threw = await withFetch(
    async () => {
      throw new Error("ECONNRESET");
    },
    () => checkRepo(ref, "t"),
  );
  assert.equal(threw.state, "unchecked");

  // A 200 with no full_name cannot be read as healthy either.
  const malformed = await withFetch(
    async () => json(200, { nope: true }),
    () => checkRepo(ref, "t"),
  );
  assert.equal(malformed.state, "unchecked");

  // A 404 only means "deleted" if the token could have seen a private repo.
  // Without the `repo` scope the two responses are identical, and calling that
  // "gone" would raise an alarm on every healthy private project.
  const goneButBlind = await withFetch(
    async () => json(404, { message: "Not Found" }),
    () => checkRepo(ref, "t", false),
  );
  assert.equal(goneButBlind.state, "unchecked");

  // Scope reading, and what it licenses.
  const scoped = await withFetch(
    async () =>
      new Response("{}", { status: 200, headers: { "x-oauth-scopes": "repo, user, gist" } }),
    () => tokenScopes("t"),
  );
  assert.deepEqual(scoped, ["repo", "user", "gist"]);
  assert.equal(canSeePrivateRepos(scoped), true);

  const signInOnly = await withFetch(
    async () =>
      new Response("{}", { status: 200, headers: { "x-oauth-scopes": "read:user, user:email" } }),
    () => tokenScopes("t"),
  );
  assert.equal(canSeePrivateRepos(signInOnly), false);

  // No header at all, or a failed call, is not permission to trust a 404.
  const noHeader = await withFetch(
    async () => new Response("{}", { status: 200 }),
    () => tokenScopes("t"),
  );
  assert.equal(noHeader, null);
  assert.equal(canSeePrivateRepos(null), false);

  console.log(
    `✓ github repo ref: ${PARSES.length} url form(s) parsed, ` +
      `moved/gone/unchecked kept distinct, and a 404 is only "gone" when the ` +
      `token could have seen a private repo`,
  );
}

void main();
