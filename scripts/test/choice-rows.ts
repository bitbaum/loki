/**
 * A row of choices never wraps on its own terms.
 *
 * Pick-one and on/off rows were built as chips in a `flex flex-wrap` box,
 * each pill as wide as its word, so on a phone they broke wherever the words
 * ran out: "Low · Medium · High · Extra-high" on one line and "Max" alone on
 * the next; "Stay on these versions" alone under two others; four widget
 * corners as 1 / 1 / 2. The owner found them one at a time and asked for
 * the class of mistake to stop (2026-10-19: "every time I find it, I tell you
 * to fix it … and you still keep on making the same mistakes").
 *
 * The shapes that hold at any width:
 *   • pick one of a few → <Segmented> (components/ui/segmented.tsx): equal
 *     cells in one row, or an even grid with `columns`
 *   • many filters → `ui-filter-chip-row`: one line that scrolls on a phone
 *   • on/off settings or long answers → one row each (OptionRow, a list)
 *
 * This fails on a wrapping container whose children are choices (they say
 * aria-pressed / role="radio", or are ui-chip-toggle chips).
 *
 * Run: npx tsx scripts/test/choice-rows.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Wrapping on purpose, and why. */
const ALLOWED: Record<string, string> = {
  "src/components/control/ProjectAutopilotToggle.tsx":
    "one on/off button and the words beside it — not a row of choices",
};

function* tsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* tsx(path);
    else if (path.endsWith(".tsx")) yield path;
  }
}

const CHOICE = /aria-pressed=|role="radio"|ui-chip-toggle/;
const offenders: string[] = [];
for (const file of [...tsx("src/components"), ...tsx("src/app")]) {
  const rel = relative(process.cwd(), file);
  if (ALLOWED[rel]) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (
      !/className="[^"]*\bflex-wrap\b/.test(line) ||
      !/<div\b|<nav\b|<ul\b/.test(lines.slice(Math.max(0, i - 2), i + 1).join("\n"))
    )
      return;
    // The container's own children: the next lines, up to where it closes.
    const body = lines.slice(i + 1, i + 14).join("\n");
    if (CHOICE.test(body)) offenders.push(`${rel}:${i + 1}`);
  });
}
assert.deepEqual(
  offenders,
  [],
  `a row of choices wraps — use <Segmented>, ui-filter-chip-row, or one row each:\n  ${offenders.join("\n  ")}`,
);
console.log("✓ choice-rows: no row of choices wraps on its own terms");
