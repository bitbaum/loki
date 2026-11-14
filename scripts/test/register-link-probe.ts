/**
 * A link the register has not checked is a claim it cannot support.
 *
 * WHY THIS EXISTS: on 2026-09-11 the /fleet page rendered 37 outbound links.
 * Three were dead — two OrangeCat project pages whose projects had been deleted
 * since the id was recorded, and every Solon chip, which pointed at
 * /orgs/<slug>, a route Solon does not have and never had. The register looked
 * authoritative and was wrong, which is worse than a register that admits a
 * gap.
 *
 * The rule these pin: a 404 is an answer (the thing is gone, drop the link);
 * anything else — a timeout, a 502, a rate limit — is NOT an answer, and must
 * leave the link in place while reporting `checked: false`. Reading an
 * unreachable OrangeCat as "this project has no profile" would quietly delete
 * true facts from the page every time their host had a bad minute.
 *
 * Run: npx tsx scripts/test/register-link-probe.ts
 */
import {
  keepVerifiedOrangecatLinks,
  orangecatProjectsThatResolve,
  __resetOrangecatCache,
} from "@/lib/register/orangecat";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

type Reply = { status: number } | { throw: true };
const realFetch = globalThis.fetch;

/** Stand in for OrangeCat, answering per id from a script. */
function stubFetch(byId: Record<string, Reply>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const id = url.split("/").pop() ?? "";
    const reply = byId[id] ?? { status: 404 };
    if ("throw" in reply) throw new Error("network");
    return new Response(null, { status: reply.status });
  }) as typeof fetch;
}

async function main() {
  // ── a 404 is an answer: the project is gone, so the link goes with it
  __resetOrangecatCache();
  stubFetch({ alive: { status: 200 }, gone: { status: 404 } });
  let r = await orangecatProjectsThatResolve(["alive", "gone"], 1_000);
  ok(r.live.has("alive"), "a project that answers 200 stays linkable");
  ok(!r.live.has("gone"), "a project that answers 404 is dropped — it is gone");
  ok(r.checked, "both probes completed, so the result is trustworthy");

  // ── anything else is NOT an answer: keep the link, flag the doubt
  __resetOrangecatCache();
  stubFetch({ flaky: { status: 502 } });
  r = await orangecatProjectsThatResolve(["flaky"], 2_000);
  ok(r.live.has("flaky"), "a 502 must NOT delete a profile that probably exists");
  ok(!r.checked, "…and the caller is told the answer is incomplete");

  __resetOrangecatCache();
  stubFetch({ offline: { throw: true } });
  r = await orangecatProjectsThatResolve(["offline"], 3_000);
  ok(r.live.has("offline"), "a thrown request is our outage, not their deletion");
  ok(!r.checked, "…and it is reported as unchecked");

  // ── an empty ask must not fan out
  __resetOrangecatCache();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  r = await orangecatProjectsThatResolve([], 4_000);
  ok(calls === 0 && r.live.size === 0 && r.checked, "no ids means no requests");

  // ── the cache spares the next reader, within its window
  __resetOrangecatCache();
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  await orangecatProjectsThatResolve(["x"], 10_000);
  await orangecatProjectsThatResolve(["x"], 10_000 + 60_000);
  ok(calls === 1, "a second read inside the TTL reuses the answer");
  await orangecatProjectsThatResolve(["x"], 10_000 + 11 * 60_000);
  ok(calls === 2, "…and re-probes once the TTL has passed");

  // ── an incomplete answer is asked again within a minute, not ten
  __resetOrangecatCache();
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status: 502 });
  }) as typeof fetch;
  await orangecatProjectsThatResolve(["y"], 20_000);
  await orangecatProjectsThatResolve(["y"], 20_000 + 30_000);
  ok(calls === 1, "an unchecked answer is reused for a short while");
  await orangecatProjectsThatResolve(["y"], 20_000 + 61_000);
  ok(calls === 2, "…and asked again after a minute");

  // ── what Loki PUBLISHES (the fleet map) carries only links seen to exist.
  // 2026-11-13: Bitbaum's tile on orangecat.ch opened a deleted project page,
  // because the map emitted the stored id without asking.
  __resetOrangecatCache();
  stubFetch({ alive: { status: 200 }, gone: { status: 404 }, flaky: { status: 502 } });
  r = await orangecatProjectsThatResolve(["alive", "gone", "flaky"], 30_000);
  ok(r.verified.has("alive"), "a page that answered is verified");
  ok(!r.verified.has("gone"), "a deleted page is not verified");
  ok(!r.verified.has("flaky") && r.live.has("flaky"), "an unanswered probe is live, not verified");

  __resetOrangecatCache();
  stubFetch({ alive: { status: 200 }, gone: { status: 404 }, offline: { throw: true } });
  const rows: { slug: string; orangecat?: { projectId: string } | null }[] = [
    { slug: "loki", orangecat: { projectId: "alive" } },
    { slug: "bitbaum", orangecat: { projectId: "gone" } },
    { slug: "heidi", orangecat: { projectId: "offline" } },
    { slug: "plain" },
  ];
  await keepVerifiedOrangecatLinks(rows);
  ok(rows[0].orangecat?.projectId === "alive", "the map keeps a link that answered");
  ok(rows[1].orangecat === null, "the map drops a link to a deleted project");
  ok(rows[2].orangecat === null, "the map does not publish a link it could not check");
  ok(rows[3].orangecat === undefined, "a project with no link is left alone");

  __resetOrangecatCache();
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  await keepVerifiedOrangecatLinks([{ slug: "plain" }]);
  ok(calls === 0, "a map with no OrangeCat links asks nothing");

  globalThis.fetch = realFetch;
  console.log(`register-link-probe: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
