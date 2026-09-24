/**
 * No `echo … | grep -q` / `printf … | grep -q` in a shell script.
 *
 * Under `set -o pipefail` that construct can report "not found" for text that
 * IS there: grep -q exits at its first match and closes the pipe, the writer
 * takes SIGPIPE (141), and pipefail makes the pipeline's status 141. So an
 * `if … | grep -q X` takes the else branch on a SUCCESSFUL match.
 *
 * It was believed to fire only past the ~4 KB pipe buffer, which is why 82
 * copies survived a one-file fix in #587. Measured 2026-09-24 on retire-site's
 * real 1,158-byte plan output, `has()`'s exact pattern, 3,000 calls each:
 *
 *     'DRY RUN'        (line 3 of 20)    echo|grep -q   2/3000 false misses
 *     'apps.conf row'  (line 11 of 20)   echo|grep -q   2/3000 false misses
 *     last phrase      (line 20 of 20)   echo|grep -q   0/3000
 *     'DRY RUN'                          here-string    0/3000
 *
 * Rare per call, but verify makes hundreds of these calls, so the suite went red
 * on those two exact phrases twice in one session and passed on every rerun.
 * It is worse in a NEGATIVE check: `hasnt()` read a false miss as a PASS.
 * And several copies were not tests at all: a deploy step (exit 1 on a false
 * miss), the sshd drift watch (a false miss = a false security alert).
 *
 * A here-string is not a pipeline, so there is no writer to signal:
 *     grep -q PATTERN <<<"$var"
 *
 * Run: npx tsx scripts/test/no-grep-q-in-a-pipe.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".sh")) out.push(p);
  }
  return out;
}

/** A writer piped into a grep whose flag cluster contains q. Comment lines are
 *  skipped — the files that document this trap name it. */
const PIPED_GREP_Q = /\b(?:echo|printf)\b[^|#\n]*\|\s*grep\s+-[A-Za-z]*q/;

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

console.log("no-grep-q-in-a-pipe:");

const scripts = walk(join(ROOT, "scripts"));

check("there are shell scripts to scan (re-point this gate if they moved)", () => {
  assert(scripts.length > 20, `only ${scripts.length} .sh files under scripts/`);
});

check("THE BUG: no writer is piped into grep -q", () => {
  const hits: string[] = [];
  for (const f of scripts) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        if (PIPED_GREP_Q.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert(
    hits.length === 0,
    `echo/printf | grep -q reports a MISS on a match under pipefail — use grep -q PATTERN <<<"$var":\n      ${hits.join("\n      ")}`,
  );
});

check("the detector still fires on the shapes it exists to catch", () => {
  // A scanner that matches nothing reads exactly like a clean tree.
  for (const s of [
    `if echo "$out" | grep -qi -- "$2"; then`,
    `printf '%s\\n' "$taken" | grep -qx "$p"`,
    `printf '%s' "$x" | grep -qE '^[0-9]+$'`,
    `echo "$(cmd)" | grep -q ok || fail`,
  ]) {
    assert(PIPED_GREP_Q.test(s), `does not fire on: ${s}`);
  }
  for (const s of [
    `grep -q ok <<<"$out"`,
    `echo "$x" | grep -c ok`,
    `# never echo | grep -q here`,
  ]) {
    const isComment = /^\s*#/.test(s);
    assert(isComment || !PIPED_GREP_Q.test(s), `fires on a safe line: ${s}`);
  }
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
