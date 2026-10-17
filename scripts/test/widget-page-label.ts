// The header names the page, not the brand again.
// Run: npx tsx scripts/test/widget-page-label.ts
import assert from "node:assert/strict";
import { pageLabel } from "../../widget/page-label";

// Loki's own pages: the brand line already says "Loki".
assert.equal(pageLabel("Loki", "/"), "Home");
assert.equal(pageLabel("Loki", "/control/"), "/control");
assert.equal(pageLabel("Control — Loki", "/control"), "Control");
assert.equal(pageLabel("LOKI | Feedback", "/feedback"), "Feedback");
assert.equal(pageLabel("Loki · My feedback", "/my-feedback"), "My feedback");
// Everyone else's titles pass through untouched.
assert.equal(pageLabel("Substrata — Ask the archive", "/"), "Substrata — Ask the archive");
assert.equal(pageLabel("Murphy's Bar", "/menu"), "Murphy's Bar");
// A word that merely contains the brand is not the brand, and a hyphenated
// name is one name.
assert.equal(pageLabel("Lokis Garten", "/"), "Lokis Garten");
assert.equal(pageLabel("evig-computers", "/"), "evig-computers");
// No title at all: the path, then Home.
assert.equal(pageLabel("", "/chat"), "/chat");
assert.equal(pageLabel("", "/"), "Home");

console.log("✓ widget-page-label: ok");
