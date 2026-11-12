/**
 * A merged change is live when the site serves a commit that contains the
 * merge (lib/feedback/served-release), whatever the workflow runs are
 * labelled with.
 *
 * Run: npx tsx scripts/test/served-release.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIX_SHIP_STATE, type FixShipping } from "@/lib/feedback/fix-shipping";
import {
  applyServedRelease,
  awaitsServedRelease,
  fetchServedRelease,
  parseServedRelease,
  relationFromCompare,
  RELEASE_RECEIPT_PATH,
} from "@/lib/feedback/served-release";

let pass = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass += 1;
  console.log(`  ✓ ${name}`);
}

const MERGE = "6bb3d7461c3ecdc41ed384976df0d98bd9ee1255";
const LATER = "9253f40898e3d135878ac6471ccb9ccb20979c4b";
const receipt = {
  formatVersion: 1,
  repo: "bitbaum/loki",
  commit: LATER,
  createdAt: "2026-11-12T06:02:12.497Z",
};
const merged = (state: FixShipping["state"], extra: Partial<FixShipping> = {}): FixShipping => ({
  state,
  pr: {
    number: 1643,
    url: "https://github.com/bitbaum/loki/pull/1643",
    title: "x",
    mergedAt: "2026-11-12T05:16:36Z",
    mergeSha: MERGE,
  },
  checkedAt: "2026-11-12T06:10:00Z",
  ...extra,
});
const publicLookup = async () => [{ address: "167.233.22.31" }];
const jsonFetch =
  (body: unknown, status = 200) =>
  async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

async function main() {
  await check("a receipt is a repo, a full commit and a time", () => {
    const url = `https://loki.orangecat.ch${RELEASE_RECEIPT_PATH}`;
    assert.deepEqual(parseServedRelease(receipt, url), {
      repo: "bitbaum/loki",
      commit: LATER,
      createdAt: receipt.createdAt,
      url,
    });
    for (const bad of [
      null,
      "x",
      {},
      { repo: "loki", commit: LATER },
      { repo: "a/b", commit: "9253f40" },
    ])
      assert.equal(parseServedRelease(bad, url), null, JSON.stringify(bad));
    assert.equal(parseServedRelease({ ...receipt, createdAt: "soon" }, url)?.createdAt, null);
  });

  await check("ahead or identical contains the merge; behind or diverged does not", () => {
    assert.equal(relationFromCompare("ahead"), "contains");
    assert.equal(relationFromCompare("identical"), "contains");
    assert.equal(relationFromCompare("behind"), "missing");
    assert.equal(relationFromCompare("diverged"), "missing");
    assert.equal(relationFromCompare(null), null, "unreadable is not an answer");
    assert.equal(relationFromCompare("something"), null);
  });

  const served = parseServedRelease(receipt, "https://loki.orangecat.ch/x")!;

  // 2026-11-12: #1643's merge carried no Deploy run (the deploy that shipped
  // it was labelled with a later commit), so its ledger read merged for good.
  await check("merged with no deploy run on record reads live once the site serves it", () => {
    const fix = applyServedRelease(
      merged(FIX_SHIP_STATE.MERGED),
      served,
      "contains",
      "bitbaum/loki",
    );
    assert.equal(fix.state, FIX_SHIP_STATE.DEPLOYED);
    assert.equal(fix.liveVia, "served_release");
    assert.equal(fix.deploy?.at, receipt.createdAt, "live since the release was built");
    assert.equal(fix.deploy?.url, "https://loki.orangecat.ch/x");
  });

  await check(
    "deploying and deploy-failed are settled the same way, and the failed run is kept",
    () => {
      assert.equal(
        applyServedRelease(merged(FIX_SHIP_STATE.DEPLOYING), served, "contains", "bitbaum/loki")
          .state,
        FIX_SHIP_STATE.DEPLOYED,
      );
      const failed = merged(FIX_SHIP_STATE.DEPLOY_FAILED, {
        deploy: {
          url: "https://github.com/r/1",
          name: "Deploy",
          conclusion: "cancelled",
          status: "completed",
        },
      });
      const fix = applyServedRelease(failed, served, "contains", "bitbaum/loki");
      assert.equal(fix.state, FIX_SHIP_STATE.DEPLOYED);
      assert.deepEqual(fix.ownDeploy, {
        url: "https://github.com/r/1",
        name: "Deploy",
        conclusion: "cancelled",
      });
    },
  );

  await check("it only ever upgrades: everything else is left as it was", () => {
    const m = merged(FIX_SHIP_STATE.MERGED);
    assert.equal(
      applyServedRelease(m, served, "missing", "bitbaum/loki"),
      m,
      "site runs older code",
    );
    assert.equal(applyServedRelease(m, served, null, "bitbaum/loki"), m, "could not compare");
    assert.equal(applyServedRelease(m, null, "contains", "bitbaum/loki"), m, "no receipt");
    assert.equal(
      applyServedRelease(m, served, "contains", "bitbaum/orangecat"),
      m,
      "another repo's site",
    );
    const open = merged(FIX_SHIP_STATE.PR_OPEN);
    assert.equal(applyServedRelease(open, served, "contains", "bitbaum/loki"), open, "not merged");
    const live = merged(FIX_SHIP_STATE.DEPLOYED);
    assert.equal(
      applyServedRelease(live, served, "contains", "bitbaum/loki"),
      live,
      "already live",
    );
    const noSha = { ...merged(FIX_SHIP_STATE.MERGED), pr: { number: 1, url: "u", title: "t" } };
    assert.equal(awaitsServedRelease(noSha), false, "no merge commit to look for");
  });

  await check("the receipt is read from the site's own origin, guarded", async () => {
    let asked = "";
    const got = await fetchServedRelease("https://loki.orangecat.ch/loki?x=1", {
      lookup: publicLookup,
      fetchImpl: async (url, init) => {
        asked = url;
        assert.equal(init.redirect, "error", "no redirect is followed");
        return new Response(JSON.stringify(receipt));
      },
    });
    assert.equal(asked, `https://loki.orangecat.ch${RELEASE_RECEIPT_PATH}`);
    assert.equal(got?.commit, LATER);

    const never = async () => {
      throw new Error("must not be fetched");
    };
    for (const bad of [
      null,
      "",
      "http://127.0.0.1/",
      "https://localhost/",
      "https://box.internal/",
      "https://a.ch:8443/",
    ])
      assert.equal(
        await fetchServedRelease(bad, { lookup: publicLookup, fetchImpl: never }),
        null,
        String(bad),
      );
    assert.equal(
      await fetchServedRelease("https://loki.orangecat.ch", {
        lookup: async () => [{ address: "10.0.0.5" }],
        fetchImpl: never,
      }),
      null,
      "a name that resolves into a private network is not opened",
    );
    assert.equal(
      await fetchServedRelease("http://loki.orangecat.ch", {
        lookup: publicLookup,
        fetchImpl: never,
      }),
      null,
      "https only",
    );
    for (const res of [jsonFetch("not json"), jsonFetch({}, 200), jsonFetch(receipt, 404)])
      assert.equal(
        await fetchServedRelease("https://loki.orangecat.ch", {
          lookup: publicLookup,
          fetchImpl: res,
        }),
        null,
      );
    assert.equal(
      await fetchServedRelease("https://loki.orangecat.ch", {
        lookup: publicLookup,
        fetchImpl: async () => {
          throw new Error("redirect");
        },
      }),
      null,
      "never throws",
    );
  });

  await check(
    "the ledger asks the site after the workflow runs, with the project's address",
    () => {
      const refresh = readFileSync("src/lib/feedback/fix-shipping-refresh.ts", "utf8");
      assert.match(
        refresh,
        /fix = await liveFromServedRelease\(fix, ref, input\.liveUrl, picked\.token\);/,
      );
      assert.match(refresh, /liveUrl: string \| null;/, "required, so no caller can forget it");
      assert.match(readFileSync("src/lib/run-follow.ts", "utf8"), /\n\s+liveUrl,\n/);
      assert.match(
        readFileSync("src/lib/feedback/attach-work.ts", "utf8"),
        /liveUrl: item\.liveUrl \?\? null,/,
      );
    },
  );

  console.log(`\nserved-release: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
