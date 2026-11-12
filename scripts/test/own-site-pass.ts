/**
 * The owner, signed in to Loki, is the owner to Loki's own widget.
 *
 * Inside Loki the header's spiral opened the visitor's panel — "I own or build
 * this site — sign in with Loki →", "Made with Loki →", "Hide this button on
 * this site" — because the widget knows the owner only by a pass, and on
 * Loki's own origin nothing handed it one (audit, 2026-11-12). The app layout
 * now mints the pass for the signed-in owner (lib/feedback/own-site-pass) and
 * OwnSitePass stores it where the widget reads it. This checks the two sides
 * agree on where that is, and that the layout only mints for the owner.
 *
 * Run: npx tsx scripts/test/own-site-pass.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storeOwnerPass, takeOwnerPass } from "../../widget/owner-pass";
import { readWatchPaused } from "../../widget/watch";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  location: { hash: "", pathname: "/loki", search: "" },
});

assert.equal(storeOwnerPass("fcw_test", "pass-1").first, true, "the first pass is news");
assert.equal(storeOwnerPass("fcw_test", "pass-1").first, false, "a renewal is not");
const seed = readFileSync("src/components/shell/OwnSitePass.tsx", "utf8");
assert.match(
  seed,
  /storeOwnerPass\(token, pass\)\.first\) writeWatchPaused\(token, true\)/,
  "nobody asked for Watch here, so the first pass starts it paused",
);
assert.equal(readWatchPaused("fcw_test"), false, "(the paused flag is the widget's own key)");
assert.deepEqual(
  takeOwnerPass("fcw_test"),
  { pass: "pass-1", arrived: false },
  "the widget reads the pass the page stored",
);
assert.equal(takeOwnerPass("fcw_other").pass, null, "per widget token, never another site's");

const minting = readFileSync("src/lib/feedback/own-site-pass.ts", "utf8");
assert.match(
  minting,
  /canActForSite\(userId, site\)/,
  "minted only for whoever may act for the site",
);
assert.match(minting, /WIDGET_TOKEN_STATUS\.ACTIVE/, "and only for a live widget");
const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
assert.match(
  layout,
  /ownSitePass\(widgetToken, viewerId\)/,
  "the app layout asks for the signed-in person",
);

console.log("✓ own-site-pass: the signed-in owner's pass reaches Loki's own widget");
