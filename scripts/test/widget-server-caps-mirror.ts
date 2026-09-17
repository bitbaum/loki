/**
 * The widget must clamp every field to the SAME limit the ingest route enforces.
 *
 * WHY THIS EXISTS
 *
 * `/api/feedback` validates with zod and, on any failure, returns the single
 * string "Invalid submission" naming no field. The widget renders that and the
 * visitor's entire report is gone. So a client that sends one character over a
 * server cap does not degrade — it silently destroys the submission, on the one
 * surface strangers on other people's sites touch.
 *
 * The author clearly knew this: `url` and `pageTitle` were sliced to exactly
 * the route's `.max()`, and MAX_SHOT_CHARS carries the comment "ingest caps the
 * data URL at 600k chars". The pattern was applied to 3 of 5 fields. `contact`
 * (cap 200) and `page` (cap 300) were sent unclamped, and the contact <input>
 * had no maxLength either — so a visitor pasting a signature into
 * "Name / email" lost their report with no explanation.
 *
 * Mirroring by hand is the kind of thing that is right until someone changes
 * one side, so the two files are compared here instead.
 *
 * Run: npx tsx scripts/test/widget-server-caps-mirror.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const route = readFileSync(join(repoRoot, "src/app/api/feedback/route.ts"), "utf8");
// Every widget module, not just main.ts: the clamps live where the field is
// built, and splitting the bundle into modules must not silently drop a check.
const widgetDir = join(repoRoot, "widget");
const widget = readdirSync(widgetDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(join(widgetDir, f), "utf8"))
  .join("\n");

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

/** Server caps, read from the zod schema rather than restated here. */
const caps = new Map<string, number>();
for (const m of route.matchAll(/(\w+):\s*z\s*\.string\(\)([^,\n]*)/g)) {
  const max = m[2].match(/\.max\((\d+)\)/);
  if (max) caps.set(m[1], Number(max[1]));
}
ok(caps.size >= 5, `read server caps from the zod schema (got ${caps.size})`);

/**
 * Fields the widget puts in the request body verbatim. `token` is not here:
 * it is the operator's install token, not visitor input, and cannot be
 * over-length without the install itself being wrong. `suggestion` is capped
 * by the textarea's maxLength rather than a slice, so it is checked that way.
 */
const SLICED_FIELDS = ["contact", "page", "url", "pageTitle"];

for (const field of SLICED_FIELDS) {
  const cap = caps.get(field);
  if (cap == null) {
    ok(false, `server declares a cap for "${field}" (schema changed?)`);
    continue;
  }
  // Accept the clamp anywhere in the widget, since the value may be built a
  // line above the request body.
  const clamped = new RegExp(`slice\\(\\s*0\\s*,\\s*${cap}\\s*\\)`).test(widget);
  ok(clamped, `widget clamps "${field}" to the server's ${cap}`);
}

// The free-text field is capped at the input, not at submit.
const suggestionCap = caps.get("suggestion");
ok(suggestionCap != null, "server declares a cap for suggestion");
if (suggestionCap != null) {
  ok(
    new RegExp(`MAX_LEN\\s*=\\s*${suggestionCap}\\b`).test(widget),
    `widget MAX_LEN matches the server's suggestion cap (${suggestionCap})`,
  );
  ok(/maxLength\s*=\s*MAX_LEN/.test(widget), "the suggestion textarea enforces MAX_LEN");
}

// The contact input is visitor-typed too, so it gets the same treatment.
ok(
  new RegExp(`contact\\.maxLength\\s*=\\s*${caps.get("contact")}\\b`).test(widget),
  `the contact input enforces maxLength ${caps.get("contact")}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
