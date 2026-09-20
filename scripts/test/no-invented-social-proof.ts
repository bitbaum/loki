/**
 * Copy must not claim other people's behaviour that has not happened.
 *
 * The pricing page badged Pro "Most popular". Loki has 7 users and 0 on any
 * paid plan (checked against the database, 2026-09-20), and every paid tier
 * reads "Price to be announced" — so nothing has ever been bought, and no tier
 * can be the popular one. It is the seller's emphasis, and it now says so:
 * "Recommended".
 *
 * That page's own header already promised this standard — "a paid CTA only
 * appears when a rail can actually take the money, never a dead Buy button" —
 * and a Stripe branch was deleted for breaking it. The badge slipped past.
 *
 * This is the second time this class has shipped in the fleet. George, on
 * Substrata: "dont ever lie. ever." The remedy there was a ratchet on a
 * banned-phrase list, so this is that ratchet for the public surface.
 *
 * The rule is narrow on purpose: it bans claims about OTHER PEOPLE'S choices
 * and about counts nobody can verify. Opinions the seller owns
 * ("Recommended", "Our pick") are fine — they are attributable.
 *
 * Run: npx tsx scripts/test/no-invented-social-proof.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
/** The surfaces a stranger reads. */
const SCAN = [
  join(ROOT, "src", "app"),
  join(ROOT, "src", "config"),
  join(ROOT, "src", "components", "public"),
];

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

/**
 * Phrases that assert what other customers did. Each is only a lie while the
 * number behind it is zero — which is exactly why a human has to come here and
 * delete the entry when it stops being one, rather than the check quietly
 * passing because someone reworded it.
 */
const INVENTED = [
  /\bmost popular\b/i,
  /\bmost loved\b/i,
  /\bcustomers?' favourite\b/i,
  /\bjoin \d[\d,]* (?:happy )?(?:customers|users|teams|builders)\b/i,
  /\btrusted by \d[\d,]*/i,
  /\bthousands of (?:customers|users|teams)\b/i,
  /\b\d[\d,]*\+? (?:companies|teams|customers) (?:use|trust|rely)/i,
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Strip comments — this file's own prose quotes the phrases it bans. */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

console.log("no-invented-social-proof:");

check("the detector recognises the shape it hunts", () => {
  // A detector that never fires reads exactly like honest copy.
  assert(
    INVENTED.some((r) => r.test("<span>Most popular</span>")),
    "must catch the real case",
  );
  assert(
    INVENTED.some((r) => r.test("Trusted by 4,000 teams")),
    "must catch a count claim",
  );
  assert(!INVENTED.some((r) => r.test("<span>Recommended</span>")), "an owned opinion is fine");
  assert(!INVENTED.some((r) => r.test("Popular prompts")), "not a claim about buyers");
});

check("comments are not code", () => {
  // Or this very file, and the one it fixed, would fail themselves.
  assert(codeOnly('// badged it "Most popular" once').trim() === "", "line comment stripped");
  assert(codeOnly("/* Most popular */").trim() === "", "block comment stripped");
});

check("no public surface invents social proof", () => {
  const hits: string[] = [];
  for (const dir of SCAN) {
    for (const file of walk(dir)) {
      const code = codeOnly(readFileSync(file, "utf8"));
      for (const re of INVENTED) {
        const m = re.exec(code);
        if (m) hits.push(`${relative(ROOT, file)} — "${m[0]}"`);
      }
    }
  }
  assert(
    hits.length === 0,
    `copy claiming other people's behaviour:\n      ${hits.join("\n      ")}`,
  );
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
