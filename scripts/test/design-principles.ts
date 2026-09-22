/**
 * The design principles are enforced, not merely written down.
 *
 * globals.css holds the tokens AND (since 2026-09-22) the grammar for using
 * them. A grammar nobody checks is a comment; these are the parts that can be
 * checked mechanically.
 *
 * George, 2026-09-22: "I thought our design was centralized and all pages
 * would be elonesque, including principles." The tokens WERE centralized —
 * sixteen arbitrary values across the whole component tree, which is
 * disciplined for a product this size. What was missing was any rule about how
 * to compose them, so
 * each page invented its own density, its own use of colour, its own row
 * shape, and the product stopped looking like one product.
 *
 * WHAT THIS CANNOT DO: judge whether a page looks good. It ratchets the
 * measurable parts — arbitrary values, the principles surviving in the file —
 * so the gap between the stated design and the shipped one cannot widen while
 * nobody is looking.
 *
 * Run: npx tsx scripts/test/design-principles.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const CSS = join(ROOT, "src/app/globals.css");
const css = readFileSync(CSS, "utf8");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Arbitrary Tailwind values in component markup: `text-[13px]`, `min-h-[4.25rem]`,
 * `w-[247px]`. Each one is a decision made outside the design system, which is
 * how a system becomes a suggestion.
 *
 * BASELINE, not zero. SIXTEEN existed when this gate was written — an earlier
 * count of "nine" came from a narrower pattern that missed z-, max-w- and
 * gap-; the number quoted to a human should be the one the gate measures.
 * The rule is that it may FALL or HOLD, never rise. Demanding zero immediately
 * would mean a sweeping refactor in the same change that introduces the rule,
 * and a gate nobody can pass gets deleted.
 */
const ARBITRARY_BASELINE = 16;
const ARBITRARY =
  /\b(?:text|min-h|max-h|h|w|min-w|max-w|gap|p[xytrbl]?|m[xytrbl]?|top|left|right|bottom|z)-\[[^\]]+\]/g;

console.log("design-principles:");

check("THE GRAMMAR EXISTS: principles are stated in globals.css", () => {
  assert(css.includes("DESIGN PRINCIPLES"), "the principles block is gone from globals.css");
  // Each principle is load-bearing; losing one silently is how the grammar
  // erodes back into a palette.
  for (const phrase of [
    "TYPE DOES THE WORK",
    "COLOUR IS FOR ALARMS",
    "SPACE SEPARATES",
    "ONE ROW, ONE HEIGHT",
    "COLUMNS ARE FIXED",
    "NO DECORATION",
    "EVERY VALUE COMES FROM A TOKEN",
    "NOTHING CLAIMS MORE THAN IT KNOWS",
  ]) {
    assert(css.includes(phrase), `principle missing from globals.css: ${phrase}`);
  }
});

check("PRINCIPLE 7: arbitrary values never increase", () => {
  const files = walk(join(ROOT, "src/components"));
  const offenders: string[] = [];
  let count = 0;
  for (const file of files) {
    const hits = readFileSync(file, "utf8").match(ARBITRARY) ?? [];
    if (hits.length > 0) {
      count += hits.length;
      offenders.push(`${file.replace(ROOT + "/", "")}: ${hits.join(", ")}`);
    }
  }
  assert(
    count <= ARBITRARY_BASELINE,
    `arbitrary values rose to ${count} (baseline ${ARBITRARY_BASELINE}). ` +
      `Add the value to globals.css and name it instead:\n    ${offenders.join("\n    ")}`,
  );
  // Ratchet: when the count falls, the baseline must come down with it, or the
  // gate quietly re-permits what was just cleaned up.
  assert(
    count >= ARBITRARY_BASELINE - 2 || count === 0,
    `arbitrary values fell to ${count} — lower ARBITRARY_BASELINE to ${count} in this file so the ground gained is held`,
  );
});

check("PRINCIPLE 5: the project rail is fixed-width and tabular", () => {
  // The measured failure that produced this principle: 37px of horizontal
  // jitter across 25 rows because every cell was content-sized.
  const at = css.indexOf(".ui-projects-rail {");
  assert(at !== -1, "the project rail is gone");
  const block = css.slice(at, css.indexOf("}", at));
  assert(
    block.includes("tabular-nums"),
    "the rail's numbers are not tabular — columns will shiver",
  );
  for (const cell of ["stage", "flags", "health", "run"]) {
    const cellAt = css.indexOf(`.ui-projects-rail-${cell} {`);
    assert(cellAt !== -1, `rail cell missing: ${cell}`);
    const cellBlock = css.slice(cellAt, css.indexOf("}", cellAt));
    assert(
      /\bw-\d/.test(cellBlock),
      `rail cell "${cell}" has no fixed width, so the column edge will wobble: ${cellBlock.replace(/\s+/g, " ")}`,
    );
  }
});

check("PRINCIPLE 4: the project row has one height", () => {
  const at = css.indexOf(".ui-projects-row {");
  const block = css.slice(at, css.indexOf("}", at));
  assert(/min-h-\d/.test(block), "the row has no minimum height — content will set it");
});

check("PRINCIPLE 2: the row spends colour only on alarms", () => {
  const row = readFileSync(join(ROOT, "src/components/projects/ProjectRow.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // status-warning is the flag/blocked colour and is allowed. Anything else
  // tinted means the row is competing with its own alarm.
  const colours = row.match(/text-status-\w+|bg-status-\w+|text-accent-\w+|bg-accent-\w+/g) ?? [];
  const notAlarm = colours.filter((c) => !c.includes("warning"));
  assert(
    notAlarm.length === 0,
    `the row uses non-alarm colour, which drowns the alarm: ${[...new Set(notAlarm)].join(", ")}`,
  );
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
