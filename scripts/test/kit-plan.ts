/**
 * The kickoff's "Built from" plan (src/lib/kit-plan, src/config/kit-plan.ts).
 *
 * What is pinned, and why each matters:
 *   1. Realistic briefs plan the packages a person would expect — a bakery
 *      shop, a consultancy with booking, a community forum — and a "no X" in
 *      the brief plans no X. The plan is deterministic, so it is pinned exactly.
 *   2. The plan follows the live catalogue: a package fleet retired is never
 *      planned, a new one is one config entry, and a config key the catalogue
 *      does not know is a typo this test refuses.
 *   3. The block reaches the first build's prompt with the catalogue's install
 *      line, the "do not write your own" instruction, and inside its budget.
 *   4. Client work — and only client work — is told to swap the fleet's tokens
 *      for the client's, following the starter's own instruction.
 *   5. Kit coverage (planned vs observed after the first build) computes.
 *
 * Pure: no network, no database. Run: npx tsx scripts/test/kit-plan.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIT_FEATURES,
  KIT_PLAN_BLOCK_MAX_CHARS,
  FIRST_BUILD_SETTLE_MS,
} from "../../src/config/kit-plan";
import { loadSnapshot, renderFleetBrief } from "../../src/lib/fleet-brief/brief";
import type { CataloguePackage } from "../../src/lib/packages/catalogue-parse";
import {
  briefMentions,
  foldBriefText,
  kitPlanSentence,
  planKits,
  toKitPlanRecord,
} from "../../src/lib/kit-plan/plan";
import {
  kitBriefText,
  starterPackages,
  startsFromFleetStarter,
} from "../../src/lib/kit-plan/brief";
import {
  CLIENT_TOKENS_BLOCK,
  KIT_PLAN_HEADING,
  renderKickoffKitBlocks,
  renderKitPlanBlock,
} from "../../src/lib/kit-plan/prompt";
import { kitCoverage, shouldRecordObserved } from "../../src/lib/kit-plan/coverage";
import { composeDispatchPrompt } from "../../src/lib/project-dispatch-prompt";
import { STARTER_APP_FILES } from "../../src/lib/starter-app.generated";
import type { ProjectDossier } from "../../src/db/queries/project-dossier";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
}

const snapshot = loadSnapshot();
const catalogue = snapshot.catalogue;
const starter = starterPackages();
const plan = (brief: string, cat: readonly CataloguePackage[] = catalogue) =>
  planKits(brief, cat, { starterPackages: starter, selfSlug: "brot-und-butter" });
const names = (brief: string) => plan(brief).kits.map((k) => k.name);

const BAKERY =
  "Brot & Butter is a small bakery in Zürich. Customers browse today's bread and pastries, order online for pick-up at a time they choose, and pay with Twint. They get an email confirmation. A search box helps them find a product. Staff sign in to change the products and prices.";
const CONSULTANCY =
  "Alpine Advisory is the site of a two-person strategy consultancy. Visitors read about our services and case studies and book an appointment for a free first call. The contact form sends us an email. We publish articles on a blog. No user accounts.";
const FORUM =
  "Imkerforum: a community forum for Swiss beekeepers. Members sign in, start discussions, comment on threads and chat live with each other. They can search old threads. A map shows hives by canton. No payments.";

console.log("kit plan");

// ── 1. realistic briefs ──────────────────────────────────────────────────────
check("a bakery shop: sign-in, search, lists, payments, pick-up times, email", () => {
  assert.deepEqual(names(BAKERY), [
    "@bitbaum/accountkit",
    "@bitbaum/searchkit",
    "listkit",
    "@bitbaum/paykit",
    "@bitbaum/whenkit",
    "@bitbaum/mail-kit",
  ]);
  const paykit = plan(BAKERY).kits.find((k) => k.name === "@bitbaum/paykit");
  assert.deepEqual(paykit?.because, ["pay", "order online", "twint"], "says why it is planned");
});

check("a consultancy with booking: dates, email, forms, spam protection, blog — no sign-in", () => {
  assert.deepEqual(names(CONSULTANCY), [
    "@bitbaum/whenkit",
    "@bitbaum/mail-kit",
    "ai-forms",
    "limitkit",
    "bip-kit",
  ]);
});

check("a community forum with chat: sign-in, search, chat, threads, map — no payments", () => {
  assert.deepEqual(names(FORUM), [
    "@bitbaum/accountkit",
    "@bitbaum/searchkit",
    "@bitbaum/chatkit",
    "threadkit",
    "@bitbaum/geo-kit",
  ]);
});

check("negation reaches its own clause only", () => {
  const f = foldBriefText("No ads, but search the shop. Without accounts. We take payments.");
  assert.equal(briefMentions(f, "search"), true, "'but' ends the negation");
  assert.equal(briefMentions(f, "accounts"), false, "'without accounts' plans none");
  assert.equal(briefMentions(f, "payment"), true, "a later sentence is not negated");
  assert.equal(briefMentions(foldBriefText("We don't need a login"), "login"), false);
  assert.equal(briefMentions(foldBriefText("Réservation en ligne"), "reservation"), true);
});

check("whole words only — 'research' is not search, 'platform' is not a form", () => {
  assert.deepEqual(
    names("Research platform information for teams, take everything into account"),
    [],
  );
});

check("the brief is description + what-it-does fields + milestones, never the market", () => {
  const text = kitBriefText({
    description: "A bakery.",
    attrs: { solution: "Order online", competitors: "Their shop has live chat", stack: "Unknown" },
    goals: [{ title: "Search", description: "Find bread by name" }],
  });
  assert.match(text, /Order online/);
  assert.match(text, /Find bread by name/);
  assert.doesNotMatch(text, /live chat/, "competitors are not a request");
  assert.doesNotMatch(text, /Unknown/, "placeholders are not briefs");
});

check("the plain sentence names the parts in the owner's words", () => {
  assert.equal(
    kitPlanSentence(plan(FORUM)),
    `Your site will use sign-in, search, chat, discussions and maps — parts already running on ${plan(FORUM).sharedWith} other sites, kept up to date automatically.`,
  );
  assert.ok(plan(FORUM).sharedWith > 0);
  assert.equal(kitPlanSentence({ kits: [], sharedWith: 0 }), null);
});

check("'other sites' counts sites, not packages, and never the site itself", () => {
  const cat: CataloguePackage[] = catalogue.map((p) =>
    p.name === "@bitbaum/searchkit"
      ? { ...p, adopterNames: ["brot-und-butter", "listkit", "heidi", "evig"] }
      : { ...p, adopterNames: [] },
  );
  assert.equal(plan("A search box.", cat).sharedWith, 2);
});

// ── 2. the catalogue decides what exists ─────────────────────────────────────
check("every configured package is one the catalogue lists (a typo plans nothing)", () => {
  const known = new Set(catalogue.map((p) => p.name));
  for (const name of Object.keys(KIT_FEATURES))
    assert.ok(known.has(name), `${name} is not in the catalogue`);
});

check("a package fleet retired is dropped from the plan", () => {
  const retired = catalogue.filter((p) => p.name !== "@bitbaum/searchkit");
  assert.ok(!plan(BAKERY, retired).kits.some((k) => k.name === "@bitbaum/searchkit"));
  assert.ok(plan(BAKERY, retired).kits.some((k) => k.name === "@bitbaum/paykit"));
});

check("a new package is one config entry", () => {
  const cat = [
    ...catalogue,
    { ...catalogue[0]!, slug: "invoicekit", name: "invoicekit", install: "pnpm add invoicekit" },
  ];
  const features = {
    ...KIT_FEATURES,
    invoicekit: {
      plain: "invoices",
      use: "invoices",
      avoid: "invoice PDFs",
      triggers: ["invoice"],
    },
  };
  const p = planKits("We send an invoice after each order.", cat, { features });
  assert.deepEqual(
    p.kits.map((k) => [k.name, k.install]),
    [["invoicekit", "pnpm add invoicekit"]],
  );
});

check("'already in the starter' is read from the starter the kickoff seeds", () => {
  const pkg = JSON.parse(STARTER_APP_FILES["package.json"]!) as { dependencies: object };
  for (const name of Object.keys(pkg.dependencies)) assert.ok(starter.has(name), name);
  assert.ok(starter.has("@bitbaum/mail-kit"));
  assert.ok(!starter.has("@bitbaum/searchkit"));
  const mail = plan(BAKERY).kits.find((k) => k.name === "@bitbaum/mail-kit")!;
  assert.equal(mail.inStarter, true);
});

check("a plan applies to sites seeded from the fleet starter only", () => {
  assert.equal(startsFromFleetStarter({ name: "bakery", stack: null }), true);
  assert.equal(startsFromFleetStarter({ name: "bakery", stack: "Next.js + Postgres" }), true);
  assert.equal(startsFromFleetStarter({ name: "api", stack: "Python, FastAPI" }), false);
  assert.equal(
    startsFromFleetStarter({ name: "my-ghost", stack: null, briefKind: "repo-copy" }),
    false,
    "a copy of an open-source repository brings its own code",
  );
});

// ── 3. the prompt block ──────────────────────────────────────────────────────
check("the block names install lines from the catalogue and what not to write", () => {
  const block = renderKitPlanBlock(plan(BAKERY));
  assert.ok(block.startsWith(KIT_PLAN_HEADING));
  const searchkit = catalogue.find((p) => p.name === "@bitbaum/searchkit")!;
  assert.ok(block.includes(`Install: ${searchkit.install}.`));
  assert.match(block, /search: @bitbaum\/searchkit, for the search box/);
  assert.match(block, /Do not write your own search or fuzzy matching\./);
  assert.match(block, /email: @bitbaum\/mail-kit, for .*Already in the starter\./);
  assert.equal(renderKitPlanBlock({ kits: [], sharedWith: 0 }), "");
});

check("the block stays inside its budget even when a brief asks for everything", () => {
  const everything = Object.values(KIT_FEATURES)
    .map((f) => f.triggers[0])
    .join(". ");
  const p = plan(everything);
  assert.equal(p.kits.length, Object.keys(KIT_FEATURES).length, "every package planned");
  const block = renderKitPlanBlock(p);
  assert.ok(block.length <= KIT_PLAN_BLOCK_MAX_CHARS, `block is ${block.length} chars`);
  assert.match(block, /Also planned, see fleet SHARED\.md for each: /, "says what it left out");
  // A realistic plan is never cut.
  assert.doesNotMatch(renderKitPlanBlock(plan(BAKERY)), /Also planned/);
});

check("fleet brief + plan + client block together stay a brief, not a dump", () => {
  const brief = renderFleetBrief({
    packages: snapshot.packages,
    stack: snapshot.stack,
    source: { packages: "snapshot", stack: "snapshot" },
    registerGeneratedAt: snapshot.registerGeneratedAt,
  });
  const kit = renderKickoffKitBlocks(plan(BAKERY), { clientTokens: true });
  assert.ok(brief.length + kit.length < 8_000, `${brief.length} + ${kit.length} chars`);
});

const T0 = new Date("2026-10-14T09:00:00Z");
function dossier(): ProjectDossier {
  return {
    detail: {
      project: { name: "brot-und-butter", description: BAKERY },
      attrs: {},
      linkedGoals: [{ title: "Shop", description: null, progress: 0, createdAt: T0 }],
      devLog: [],
    },
    runs: [],
  } as unknown as ProjectDossier;
}

check("the kickoff prompt carries the block before the run's target", () => {
  const builtFrom = renderKickoffKitBlocks(plan(BAKERY), { clientTokens: false });
  const prompt = composeDispatchPrompt("kickoff", undefined, dossier(), { builtFrom }).prompt!;
  assert.ok(prompt.includes(KIT_PLAN_HEADING));
  assert.ok(prompt.indexOf(KIT_PLAN_HEADING) < prompt.indexOf("YOUR TARGET THIS RUN"));
  assert.ok(!prompt.includes("CLIENT WORK"), "our own site keeps our tokens");
  const without = composeDispatchPrompt("kickoff", undefined, dossier()).prompt!;
  assert.ok(!without.includes(KIT_PLAN_HEADING), "no plan, no block");
});

check("the dispatch step renders the plan into the kickoff (not another kind)", () => {
  const steps = readFileSync("src/lib/kickoff/steps.ts", "utf8");
  assert.match(steps, /input\.kind === "kickoff"\s*\?\s*await kitPlanForProject\(/);
  assert.match(steps, /builtFrom: kit\?\.applies \? renderKickoffKitBlocks\(kit\.plan, kit\)/);
  assert.match(steps, /recordKitPlan\(/);
});

// ── 4. client work wears the client's tokens ─────────────────────────────────
check("client work is told to swap the fleet's tokens, keeping their structure", () => {
  const block = renderKickoffKitBlocks(plan(BAKERY), { clientTokens: true });
  assert.ok(block.endsWith(CLIENT_TOKENS_BLOCK));
  assert.match(CLIENT_TOKENS_BLOCK, /Keep the token STRUCTURE and replace the VALUES/);
  assert.match(CLIENT_TOKENS_BLOCK, /@import "@bitbaum\/design-tokens\/tokens\.css"/);
  assert.match(CLIENT_TOKENS_BLOCK, /tailwind-preset/);
  assert.match(CLIENT_TOKENS_BLOCK, /remove @bitbaum\/design-tokens from package\.json/);
  // The instruction follows the starter's own: the files and names it names exist there.
  const css = STARTER_APP_FILES["app/globals.css"]!;
  const tw = STARTER_APP_FILES["tailwind.config.mjs"]!;
  assert.ok(css.includes('@import "@bitbaum/design-tokens/tokens.css"'));
  assert.ok(tw.includes("@bitbaum/design-tokens/tailwind-preset"));
  assert.match(tw, /CLIENT-owned app must not keep this preset/);
  for (const name of [
    "bg-surface-page",
    "text-fg-primary",
    "bg-accent",
    "text-on-accent",
    "font-display",
  ]) {
    assert.ok(tw.includes(name), `${name} is a name the starter's preset maps`);
  }
  // A client brief with nothing to plan still gets the tokens instruction.
  assert.equal(
    renderKickoffKitBlocks({ kits: [], sharedWith: 0 }, { clientTokens: true }),
    CLIENT_TOKENS_BLOCK,
  );
  const prompt = composeDispatchPrompt("kickoff", undefined, dossier(), {
    builtFrom: block,
  }).prompt!;
  assert.ok(prompt.includes("CLIENT WORK"));
});

// ── 5. coverage ──────────────────────────────────────────────────────────────
check("the stored plan keeps names, slugs and the words the owner saw", () => {
  const record = toKitPlanRecord(plan(FORUM), { clientTokens: false, at: T0 });
  assert.equal(record.plannedAt, T0.toISOString());
  assert.deepEqual(record.kits[0], {
    name: "@bitbaum/accountkit",
    slug: "accountkit",
    plain: "sign-in",
  });
});

check("coverage: planned vs installed after the first build", () => {
  const c = kitCoverage(
    ["@bitbaum/searchkit", "@bitbaum/paykit", "@bitbaum/mail-kit"],
    ["@bitbaum/mail-kit", "@bitbaum/searchkit", "@bitbaum/ai-kit"],
  );
  assert.deepEqual(c.covered, ["@bitbaum/searchkit", "@bitbaum/mail-kit"]);
  assert.deepEqual(c.missing, ["@bitbaum/paykit"]);
  assert.deepEqual(c.unplanned, ["@bitbaum/ai-kit"]);
  assert.equal(c.ratio, 2 / 3);
  assert.equal(kitCoverage([], ["x"]).ratio, null);
});

check("observed is frozen once, after the build has had time to land", () => {
  const record = { planned: ["@bitbaum/searchkit"] };
  const done = new Date(T0.getTime());
  const late = { scannedAt: new Date(T0.getTime() + FIRST_BUILD_SETTLE_MS), outcome: "ok" };
  assert.equal(shouldRecordObserved({ record, runFinishedAt: done, scan: late }), true);
  const early = { ...late, scannedAt: new Date(T0.getTime() + 60_000) };
  assert.equal(shouldRecordObserved({ record, runFinishedAt: done, scan: early }), false);
  assert.equal(
    shouldRecordObserved({ record, runFinishedAt: null, scan: late }),
    false,
    "still running",
  );
  assert.equal(
    shouldRecordObserved({ record: { ...record, observed: [] }, runFinishedAt: done, scan: late }),
    false,
    "already recorded",
  );
  assert.equal(
    shouldRecordObserved({
      record,
      runFinishedAt: done,
      scan: { ...late, outcome: "unreachable" },
    }),
    false,
    "a failed read observes nothing",
  );
});

console.log(`\n${passed} passed`);
