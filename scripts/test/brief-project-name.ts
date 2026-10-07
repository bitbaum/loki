/**
 * Brief projects get readable names (src/lib/brief-project-name.ts).
 *
 * The name becomes the repo and the <name>.orangecat.ch preview. It used to be
 * xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf; the operator, on that
 * preview: "why not just xhiva.orangecat.ch".
 *
 * Run: npx tsx scripts/test/brief-project-name.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { firstFreeName, siteName } from "@/lib/brief-project-name";

let passed = 0;
const check = async (label: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

async function main() {
  console.log("\nsiteName");
  await check("the site's own name: no www, no TLD", () => {
    assert.equal(siteName("https://www.xhiva.art/"), "xhiva");
    assert.equal(siteName("derhochhinhousepartyrenner.ch"), "derhochhinhousepartyrenner");
    assert.equal(siteName("https://shop.example.com/a/b"), "example");
  });
  await check("a two-part public suffix is dropped too", () => {
    assert.equal(siteName("https://my-bakery.co.uk/menu"), "my-bakery");
    assert.equal(siteName("www.surf-school.com.au"), "surf-school");
  });
  await check("what is left is a valid project name", () => {
    assert.equal(siteName("https://Café-Zürich.ch"), "cafe-zurich");
  });

  console.log("\nfirstFreeName");
  await check("the base name when it is free", async () => {
    assert.equal(await firstFreeName("xhiva", async () => false), "xhiva");
  });
  await check("-2, -3 only when taken", async () => {
    const taken = new Set(["xhiva", "xhiva-2"]);
    assert.equal(await firstFreeName("xhiva", async (n) => taken.has(n)), "xhiva-3");
  });

  console.log("\nstartBriefProject");
  await check("a repeat is found by its request id, never by name", () => {
    const src = readFileSync(
      join(__dirname, "../../src/lib/kickoff/start-brief-project.ts"),
      "utf8",
    );
    assert.ok(/findBriefProject\(userId, opts\.requestId\)/.test(src), "looks up by request id");
    assert.ok(/markBriefProject\(/.test(src), "records the request id on the project");
    assert.ok(/firstFreeName\(opts\.name, isProjectNameTaken\)/.test(src), "names it readably");
  });

  console.log(`\n${passed}/${passed} brief-project-name cases passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
