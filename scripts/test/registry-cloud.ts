/**
 * Loki's own project is registered on the cloud builder, and a dispatch that
 * left an offline pinned builder says so in words.
 *
 * Production, 2026-11-12: the loki registration was pinned to the owner's
 * laptop (offline since 2026-11-11 07:19); every dispatch was sent on to the
 * cloud builder and an API caller saw only `channel: "cloud"`.
 *
 * Run: npx tsx scripts/test/registry-cloud.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { rerouteNotice } from "@/lib/dispatch-status";

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
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const TAG = "0137_loki_runs_on_the_cloud_builder";
const sql = read(`drizzle/${TAG}.sql`);
/** The statements, without the comment lines that explain them. */
const statements = sql
  .split("--> statement-breakpoint")
  .map((part) =>
    part
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter(Boolean);

check("the migration is in the journal, after the one before it", () => {
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const i = journal.entries.findIndex((e) => e.tag === TAG);
  assert(i > 0, "not in the journal");
  assert(journal.entries[i].idx === journal.entries[i - 1].idx + 1, "index is not the next one");
  assert(journal.entries[i].when > journal.entries[i - 1].when, "dated before its predecessor");
});

check("it only updates: two statements, nothing dropped or deleted", () => {
  assert(statements.length === 2, `${statements.length} statements`);
  for (const s of statements) {
    assert(/^UPDATE /.test(s), `not an UPDATE: ${s.slice(0, 40)}`);
    assert(!/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i.test(s), `more than an update: ${s}`);
  }
});

check("the registration moves to cloud, and only the one made on that laptop", () => {
  const s = statements[0];
  assert(/UPDATE user_projects\s+SET builder_pref = 'cloud'/.test(s), "does not set cloud");
  assert(/lower\(name\) = 'loki'/.test(s), "not scoped to the loki project");
  assert(/builder_pref = 'local'/.test(s), "would overwrite a choice other than local");
  assert(/dir_path = '\/home\/g\/dev\/loki'/.test(s), "would touch another account's loki");
});

check("the stale note is cleared only while it still says what was stale", () => {
  const s = statements[1];
  assert(/UPDATE project_states ps/.test(s), "wrong table");
  assert(/up\.user_id = ps\.user_id/.test(s), "not tied to the same account");
  assert(/up\.dir_path = '\/home\/g\/dev\/loki'/.test(s), "would touch another account's loki");
  assert(/lower\(ps\.project_key\) = 'loki'/.test(s), "not scoped to the loki project");
  assert(/ILIKE '%usage limit%'/.test(s), "would clear a newer note");
});

check("a dispatch that left an offline pinned builder says so in a sentence", () => {
  const said = rerouteNotice("cloud", "local");
  assert(said !== null, "nothing said");
  assert(/the owner's computer, which is offline now/.test(said ?? ""), said ?? "");
  assert(/the cloud runner took this one/.test(said ?? ""), said ?? "");
  assert(/The setting is unchanged\./.test(said ?? ""), said ?? "");
  assert(!/this computer/.test(said ?? ""), "names the caller's own machine");
});

check("nothing is said when nothing was rerouted", () => {
  assert(rerouteNotice("cloud", null) === null, "no reroute");
  assert(rerouteNotice("cloud", "cloud") === null, "same builder");
  assert(rerouteNotice(null, "local") === null, "unknown builder");
});

check("the inject response carries the sentence", () => {
  const src = read("src/lib/inject-core.ts");
  assert(/const notice = rerouteNotice\(channel, reroutedFrom\);/.test(src), "not computed");
  assert(/\.\.\.\(notice \? \{ message: notice \} : \{\}\),/.test(src), "not in the body");
});

if (failures) {
  console.log(`\nregistry-cloud: ${failures} failed`);
  process.exit(1);
}
console.log("\nregistry-cloud: all passed");
