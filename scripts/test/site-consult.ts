/**
 * The site consultation on /change: what Loki reads from a page, what it
 * concludes, that it never reaches a private network, and that the fixes a
 * person keeps become the build brief.
 *
 * Run: npx tsx scripts/test/site-consult.ts
 */
import assert from "node:assert/strict";
import { CONSULT, CONSULT_CHECKS, CONSULT_CHECK_IDS } from "@/config/site-consult";
import { consult } from "@/lib/site-consult/findings";
import { fetchPage, type FetchLike, type LookupLike } from "@/lib/site-consult/fetch-page";
import { readPage } from "@/lib/site-consult/read-page";
import { WebsiteBuildBody, websiteBuildBrief } from "@/lib/website-brief";
import { parseWebsiteDraft } from "@/lib/website-draft";

let passed = 0;
const check = async (label: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

const GOOD = `<!doctype html><html lang="de-CH"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bäckerei Muster – Brot &amp; Zopf in Zürich</title>
<meta name="description" content="Frisches Brot, Zopf und Gipfeli aus Zürich. Online bestellen, im Laden abholen.">
<meta property="og:image" content="https://baeckerei.ch/og.jpg">
<script type="application/ld+json">{"@type":"Bakery"}</script>
</head><body><h1>Bäckerei Muster</h1>
<p>${"Wir backen jeden Morgen frisches Brot für Zürich. ".repeat(8)}</p>
<img src="https://baeckerei.ch/a.jpg" alt="Zopf"><img src="/b.jpg" alt="">
<a href="tel:+41441234567">+41 44 123 45 67</a> <a href="/kontakt">Kontakt</a>
<footer>© 2018–${new Date().getFullYear()} Bäckerei Muster</footer></body></html>`;

const BAD = `<html><head><title>Home</title></head><body>
<div id="app"></div><img src="http://cdn.example.org/x.jpg"><img src="/y.jpg"><img src="/z.jpg">
<p>Call 044 123 45 67</p><footer>Copyright © 2019 Muster GmbH</footer>
<script src="/app.js"></script></body></html>`;

const page = (html: string, finalUrl = "https://baeckerei.ch/", ms = 400, robots = "") => ({
  finalUrl,
  ms,
  bytes: html.length,
  facts: readPage(html, finalUrl, robots),
});

async function main() {
  console.log("\nreadPage");
  await check("reads the facts a good page serves", () => {
    const f = readPage(GOOD, "https://baeckerei.ch/");
    assert.equal(f.lang, "de-CH");
    assert.equal(f.title, "Bäckerei Muster – Brot & Zopf in Zürich");
    assert.ok(f.description?.startsWith("Frisches Brot"));
    assert.ok(f.viewport?.includes("width=device-width"));
    assert.equal(f.h1Count, 1);
    assert.equal(f.hasShareImage, true);
    assert.equal(f.hasStructuredData, true);
    assert.deepEqual([f.images, f.imagesWithoutAlt], [2, 0], 'alt="" is decorative, not missing');
    assert.equal(f.telLinks, 1);
    assert.equal(f.plainPhone, null, "a tappable number is not reported as plain");
    assert.ok(f.contactLinks >= 1);
    assert.equal(f.copyrightYear, new Date().getFullYear(), "a range counts by its last year");
    assert.ok(f.words > CONSULT.thinTextWords);
  });
  await check("reads what a bad page lacks", () => {
    const f = readPage(BAD, "https://muster.ch/");
    assert.equal(f.viewport, null);
    assert.equal(f.lang, null);
    assert.equal(f.insecureResources, 1);
    assert.equal(f.imagesWithoutAlt, 3);
    assert.equal(f.plainPhone, "044 123 45 67");
    assert.equal(f.copyrightYear, 2019);
  });
  await check("a date is not a phone number", () => {
    assert.equal(readPage("<p>Offen ab 01.02.2026</p>", "https://x.ch/").plainPhone, null);
  });
  await check("script text is not visible text", () => {
    const f = readPage(
      "<body><script>var a = 'words '.repeat(99)</script><p>Hi</p></body>",
      "https://x.ch/",
    );
    assert.equal(f.words, 1);
  });

  console.log("\nconsult");
  await check("a good page has nothing urgent and says so", () => {
    const c = consult(page(GOOD));
    assert.equal(c.counts.urgent, 0, JSON.stringify(c.findings));
    assert.equal(c.findings.length, 0, JSON.stringify(c.findings));
    assert.match(c.headline, /good shape/);
    assert.equal(c.site.host, "baeckerei.ch");
  });
  await check("a bad page leads with what costs visitors, with proof", () => {
    const c = consult(page(BAD, "http://muster.ch/", 6_000), 2026);
    const ids = c.findings.map((f) => f.id);
    for (const id of [
      "not-https",
      "no-viewport",
      "weak-title",
      "no-description",
      "no-h1",
      "thin-text",
      "phone-not-tappable",
      "stale-copyright",
      "images-no-alt",
      "no-lang",
      "slow",
    ] as const)
      assert.ok(ids.includes(id), `expected ${id} in ${ids.join(", ")}`);
    assert.ok(!ids.includes("mixed-content"), "mixed content is only a finding on an https page");
    assert.ok(!ids.includes("no-title"), "a page with a title is not told it has none");
    const firstImprove = c.findings.findIndex((f) => f.severity === "improve");
    assert.ok(
      c.findings.slice(0, firstImprove).every((f) => f.severity === "urgent"),
      "urgent first",
    );
    assert.equal(
      c.findings.find((f) => f.id === "slow")?.severity,
      "urgent",
      "very slow escalates",
    );
    assert.match(c.findings.find((f) => f.id === "weak-title")!.evidence!, /“Home”/);
    assert.match(c.findings.find((f) => f.id === "stale-copyright")!.evidence!, /2019/);
    assert.match(c.headline, /costing you visitors/);
  });
  await check("noindex from a header counts like the meta tag", () => {
    const c = consult(page(GOOD, "https://baeckerei.ch/", 300, "noindex, nofollow"));
    assert.deepEqual(
      c.findings.map((f) => f.id),
      ["noindex"],
    );
  });
  await check("a check that cannot be judged is neither passed nor failed", () => {
    const c = consult(page("<html><body><h1>Hi</h1></body></html>"));
    const all = [...c.findings.map((f) => f.id), ...c.passed.map((p) => p.id)];
    assert.ok(!all.includes("images-no-alt") && !all.includes("stale-copyright"));
  });
  await check("every check has owner-facing copy and an agent instruction", () => {
    for (const id of CONSULT_CHECK_IDS) {
      const c = CONSULT_CHECKS[id];
      assert.ok(c.title && c.why && c.fix && c.passed, id);
      assert.ok(!/\bsats?\b|donat/i.test(`${c.title} ${c.why}`), `${id} uses a forbidden word`);
    }
  });

  console.log("\nfetchPage (SSRF)");
  const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });
  const publicDns: LookupLike = async () => [{ address: "93.184.216.34" }];

  await check("refuses an address that resolves into a private network", async () => {
    const fetchFn: FetchLike = async () => assert.fail("must not fetch");
    const r = await fetchPage("evil.example.ch", {
      fetchFn,
      lookup: async () => [{ address: "10.0.0.5" }],
    });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : "", /private network/);
  });
  await check("refuses a redirect into a private network", async () => {
    const seen: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      seen.push(url);
      return url.includes("public.ch")
        ? new Response(null, { status: 302, headers: { location: "https://internal.ch/admin" } })
        : html(GOOD);
    };
    const lookup: LookupLike = async (host) => [
      { address: host === "internal.ch" ? "169.254.169.254" : "93.184.216.34" },
    ];
    const r = await fetchPage("https://public.ch", { fetchFn, lookup });
    assert.equal(r.ok, false);
    assert.deepEqual(seen, ["https://public.ch/"]);
  });
  await check("refuses a redirect to an IP literal or custom port", async () => {
    for (const location of ["http://127.0.0.1/", "https://public.ch:8080/"]) {
      const fetchFn: FetchLike = async () =>
        new Response(null, { status: 301, headers: { location } });
      const r = await fetchPage("https://public.ch", { fetchFn, lookup: publicDns });
      assert.equal(r.ok, false, location);
    }
  });
  await check("refuses what is not a public address before any lookup", async () => {
    for (const raw of ["localhost", "192.168.1.1", "https://office.local", "file:///etc/passwd"]) {
      const r = await fetchPage(raw, {
        fetchFn: async () => assert.fail(raw),
        lookup: async () => assert.fail(raw),
      });
      assert.equal(r.ok, false, raw);
    }
  });
  await check("follows a public redirect and reports where it landed", async () => {
    const fetchFn: FetchLike = async (url) =>
      url === "https://public.ch/"
        ? new Response(null, { status: 301, headers: { location: "/de/" } })
        : html(GOOD, 200, { "x-robots-tag": "noindex" });
    const r = await fetchPage("public.ch", { fetchFn, lookup: publicDns });
    assert.ok(r.ok);
    assert.equal(r.ok && r.finalUrl, "https://public.ch/de/");
    assert.equal(r.ok && r.headers.robots, "noindex");
  });
  await check(
    "a site that only answers on http:// is read there — that IS the finding",
    async () => {
      const fetchFn: FetchLike = async (url) => {
        if (url.startsWith("https:")) throw new TypeError("fetch failed");
        return html(BAD);
      };
      const r = await fetchPage("old-site.ch", { fetchFn, lookup: publicDns });
      assert.ok(r.ok);
      assert.equal(r.ok && r.finalUrl, "http://old-site.ch/");
    },
  );
  await check("a file is not a page, and an error page is not a page", async () => {
    const pdf: FetchLike = async () =>
      new Response("%PDF", { headers: { "content-type": "application/pdf" } });
    assert.equal(
      (await fetchPage("https://x.ch/a", { fetchFn: pdf, lookup: publicDns })).ok,
      false,
    );
    const gone: FetchLike = async () => html("nope", 404);
    assert.equal(
      (await fetchPage("https://x.ch/a", { fetchFn: gone, lookup: publicDns })).ok,
      false,
    );
  });

  console.log("\nthe build brief");
  const requestId = "28ed5be9-3700-4e1a-9819-516ed899ec62";
  await check("chosen fixes alone are enough to build a refresh", () => {
    const input = WebsiteBuildBody.parse({
      website: "muster.ch",
      requestId,
      fixes: ["no-viewport", "not-https"],
    });
    const brief = websiteBuildBrief(input);
    assert.ok(brief.includes("Fixes the customer chose from Loki's consultation"));
    assert.ok(
      brief.indexOf(CONSULT_CHECKS["not-https"].fix) <
        brief.indexOf(CONSULT_CHECKS["no-viewport"].fix),
      "SSOT order",
    );
    assert.ok(!brief.includes("Requested changes"), "no empty 'exact words' section");
    assert.ok(brief.includes("Keep the original website running"));
  });
  await check("own words and fixes travel together", () => {
    const input = WebsiteBuildBody.parse({
      website: "muster.ch",
      requestId,
      changes: "Add online ordering",
      fixes: ["slow"],
    });
    const brief = websiteBuildBrief(input);
    assert.ok(brief.includes("Add online ordering") && brief.includes(CONSULT_CHECKS.slow.fix));
  });
  await check("nothing chosen and nothing said is not a brief", () => {
    assert.equal(WebsiteBuildBody.safeParse({ website: "muster.ch", requestId }).success, false);
    assert.equal(
      WebsiteBuildBody.safeParse({ website: "muster.ch", requestId, fixes: ["no-such-check"] })
        .success,
      false,
    );
    assert.equal(
      WebsiteBuildBody.safeParse({
        website: "stripe.com",
        requestId,
        mode: "inspired",
        fixes: ["slow"],
      }).success,
      false,
      "an inspired site is not someone else's site to fix",
    );
  });

  console.log("\nthe draft");
  await check("a stored draft keeps its fixes and request id", () => {
    const d = parseWebsiteDraft(
      JSON.stringify({ website: "muster.ch", fixes: ["slow"], requestId, mode: "refresh" }),
      false,
    );
    assert.deepEqual(d, { website: "muster.ch", fixes: ["slow"], requestId, mode: "refresh" });
  });
  await check("a handoff never carries a request id, and junk is dropped", () => {
    const d = parseWebsiteDraft(
      JSON.stringify({ website: "m.ch", requestId, fixes: ["<script>"], mode: "x" }),
      true,
    );
    assert.deepEqual(d, { website: "m.ch" });
    assert.deepEqual(parseWebsiteDraft("{not json", false), {});
  });

  console.log(`\n${passed}/${passed} site-consult cases passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
