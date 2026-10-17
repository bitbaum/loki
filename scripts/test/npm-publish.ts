/**
 * Every package onto npm from a phone: the key is kept sealed, GitHub gets it
 * in the format it can open, npm is asked the right questions, and the key
 * never travels back to a browser.
 *
 * Run: npx tsx scripts/test/npm-publish.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sodium from "libsodium-wrappers";
import { openSecret, sealSecret } from "../../src/lib/secret-box";
import {
  keyUsable,
  npmHasPackage,
  npmKeyOwner,
  recentlyStarted,
  sealForGithub,
} from "../../src/lib/packages/npm-publish-rules";
import {
  KEY_EXPIRY_MARGIN_MS,
  NPM_KEY_SETTINGS,
  RETRY_AFTER_MS,
  SaveNpmKeyBody,
} from "../../src/config/npm-publishing";

process.env.AUTH_SECRET = "test-secret-for-npm-publish";

async function main() {
  // ---- the key at rest ----
  const key = `npm_${"a1B2c3D4e5".repeat(3)}abcdef`;
  const sealed = sealSecret(key);
  assert.ok(sealed.startsWith("v1."), "versioned");
  assert.ok(!sealed.includes(key), "the key is not in the sealed text");
  assert.equal(openSecret(sealed), key, "opens to the same key");
  assert.notEqual(sealSecret(key), sealed, "a fresh IV every time");
  const [v, iv, tag, body] = sealed.split(".");
  const flipped = body.slice(0, -2) + (body.endsWith("A") ? "BB" : "AA");
  assert.equal(openSecret([v, iv, tag, flipped].join(".")), null, "tampering is refused");
  assert.equal(openSecret("v2.x.y.z"), null, "an unknown version opens nothing");
  process.env.AUTH_SECRET = "a-different-server";
  assert.equal(openSecret(sealed), null, "another server's secret opens nothing");
  process.env.AUTH_SECRET = "test-secret-for-npm-publish";

  // ---- GitHub's sealed box: GitHub (holding the private key) can open it ----
  await sodium.ready;
  const repoKeys = sodium.crypto_box_keypair();
  const forGithub = await sealForGithub(
    sodium.to_base64(repoKeys.publicKey, sodium.base64_variants.ORIGINAL),
    key,
  );
  const opened = sodium.crypto_box_seal_open(
    sodium.from_base64(forGithub, sodium.base64_variants.ORIGINAL),
    repoKeys.publicKey,
    repoKeys.privateKey,
    "text",
  );
  assert.equal(opened, key, "GitHub opens exactly the key");

  // ---- timing ----
  const now = new Date("2026-10-17T12:00:00Z");
  assert.ok(keyUsable(null, now), "no date: usable");
  assert.ok(keyUsable(new Date(now.getTime() + KEY_EXPIRY_MARGIN_MS + 60_000), now));
  assert.ok(
    !keyUsable(new Date(now.getTime() + KEY_EXPIRY_MARGIN_MS - 60_000), now),
    "stops early",
  );
  assert.ok(!recentlyStarted(undefined, now));
  assert.ok(recentlyStarted(new Date(now.getTime() - 60_000).toISOString(), now));
  assert.ok(!recentlyStarted(new Date(now.getTime() - RETRY_AFTER_MS - 1).toISOString(), now));
  assert.ok(!recentlyStarted("not a date", now));

  // ---- asking npm ----
  const urls: string[] = [];
  const answer = (status: number, json: unknown = {}) =>
    (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(json), { status });
    }) as typeof fetch;
  assert.equal(await npmHasPackage("@bitbaum/whenkit", answer(200)), true);
  assert.ok(urls.at(-1)?.endsWith("/@bitbaum%2Fwhenkit"), "the registry's scoped path");
  assert.equal(await npmHasPackage("@bitbaum/whenkit", answer(404)), false);
  assert.equal(
    await npmHasPackage("@bitbaum/whenkit", answer(503)),
    null,
    "unknown is not 'missing'",
  );
  const throws = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.equal(await npmHasPackage("x", throws), null);
  assert.deepEqual(await npmKeyOwner(key, answer(200, { username: "maonakamoto" })), {
    ok: true,
    user: "maonakamoto",
  });
  assert.deepEqual(await npmKeyOwner(key, answer(401)), { ok: false, reason: "rejected" });
  assert.deepEqual(await npmKeyOwner(key, throws), { ok: false, reason: "unreachable" });

  // ---- what the panel accepts ----
  assert.ok(SaveNpmKeyBody.safeParse({ key }).success);
  assert.equal(SaveNpmKeyBody.parse({ key }).days, 90, "90 days unless said");
  assert.ok(!SaveNpmKeyBody.safeParse({ key: "ghp_notnpm" }).success);
  assert.ok(!SaveNpmKeyBody.safeParse({ key, days: 0 }).success);
  assert.ok(
    NPM_KEY_SETTINGS.some((s) => /Bypass two-factor/.test(s.field)),
    "the setting that matters",
  );

  // ---- the key never goes back out ----
  const route = readFileSync("src/app/api/packages/npm-key/route.ts", "utf8");
  assert.ok(
    !/sealed:\s*row|row\.sealed|openSecret/.test(route),
    "the route never returns or opens the key",
  );
  assert.match(route, /npmKeyOwner\(body\.key\)/, "npm checks a key before Loki keeps it");
  assert.match(
    readFileSync("src/config/demo.ts", "utf8"),
    /\["\/api\/packages\/npm-key", "credentials"\]/,
    "the shared demo account can never hold a key",
  );
  const panel = readFileSync("src/components/packages/NpmPublishPanel.tsx", "utf8");
  assert.match(panel, /ui-input-secret/, "masked as it is pasted");
  assert.match(panel, /autoComplete="off"/, "never offered to a password manager");

  console.log("npm-publish: ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
