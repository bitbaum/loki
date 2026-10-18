// widget.js runs on other people's pages, and not every page declares its
// encoding. A script served without a charset is then read in the page's
// encoding, and any raw non-ASCII byte in it means something else. esbuild
// escapes strings for us; it keeps regex literals as typed — so a “ or → in a
// pattern silently stopped matching on such a page (found 2026-10-18: the
// voice note's read-back saw no parts). Write \u201C, not “, in a regex.
// Run: npx tsx scripts/test/widget-ascii-bundle.ts
import assert from "node:assert/strict";
import { build } from "esbuild";

async function main() {
  const out = await build({
    entryPoints: ["widget/main.ts"],
    bundle: true,
    format: "iife",
    minify: true,
    write: false,
    logLevel: "silent",
  });
  const js = out.outputFiles[0].text;
  const raw = [...js.matchAll(/.{0,40}[^\x00-\x7F]+.{0,10}/g)].map((m) => m[0]);
  assert.deepEqual(
    raw,
    [],
    `widget.js carries raw non-ASCII (escape it, e.g. \\u2192):\n${raw.join("\n")}`,
  );
  console.log("✓ widget-ascii-bundle: widget.js is pure ASCII");
}
void main();
