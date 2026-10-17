/**
 * The operator's own threads as records. Case from the live site (2026-10-15):
 * "what did I ask you today?" was answered "no record of any request".
 */
import { recentThreadFacts } from "@/lib/agent/sources-threads";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const now = Date.parse("2026-10-15T12:00:00Z");
const at = (h: number) => new Date(now - h * 3_600_000);
const row = (over: Partial<Parameters<typeof recentThreadFacts>[0][number]>) => ({
  id: "t",
  title: "Dentist on Monday",
  projectKeys: [] as string[],
  updatedAt: at(1),
  lastReadAt: null,
  preview: "Put an event in my calendar: dentist on Monday at 9am",
  lastRole: "user",
  lastKind: "chat",
  lastAt: at(1),
  lastOk: null,
  lastOutcome: null,
  lastNeedsProject: null,
  ...over,
});

const facts = recentThreadFacts(
  [
    row({ id: "a" }),
    row({
      id: "b",
      title: "Track podcast and design work",
      projectKeys: ["prodtest-bakery"],
      preview: "Could not dispatch to prodtest-bakery",
      lastRole: "assistant",
      lastKind: "dispatch",
      lastOk: false,
      lastAt: at(2),
    }),
    row({ id: "old", title: "Last month", lastAt: at(24 * 30), updatedAt: at(24 * 30) }),
  ],
  10,
  now,
);
const text = JSON.stringify(facts);
check("one fact per thread from the last week", facts.length === 2);
check("a thread older than a week is left out", !text.includes("Last month"));
check(
  "the operator's own words are attributed to them",
  text.includes("the operator: Put an event"),
);
check("a failed dispatch says it could not start", text.includes("Could not start"));
check("a thread with no project says none", text.includes('"projects":"none"'));
check("the project is named when there is one", text.includes("prodtest-bakery"));
check("a thread waiting on Loki says so", text.includes("Waiting on Loki"));
check("the limit holds", recentThreadFacts([row({}), row({}), row({})], 2, now).length === 2);

// Live, 2026-10-17: the driver handed lastAt back as a string, .getTime()
// threw, and the whole source returned nothing.
const asString = recentThreadFacts(
  [
    row({
      title: "String timestamps",
      lastAt: new Date(now - 60_000).toISOString() as unknown as Date,
    }),
  ],
  5,
  now,
);
check("a timestamp that arrives as a string still counts", asString.length === 1);

console.log(`\nthread-facts: ${passed} passed`);
