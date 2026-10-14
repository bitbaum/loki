import assert from "node:assert/strict";
import { readWebsite } from "@/lib/agent/tools/read-website";
import type { PageFetch } from "@/lib/site-consult/fetch-page";
async function main() {
  const seen: string[] = [];
  const fake = async (url: string): Promise<PageFetch> => {
    seen.push(url);
    return {
      ok: true,
      requestedUrl: url,
      finalUrl: url,
      html: '<a href="/about">About</a><a href="https://other.test">Elsewhere</a><a href="/care">Care</a><a href="/more">More</a>',
      headers: { robots: "" },
      ms: 1,
      bytes: 100,
      truncated: false,
    };
  };
  const pages = await readWebsite("https://petvity.test/", fake);
  assert.equal(pages.length, 3);
  assert.deepEqual(seen, [
    "https://petvity.test/",
    "https://petvity.test/about",
    "https://petvity.test/care",
  ]);
  const failure = await readWebsite("https://unavailable.test", async (url) => ({
    ok: false,
    requestedUrl: url,
    reason: "HTTP 503",
  }));
  assert.equal(failure.length, 1);
  assert.equal(failure[0].ok, false);
  console.log("✓ fresh site reading follows two same-origin pages and preserves failures");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
