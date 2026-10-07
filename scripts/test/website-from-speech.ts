/**
 * /change finds the website in what someone typed or said
 * (src/lib/website-from-speech.ts) — deterministically, without a model.
 *
 * Run: npx tsx scripts/test/website-from-speech.ts
 */
import assert from "node:assert/strict";
import { appendToBrief, extractWebsite, saysMoreThanAddress } from "@/lib/website-from-speech";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

console.log("\nextractWebsite");

check("a bare domain in a sentence", () => {
  assert.equal(extractWebsite("My site is evig.ch and the menu is broken"), "evig.ch");
});
check("a full URL loses its scheme and trailing slash, keeps its path", () => {
  assert.equal(
    extractWebsite("see https://Revamp-IT.ch/index.php/de/ please"),
    "revamp-it.ch/index.php/de",
  );
});
check("www is kept, the host is lowercased", () => {
  assert.equal(extractWebsite("WWW.Example.COM needs a booking page"), "www.example.com");
});
check("spoken addresses: 'dot' and 'punkt'", () => {
  assert.equal(extractWebsite("it's my-bakery dot ch"), "my-bakery.ch");
  assert.equal(extractWebsite("unsere Seite ist baeckerei punkt ch"), "baeckerei.ch");
});
check("sentence punctuation is not part of the address", () => {
  assert.equal(extractWebsite("Change farmhouse.orangecat.ch."), "farmhouse.orangecat.ch");
});
check("a file name is not a website", () => {
  assert.equal(extractWebsite("I attached report.pdf"), null);
});
check("no address at all is null, not a guess", () => {
  assert.equal(extractWebsite("make the buttons bigger and the text darker"), null);
});

console.log("\nappendToBrief");

check("each thing said is its own line", () => {
  assert.equal(
    appendToBrief("Bigger buttons", "  and online booking ", 500),
    "Bigger buttons\nand online booking",
  );
});
check("empty speech changes nothing", () => {
  assert.equal(appendToBrief("Bigger buttons", "   ", 500), "Bigger buttons");
});
check("the brief never exceeds its limit", () => {
  assert.equal(appendToBrief("abc", "defgh", 6).length, 6);
});

console.log("\nsaysMoreThanAddress");

check("an address alone is the consultation's question, not a change", () => {
  assert.equal(saysMoreThanAddress("my-bakery.ch"), false);
  assert.equal(saysMoreThanAddress("https://www.my-bakery.ch/"), false);
  assert.equal(saysMoreThanAddress("My site is my-bakery.ch."), false);
  assert.equal(saysMoreThanAddress("hier ist meine Webseite: evig dot ch"), false);
});
check("anything asked for alongside it is kept", () => {
  assert.equal(saysMoreThanAddress("my-bakery.ch — add online ordering"), true);
  assert.equal(saysMoreThanAddress("Make it faster"), true);
});

console.log(`\n${passed}/${passed} website-from-speech cases passed`);
