/**
 * A size modifier must not repaint a variant.
 *
 * `.ui-btn-xs` carries `text-text-muted` and is defined 59 lines AFTER
 * `.ui-btn-primary`. Same specificity, so CSS source order decides — and the
 * size class won. Every `ui-btn-xs ui-btn-primary` button painted muted grey
 * on the orange accent.
 *
 * Measured on /system in light mode, 2026-09-22: the "Accept → goal" button on
 * all TWENTY-FOUR pending proposals rendered at 1.38:1 against a 4.5 floor.
 * The primary action of the only surface that asks the operator to decide
 * something was effectively invisible. With the composed rule restored it
 * measures 5.51:1.
 *
 * Writing the classes the other way round in JSX does not help: source order
 * is what decides, so the call site has no way to win. That is what makes this
 * a class of bug rather than one mistake — it is invisible at the place a
 * person would look for it.
 *
 * Run: npx tsx scripts/test/size-class-must-not-repaint.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const CSS = join(ROOT, "src", "app", "globals.css");
const SRC = join(ROOT, "src");

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

const css = readFileSync(CSS, "utf8");

/** Body of a single-class component rule, or "" when it has none. */
function ruleBody(cls: string): string {
  const m = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : "";
}
/** Line number of a rule, for the "which one wins" explanation. */
function ruleLine(cls: string): number {
  const i = css.indexOf(`.${cls} {`);
  return i === -1 ? -1 : css.slice(0, i).split("\n").length;
}
const setsTextColour = (body: string) =>
  /\btext-(?!xs\b|sm\b|base\b|lg\b|xl\b|micro\b|nano\b|left\b|center\b|right\b)[a-z-]+/.test(body);

/**
 * Does the variant paint its own field?
 *
 * This is the line between a bug and a preference, and it is worth stating
 * rather than banning every composition.
 *
 * `.ui-btn-primary` sets `bg-accent-warm` — a saturated orange — and picks
 * `text-on-accent` FOR that orange. When the size class substitutes muted
 * grey, the label lands on a field it was never chosen for: 1.38:1.
 *
 * `.ui-btn-ghost` and `.ui-btn-secondary` paint no base background (ghost has
 * one on hover only). Their labels sit on the ordinary page surface, which is
 * exactly the ground `text-text-muted` is designed for. Losing tertiary to
 * muted there makes the button quieter than intended — a shade preference,
 * not a readability failure — so this does not demand a rule for them. If one
 * of them ever gains a background, it moves into the rule automatically.
 */
const paintsOwnBackground = (body: string) =>
  /\bbg-(?!transparent\b)[a-z0-9-]+/.test(body.replace(/hover:bg-[a-z0-9-]+/g, ""));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

console.log("size-class-must-not-repaint:");

check("the size class is still the later rule (the premise)", () => {
  // If someone reorders globals.css this whole class of bug changes shape, and
  // the reader deserves to be told rather than to find a passing test.
  const xs = ruleLine("ui-btn-xs");
  const primary = ruleLine("ui-btn-primary");
  assert(xs > 0 && primary > 0, "both rules must exist");
  assert(
    xs > primary,
    `ui-btn-xs (${xs}) is no longer after ui-btn-primary (${primary}) — re-derive this rule`,
  );
});

check("ui-btn-xs still repaints, so the composed rules are load-bearing", () => {
  // The day ui-btn-xs stops setting a colour, the composed rules become dead
  // weight and should go. Until then they are the only thing holding the line.
  assert(setsTextColour(ruleBody("ui-btn-xs")), "ui-btn-xs no longer sets a text colour");
});

check("every ui-btn-xs composition over a painted field is restored", () => {
  // THE BUG, generalised. Any variant that sets its own label colour loses it
  // to the size class unless a two-class rule puts it back.
  const compositions = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*?"([^"]*)"[^}]*?\})/g,
    )) {
      const cls = m[1] ?? m[2] ?? m[3] ?? "";
      if (!/\bui-btn-xs\b/.test(cls)) continue;
      for (const v of cls.match(/\bui-btn-(?!xs\b)[a-z-]+\b/g) ?? []) {
        const body = ruleBody(v);
        if (!setsTextColour(body) || !paintsOwnBackground(body)) continue;
        if (css.includes(`.ui-btn-xs.${v}`)) continue;
        (compositions.get(v) ?? compositions.set(v, []).get(v)!).push(relative(ROOT, file));
      }
    }
  }
  const lines = [...compositions].map(
    ([v, files]) => `ui-btn-xs + ${v} — ${[...new Set(files)].join(", ")}`,
  );
  assert(
    lines.length === 0,
    `variants that paint their own field and are silently repainted by the size ` +
      `class (add a .ui-btn-xs.<variant> rule):\n      ${lines.join("\n      ")}`,
  );
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
