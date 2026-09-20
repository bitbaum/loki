/**
 * A horizontal scroll strip that hides its scrollbar must say it scrolls.
 *
 * Found on /feedback at 390px: the stats row ended mid-word — "32 Shipped
 * 18 in…" — and the third card sat entirely off-screen. `.ui-stat-row` is a
 * flex strip with `overflow-x-auto` AND `[scrollbar-width:none]`, so there was
 * no scrollbar, no fade, and nothing at all to suggest the row continued. A
 * clipped word does not read as "swipe me", it reads as a broken layout.
 *
 * The repo already had the answer: `ui-scroll-fade-right` masks the right edge
 * below `sm` and nulls itself at `sm`. PeopleGrid, ThoughtsLibrary and
 * GroupBar all pair it with the identical strip. `.ui-stat-row` — used by
 * Feedback, Goals, Memory, Money and Habits — did not.
 *
 * This is the ratchet, so the sixth strip cannot repeat it.
 *
 * Run: npx tsx scripts/test/scroll-strips-have-an-affordance.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * A className string that scrolls horizontally AND hides its scrollbar.
 * Either alone is fine: a visible scrollbar is its own affordance, and a
 * hidden scrollbar on a row that does not scroll hides nothing.
 */
function isSilentScrollStrip(cls: string): boolean {
  const scrolls = /overflow-x-auto|overflow-x-scroll/.test(cls);
  const hidesBar = /scrollbar-width:none|::-webkit-scrollbar\]:hidden/.test(cls);
  return scrolls && hidesBar;
}

console.log("scroll-strips-have-an-affordance:");

check("the detector recognises the shape it hunts", () => {
  // A detector that never fires reads exactly like a clean codebase.
  assert(
    isSilentScrollStrip("flex gap-2 overflow-x-auto [scrollbar-width:none]"),
    "must match a silent strip",
  );
  assert(!isSilentScrollStrip("flex gap-2 overflow-x-auto"), "visible scrollbar is its own cue");
  assert(!isSilentScrollStrip("grid grid-cols-3"), "a grid is not a strip");
});

check("every silent scroll strip in src/ carries the fade", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2] ?? "";
      if (!isSilentScrollStrip(cls)) continue;
      if (cls.includes("ui-scroll-fade")) continue;
      offenders.push(`${relative(ROOT, file)} — ${cls.slice(0, 70)}`);
    }
  }
  assert(
    offenders.length === 0,
    `strips that hide the scrollbar and never say they scroll:\n      ${offenders.join("\n      ")}`,
  );
});

check("the ui-* strip classes carry it too", () => {
  // `.ui-stat-row` hides the scrollbar inside globals.css, so its className
  // reads innocent — the rule has to follow the CSS as well as the JSX.
  //
  // Only className ATTRIBUTES count. A first cut matched the bare class name
  // anywhere in the file and duly reported the file that had just been fixed,
  // because the explanatory comment above the component names the class in
  // prose. A detector that cannot tell code from commentary invents work.
  const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
  const files = walk(SRC).map((f) => ({ f, text: readFileSync(f, "utf8") }));
  const silent: string[] = [];
  for (const b of css.matchAll(/\.(ui-[a-z-]+)\s*\{([^}]*)\}/g)) {
    const [, name, body] = b;
    if (!isSilentScrollStrip(body)) continue;
    if (/mask-image/.test(body)) continue; // masks itself
    for (const { f, text } of files) {
      for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2] ?? "";
        if (!new RegExp(`(^|\\s)${name}(\\s|$)`).test(cls)) continue;
        if (cls.includes("ui-scroll-fade")) continue;
        silent.push(`${name} in ${relative(ROOT, f)} — ${cls.slice(0, 60)}`);
      }
    }
  }
  assert(
    silent.length === 0,
    `scroll strips with a hidden scrollbar and no fade:\n      ${silent.join("\n      ")}`,
  );
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
