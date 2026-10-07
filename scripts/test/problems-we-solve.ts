/**
 * The homepage's "What it solves" cards must stay true and reachable.
 *
 * Each card links a visitor to the page where the thing it describes happens.
 * These checks keep that link real — every href is a public page that exists,
 * or a section of /how-it-works that exists, or sign-up — and keep the copy
 * on the honest side of the line: nothing that has not shipped, nothing that
 * suggests Loki renders media itself (that is OrangeCat's Studio), and no
 * agent acting in the real world without the owner.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PROBLEMS_SECTION, PROBLEM_SCALES } from "../../src/config/problems-we-solve";
import { HOW_DEEP, HOW_SHORT } from "../../src/config/how-it-works";
import { ROUTES } from "../../src/config/auth";
import { publicPagePaths } from "../../src/lib/public-pages";

const items = PROBLEM_SCALES.flatMap((scale) => scale.items);

// A person's problems AND society's, each with something to show.
assert.deepEqual(
  PROBLEM_SCALES.map((s) => s.id),
  ["you", "everyone"],
);
for (const scale of PROBLEM_SCALES) {
  assert.ok(scale.items.length >= 3, `${scale.id}: too few cards to say anything`);
  assert.ok(scale.items.length <= 9, `${scale.id}: a wall of cards is not clear`);
}

const ids = items.map((i) => i.id);
assert.equal(new Set(ids).size, ids.length, "card ids must be unique");

const howIds = new Set([...HOW_SHORT, ...HOW_DEEP].map((s) => s.id));
const publicPaths = new Set(publicPagePaths());
for (const item of items) {
  const { href, label } = item.link;
  assert.ok(label.trim().length > 0, `${item.id}: link has no label`);
  assert.ok(href.startsWith("/"), `${item.id}: ${href} must be a same-site path`);
  const [path, anchor] = href.split("#");
  if (path === "/how-it-works") {
    assert.ok(anchor && howIds.has(anchor), `${item.id}: /how-it-works has no section #${anchor}`);
    continue;
  }
  assert.equal(anchor, undefined, `${item.id}: only /how-it-works anchors are checked`);
  // A signed-out visitor must be able to follow it: a public page or sign-up.
  assert.ok(
    path === ROUTES.SIGN_UP || publicPaths.has(path),
    `${item.id}: ${path} is not a public page a visitor can open`,
  );
  assert.ok(existsSync(`src/app${path}/page.tsx`), `${item.id}: ${path} has no page`);
}

const copy = [
  PROBLEMS_SECTION.title,
  PROBLEMS_SECTION.lede,
  PROBLEMS_SECTION.closer.text,
  PROBLEMS_SECTION.closer.note,
  ...items.flatMap((i) => [i.problem, i.solution, i.link.label]),
].join("\n");

const FORBIDDEN: [RegExp, string][] = [
  [/coming soon|soon\b|will be able|planned|roadmap|in the future/i, "roadmap stated as live"],
  [/\b(video|music|song|film|artwork)s?\b/i, "Loki does not render media (ORANGECAT_CAPABILITIES)"],
  [/encrypt/i, "nothing here is end-to-end encrypted"],
  [/\blocal models?\b|offline model/i, "there is no local-model path yet"],
  [/\bLive\b/, "fleet rule: nothing is Live, everything is beta"],
  [
    /on (its|their) own,? without (you|asking)|without your (ok|approval)/i,
    "agents act only with the owner",
  ],
];
for (const [re, why] of FORBIDDEN) {
  const hit = copy.match(re);
  assert.equal(hit, null, `"${hit?.[0]}" in What it solves — ${why}`);
}

console.log(`problems-we-solve: ok (${items.length} cards)`);
