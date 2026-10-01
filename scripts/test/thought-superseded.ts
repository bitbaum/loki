/**
 * Essays that describe a replaced architecture say so, dated, on the page.
 *
 * Thirteen May–August essays describe the zellij worker, the standalone Brain
 * on :3001, the Neon/Vercel stack or the Groq dispatch router as if they were
 * live. They are fine as history; they were not marked as history. This pins:
 *
 *   1. the pure notice — month from publishedAt, internal paths only;
 *   2. the rendered sentence a reader actually sees;
 *   3. the essays: any essay that still names zellij / the Brain / Neon /
 *      Vercel as much as it did carries `supersededBy:`, and every
 *      `supersededBy:` points at a public page that exists.
 *
 * Run: npx tsx scripts/test/thought-superseded.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { monthOf, supersededNotice } from "@/lib/thought-superseded";
import { listThoughts } from "@/lib/thoughts-content";
import { SupersededNotice } from "@/components/thoughts/SupersededNotice";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("thought-superseded:");

check("month is read from publishedAt", () => {
  assert.equal(monthOf("2026-06-04"), "June 2026");
  assert.equal(monthOf("2026-12-31"), "December 2026");
  assert.equal(monthOf("2026-13-01"), null);
  assert.equal(monthOf("June 2026"), null);
});

check("no supersededBy → no notice", () => {
  assert.equal(supersededNotice({ publishedAt: "2026-06-04" }), null);
  assert.equal(supersededNotice({ publishedAt: "2026-06-04", supersededBy: "  " }), null);
});

check("only internal paths are accepted", () => {
  assert.equal(
    supersededNotice({ publishedAt: "2026-06-04", supersededBy: "https://example.com" }),
    null,
  );
  assert.equal(supersededNotice({ publishedAt: "2026-06-04", supersededBy: "//evil.test" }), null);
  assert.deepEqual(supersededNotice({ publishedAt: "2026-06-04", supersededBy: "/whitepaper" }), {
    asOf: "June 2026",
    href: "/whitepaper",
  });
});

check("the reader sees the dated sentence and the link", () => {
  const html = renderToStaticMarkup(
    createElement(SupersededNotice, { notice: { asOf: "June 2026", href: "/whitepaper" } }),
  );
  assert.match(html, /This describes Loki as it was in June 2026\./);
  assert.match(html, /For how it works today, see/);
  assert.match(html, /href="\/whitepaper"/);
});

check("the essay page renders the notice", () => {
  const page = readFileSync(
    new URL("../../src/app/thoughts/[slug]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /supersededNotice\(article\)/);
  assert.match(page, /<SupersededNotice notice=\{superseded\}/);
});

const essays = listThoughts();
// Names of retired architecture. Counted, not just matched: an essay that
// mentions zellij once in passing is not a description of it. Case-sensitive
// on purpose — "the Brain" was a process; "the brain" (a model) is a metaphor.
const RETIRED = /[Zz]ellij|\bBrain\b|:3001|\bNeon\b|\bVercel\b/g;
const HEAVY = 7;

check("every essay that describes the retired stack is marked", () => {
  const unmarked = essays
    .map((e) => ({ slug: e.slug, n: (e.body.match(RETIRED) ?? []).length, by: e.supersededBy }))
    .filter((e) => e.n >= HEAVY && !e.by)
    .map((e) => `${e.slug} (${e.n})`);
  assert.deepEqual(unmarked, [], `unmarked: ${unmarked.join(", ")}`);
});

check("every supersededBy resolves to a notice and an existing page", () => {
  const marked = essays.filter((e) => e.supersededBy);
  assert.ok(marked.length >= 13, `expected the 13 marked essays, found ${marked.length}`);
  for (const e of marked) {
    const notice = supersededNotice(e);
    assert.ok(notice, `${e.slug}: supersededBy "${e.supersededBy}" yields no notice`);
    const route = new URL(`../../src/app${notice.href}/page.tsx`, import.meta.url);
    assert.ok(existsSync(route), `${e.slug}: ${notice.href} is not a page`);
  }
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
