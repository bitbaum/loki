/**
 * The before-and-after tour of a preview: what the build writes
 * (improvements.json), how Loki reads it, which rows the tour shows, and
 * what the page says — without a server, a browser or a database.
 *
 * Run: npx tsx scripts/test/preview-improvements.ts
 */
import assert from "node:assert/strict";
import { beforeAfterPage } from "@/lib/previews/before-after-page";
import {
  CHANGE_FIELDS,
  beforeAfterPairs,
  fileForPath,
  improvementsInstruction,
  parseImprovements,
  parsePreviewSource,
  walkthroughFrom,
} from "@/lib/previews/improvements";
import { beforeAfterUrl } from "@/config/preview-brief";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const SOURCE = parsePreviewSource(
  JSON.stringify({
    website: "https://center-com.ru/",
    pages: [
      "https://center-com.ru/",
      "https://center-com.ru/o-nas",
      "https://center-com.ru/servisy",
    ],
    createdAt: "2026-10-17T00:00:00.000Z",
  }),
)!;

const WRITTEN = JSON.stringify({
  lang: "ru",
  headline: "Каталог теперь открывается с телефона за секунду.",
  changes: [
    {
      title: "Главная страница",
      livePath: "/",
      newPath: "index.html",
      before: "606 КБ кода до первой картинки.",
      after: "Лёгкая страница, главное — сверху.",
      why: "Покупатели заходят с телефона.",
    },
    {
      title: "О компании",
      livePath: "/o-nas/",
      newPath: "/o-nas/",
      before: "",
      after: "",
      why: "",
    },
    { title: "Чужая страница", livePath: "https://evil.example/x", newPath: "../../etc/passwd" },
    { title: "", livePath: "/empty" },
  ],
  notBroughtOver: ["Личный кабинет — требует доступа к 1С."],
  questions: ["Какие категории главные?"],
  walkthrough: {
    problem: "Страница весила 606 КБ.",
    change: "Собрали статичную версию.",
    considered: ["Оставить Bitrix — слишком тяжёлый", "Только CSS"],
    downsides: "none",
    costs: "nothing",
  },
});

console.log("\nimprovements.json");
check("the instruction names every field the parser reads", () => {
  const text = improvementsInstruction();
  for (const f of CHANGE_FIELDS) assert.ok(text.includes(`"${f.key}"`), f.key);
  assert.ok(text.includes('"walkthrough"') && text.includes('"considered"'));
  assert.ok(text.includes("improvements.json"));
});
check("a written file is read, capped and cleaned", () => {
  const imp = parseImprovements(WRITTEN)!;
  assert.equal(imp.lang, "ru");
  assert.equal(imp.changes.length, 3, "an entry without a title is dropped");
  assert.equal(imp.changes[0].before, "606 КБ кода до первой картинки.");
  assert.equal(imp.notBroughtOver.length, 1);
});
check("junk is not a file", () => {
  assert.equal(parseImprovements("not json"), null);
  assert.equal(parseImprovements("[]"), null);
  assert.equal(parseImprovements(""), null);
  assert.equal(parseImprovements(null), null);
});
check("a shape with a wrong field type still reads", () => {
  const imp = parseImprovements(JSON.stringify({ changes: "nope", headline: 5 }))!;
  assert.deepEqual(imp.changes, []);
});

console.log("\nthe rows of the tour");
check("paths named by the agent become files inside the folder", () => {
  assert.equal(fileForPath("/"), "index.html");
  assert.equal(fileForPath(""), "index.html");
  assert.equal(fileForPath("/o-nas"), "o-nas/index.html");
  assert.equal(fileForPath("o-nas/"), "o-nas/index.html");
  assert.equal(fileForPath("./o-nas.html"), "o-nas.html");
  assert.equal(fileForPath("/kontakt/index.html?x=1#top"), "kontakt/index.html");
  assert.equal(fileForPath("/%D0%BE-%D0%BD%D0%B0%D1%81"), "о-нас/index.html");
});
check("the agent's changes, on the live site only", () => {
  const rows = beforeAfterPairs(SOURCE, parseImprovements(WRITTEN));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].liveUrl, "https://center-com.ru/");
  assert.equal(rows[0].newPath, "index.html");
  assert.equal(rows[1].liveUrl, "https://center-com.ru/o-nas/");
  assert.equal(rows[1].newPath, "o-nas/index.html");
  assert.equal(rows[2].liveUrl, "https://center-com.ru/", "another host falls back to the root");
  assert.equal(
    rows[2].newPath,
    "../../etc/passwd/index.html",
    "resolved by the route, which refuses it",
  );
  assert.ok(rows.every((r) => r.fromAgent));
});
check("no file yet: every page the consultation read, at its own path", () => {
  const rows = beforeAfterPairs(SOURCE, null);
  assert.deepEqual(
    rows.map((r) => [r.title, r.newPath, r.fromAgent]),
    [
      ["The homepage", "index.html", false],
      ["o-nas", "o-nas/index.html", false],
      ["servisy", "servisy/index.html", false],
    ],
  );
});
check("a preview built from a name has no before", () => {
  assert.deepEqual(beforeAfterPairs(null, parseImprovements(WRITTEN)), []);
  assert.deepEqual(beforeAfterPairs(null, null), []);
});

console.log("\nthe engineer's account");
check("reads into the same note the pull-request walkthrough uses", () => {
  const note = walkthroughFrom(parseImprovements(WRITTEN))!;
  assert.equal(note.problem, "Страница весила 606 КБ.");
  assert.equal(note.considered.length, 2);
  assert.equal(note.considered[0].option, "Оставить Bitrix");
  assert.equal(note.considered[0].whyNot, "слишком тяжёлый");
  assert.equal(note.downsides, "None");
  assert.equal(note.costs, "None");
});
check("nothing said is no account", () => {
  assert.equal(walkthroughFrom(parseImprovements(JSON.stringify({ changes: [] }))), null);
  assert.equal(walkthroughFrom(null), null);
});

console.log("\nthe page");
check("shows each row with both pictures, both links and the account", () => {
  const imp = parseImprovements(WRITTEN);
  const html = beforeAfterPage({
    name: "center-com",
    website: SOURCE.website,
    pairs: beforeAfterPairs(SOURCE, imp).slice(0, 2),
    improvements: imp,
    walkthrough: walkthroughFrom(imp),
  });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('lang="ru"'));
  assert.ok(html.includes("_loki/picture?side=before&amp;i=0"));
  assert.ok(html.includes("_loki/picture?side=after&amp;i=1"));
  assert.ok(html.includes('href="../o-nas/index.html"'));
  assert.ok(html.includes('href="https://center-com.ru/o-nas/"'));
  assert.ok(html.includes("Каталог теперь открывается"));
  assert.ok(html.includes("The engineer&#39;s account") || html.includes("The engineer's account"));
  assert.ok(html.includes("Личный кабинет"));
  assert.ok(html.includes("None — checked."));
  assert.ok(html.includes('name="robots" content="noindex'));
});
check("agent text is text, never markup", () => {
  const imp = parseImprovements(
    JSON.stringify({ headline: "<script>alert(1)</script>", changes: [{ title: "<b>x</b>" }] }),
  );
  const html = beforeAfterPage({
    name: "<i>n</i>",
    website: "https://x.ch/",
    pairs: beforeAfterPairs(SOURCE, imp),
    improvements: imp,
    walkthrough: null,
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(!html.includes("<i>n</i>"));
});
check("before the build is done, the page says so instead of standing empty", () => {
  const html = beforeAfterPage({
    name: "x",
    website: null,
    pairs: [],
    improvements: null,
    walkthrough: null,
  });
  assert.ok(html.includes("still being built"));
});
check("the tour sits beside the entry page, wherever the preview is served", () => {
  assert.equal(
    beforeAfterUrl("https://center-com.orangecat.ch/"),
    "https://center-com.orangecat.ch/_loki/before-after",
  );
  assert.equal(
    beforeAfterUrl("https://loki.orangecat.ch/p/center-com/index.html"),
    "https://loki.orangecat.ch/p/center-com/_loki/before-after",
  );
});

console.log(`\n${passed} preview-improvements cases passed`);
