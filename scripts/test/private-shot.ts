import assert from "node:assert/strict";
import { isAccessGate, tileShotPlan, TILE_VIEWPORT } from "../../src/lib/register/private-shot";

const app = "https://loki.example";

// A preview is photographed through Loki's own route, with the owner's cookie,
// and told it is being photographed (so its widget stays out of the picture).
const preview = tileShotPlan({
  slug: "tsentr-som",
  live: "https://tsentr-som.orangecat.ch",
  appOrigin: app,
  previewCookie: "123.sig",
});
assert.equal(preview.target, `${app}/p/tsentr-som/`);
assert.deepEqual(preview.opts.viewport, TILE_VIEWPORT, "the public tiles' size");
assert.equal(preview.opts.cookies?.[0].value, "123.sig");
assert.equal(preview.opts.cookies?.[0].url, app);
assert.equal(preview.opts.headers?.["x-loki-picture"], "1");

// Any other site: its own address, as a visitor sees it, with nothing of ours.
const site = tileShotPlan({
  slug: "aoz",
  live: "https://aoz.example",
  appOrigin: app,
  previewCookie: null,
});
assert.equal(site.target, "https://aoz.example");
assert.equal(
  site.opts.cookies,
  undefined,
  "no cookie of Loki's is ever sent to someone else's site",
);
assert.equal(site.opts.headers, undefined);

// The picture is named by what is photographed: a moved project is a new picture.
const moved = tileShotPlan({
  slug: "aoz",
  live: "https://aoz.example/new",
  appOrigin: app,
  previewCookie: null,
});
assert.notEqual(site.key, moved.key);
assert.match(site.key, /^aoz-[0-9a-f]{12}$/);

assert.equal(isAccessGate(new Headers({ "x-access-gate": "1" })), true);
assert.equal(isAccessGate(new Headers()), false);
console.log("private-shot: ok");
