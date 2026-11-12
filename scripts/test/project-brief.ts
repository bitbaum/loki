/**
 * One limit for "what do you want to build?" (config/project-brief).
 *
 * A sentence carried from the homepage (up to 2000 characters) reached a form
 * whose box and route allowed 300, and Create answered "Invalid body". This
 * pins the three places to one number and the repository description to its
 * own shorter one.
 *
 *   npx tsx scripts/test/project-brief.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROJECT_BRIEF_MAX,
  REPO_DESCRIPTION_MAX,
  repoDescription,
} from "../../src/config/project-brief";
import { firstWordsHref } from "../../src/lib/first-words";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

// The route takes what the form sends, and the form takes what the homepage keeps.
const route = read("src/app/api/projects/create-with-github/route.ts");
assert.match(route, /description: z\.string\(\)\.trim\(\)\.max\(PROJECT_BRIEF_MAX\)/);
assert.match(route, /repoDescription\(description\)/);
const page = read("src/app/(app)/control/new-from-scratch/page.tsx");
assert.match(page, /brief: PROJECT_BRIEF_MAX/);
assert.match(page, /maxLength=\{PROJECT_BRIEF_MAX\}/);
assert.doesNotMatch(page, /maxLength=\{300\}/);

// A carried sentence is cut at the same number, never longer than the route takes.
const long = "a".repeat(PROJECT_BRIEF_MAX + 50);
const carried = decodeURIComponent(firstWordsHref(long).split("brief=")[1]);
assert.equal(carried.length, PROJECT_BRIEF_MAX);

// The repository description: whole when it fits, cut at a word otherwise.
assert.equal(repoDescription("A website for my bakery"), "A website for my bakery");
assert.equal(repoDescription("  two\n lines  "), "two lines");
const sentence = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
const short = repoDescription(sentence);
assert.ok(short.length <= REPO_DESCRIPTION_MAX, `${short.length} > ${REPO_DESCRIPTION_MAX}`);
assert.ok(short.endsWith("…"));
assert.ok(
  !/word\d+…$/.test(short) || sentence.includes(short.slice(0, -1)),
  "cut at a word boundary",
);
assert.ok(sentence.startsWith(short.slice(0, -1)));
// One unbroken run is cut hard rather than dropped.
assert.equal(repoDescription("x".repeat(900)).length, REPO_DESCRIPTION_MAX);

console.log(
  "✓ project-brief: one limit for the brief; the repository description is cut at a word",
);
