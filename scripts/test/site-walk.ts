/**
 * A walk through a live site (src/lib/site-walk.ts): the QA half of Cat Bot.
 *
 * Pinned here: what counts as a failed page is a fact a person can check
 * (did not load, words missing, sideways scroll on a phone, a broken
 * picture); a walk is a few pages, never a crawl; a slow page is reported and
 * the walk moves on; and the door is the signed rail with a linked account.
 *
 * Run: npx tsx scripts/test/site-walk.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WALK_MAX_STEPS, judgePage, parseWalk, runWalk, type PageFacts } from "@/lib/site-walk";

let passed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const good: PageFacts = {
  title: "OrangeCat",
  text: "Welcome to  OrangeCat\nGet started",
  scrollWidth: 390,
  innerWidth: 390,
  brokenImages: [],
};

async function main() {
  console.log("site-walk:");

  await t("a page with its words, no sideways scroll and whole pictures passes", () => {
    assert.deepEqual(judgePage(good, ["welcome to orangecat", "Get started"]), []);
  });
  await t("missing words are named", () => {
    assert.deepEqual(judgePage(good, ["Sign in"]), ["The page does not show “Sign in”."]);
  });
  await t("a sideways scroll on a phone is a failure, with the widths", () => {
    const p = judgePage({ ...good, scrollWidth: 512 }, []);
    assert.equal(p.length, 1);
    assert.match(p[0], /512px wide on a 390px screen/);
  });
  await t("one pixel of rounding is not a sideways scroll", () => {
    assert.deepEqual(judgePage({ ...good, scrollWidth: 391 }, []), []);
  });
  await t("broken pictures are counted and named", () => {
    const p = judgePage(
      { ...good, brokenImages: ["https://x.test/a.png", "https://x.test/b.png"] },
      [],
    );
    assert.match(p[0], /2 pictures did not load: https:\/\/x\.test\/a\.png/);
  });
  await t("an empty page is a failure", () => {
    assert.match(judgePage({ ...good, text: "  \n " }, [])[0], /nothing a visitor can read/);
  });

  await t("a walk needs a page, and takes only a few", () => {
    assert.equal(parseWalk([]).ok, false);
    assert.equal(parseWalk("https://a.test").ok, false);
    const many = Array.from({ length: WALK_MAX_STEPS + 1 }, () => ({ url: "https://a.test" }));
    const r = parseWalk(many);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /at most/);
  });
  await t("only web pages are walked", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url", ""]) {
      assert.equal(parseWalk([{ url }]).ok, false, url);
    }
    const r = parseWalk([{ url: " https://orangecat.ch/discover ", expect: ["Discover", 7, " "] }]);
    assert.ok(r.ok);
    if (r.ok)
      assert.deepEqual(r.steps, [{ url: "https://orangecat.ch/discover", expect: ["Discover"] }]);
  });

  await t("a page that does not load is said with the reason, and the walk goes on", async () => {
    const open = (async (url: string, _o: unknown, run: (live: never) => Promise<unknown>) => {
      if (url.includes("down")) return { ok: false, reason: "did-not-load", detail: "HTTP 502" };
      void run;
      return { ok: true, value: { title: "Up", problems: [], screenshot: undefined } };
    }) as never;
    const r = await runWalk(
      [
        { url: "https://down.test/", expect: [] },
        { url: "https://up.test/", expect: [] },
      ],
      { open },
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.steps[0].problems, ["The page did not load (HTTP 502)."]);
    assert.equal(r.steps[1].ok, true);
  });
  await t("a page slower than its deadline is reported, not waited for", async () => {
    const open = (() => new Promise(() => undefined)) as never;
    const r = await runWalk([{ url: "https://slow.test/", expect: [] }], { open, deadlineMs: 30 });
    assert.equal(r.steps[0].ok, false);
    assert.match(r.steps[0].problems[0], /not ready after/);
  });
  await t("a browser that throws is a failed page, never a thrown walk", async () => {
    const open = (async () => {
      throw new Error("browser closed");
    }) as never;
    const r = await runWalk([{ url: "https://a.test/", expect: [] }], { open });
    assert.match(r.steps[0].problems[0], /could not be read \(browser closed\)/);
  });

  const route = readFileSync("src/app/api/orangecat/site-walk/route.ts", "utf8");
  await t("the door is the signed rail, fresh, for a linked account", () => {
    assert.match(route, /readSignedOrangeCatBody\(/);
    assert.match(route, /isFreshIssuedAt\(/);
    assert.match(route, /getUserByOrangeCatActorId\(/);
    assert.ok(route.indexOf("getUserByOrangeCatActorId(") < route.indexOf("runWalk("));
  });
  const lib = readFileSync("src/lib/site-walk.ts", "utf8");
  await t("the browser is Loki's guarded one, never a second launcher", () => {
    assert.match(lib, /withLivePage/);
    assert.doesNotMatch(lib, /chromium\.launch/);
  });

  console.log(`  ${passed} passed`);
}
void main();
