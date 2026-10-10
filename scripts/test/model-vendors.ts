/**
 * Loki's vendor table is one SSOT: ai-kit's ten, each with the human half
 * filled in, Loki's extras in the same shape, and "your own endpoint" as the
 * one vendor whose host is data rather than config.
 *
 * Pins: nothing ai-kit lists is missing here (a vendor added upstream cannot
 * appear blank); every extra has a real host and key page; the config
 * validator keeps the same bounds as ai-kit's and admits an empty key ONLY
 * for a custom endpoint, which must carry a base URL; labels never carry a key.
 *
 * Run: npx tsx scripts/test/model-vendors.ts
 */
import assert from "node:assert/strict";
import { BYOK_VENDORS, isByokConfig } from "@bitbaum/ai-kit/byok";
import {
  CUSTOM_VENDOR_ID,
  VENDORS,
  VENDOR_IDS,
  VENDOR_KIND_ORDER,
  isAiKitVendor,
  isOwnKeyConfig,
  isVendorId,
  ownKeyLabel,
  vendorById,
} from "@/config/model-vendors";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("model-vendors:");

check("every ai-kit vendor is here, with its host and key page unchanged", () => {
  for (const v of BYOK_VENDORS) {
    const mine = vendorById(v.id);
    assert.ok(mine, `${v.id} missing`);
    assert.equal(mine.baseUrl, v.baseUrl);
    assert.equal(mine.keyUrl, v.keyUrl);
    assert.equal(mine.probe, v.probe);
    assert.equal(isAiKitVendor(mine.id), true);
  }
});

check("every vendor has the human half: blurb, known-for, region, kind, a dated check", () => {
  for (const v of VENDORS) {
    assert.ok(v.blurb.length > 20, `${v.id} blurb`);
    assert.ok(v.knownFor.length > 10, `${v.id} knownFor`);
    assert.match(v.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(
      VENDOR_KIND_ORDER.some((g) => g.kind === v.kind),
      `${v.id} kind`,
    );
    if (v.kind !== "custom") {
      assert.match(v.baseUrl ?? "", /^https:\/\//, `${v.id} host`);
      assert.match(v.keyUrl ?? "", /^https:\/\//, `${v.id} key page`);
      assert.match(v.pricingUrl ?? "", /^https:\/\//, `${v.id} price page`);
      assert.ok(v.region, `${v.id} region`);
    }
    if (v.kind === "lab") assert.ok(v.namespaces.length > 0, `${v.id}: a lab has a namespace`);
    if (v.kind === "host") assert.equal(v.namespaces.length, 0, `${v.id}: a host has none`);
  }
});

check("the Chinese labs are reachable directly, not only through a router", () => {
  for (const id of ["moonshot", "zai", "alibaba", "minimax", "deepseek"]) {
    const v = vendorById(id)!;
    assert.equal(v.kind, "lab");
    assert.equal(v.region, "CN");
    assert.equal(isAiKitVendor(v.id), id === "deepseek");
  }
  assert.equal(vendorById("moonshot")!.namespaces[0], "moonshotai");
  assert.equal(vendorById("zai")!.namespaces[0], "z-ai");
  assert.equal(vendorById("alibaba")!.namespaces[0], "qwen");
});

check("ids are a closed set: isVendorId says no to a URL, a lab name, and nonsense", () => {
  assert.equal(VENDOR_IDS.length, new Set(VENDOR_IDS).size);
  assert.equal(isVendorId("custom"), true);
  assert.equal(isVendorId("moonshot"), true);
  assert.equal(isVendorId("https://api.moonshot.ai/v1"), false);
  assert.equal(isVendorId("Moonshot"), false);
  assert.equal(isVendorId(undefined), false);
  assert.equal(VENDORS[VENDORS.length - 1]!.id, CUSTOM_VENDOR_ID, "your own machine comes last");
});

check("the config validator keeps ai-kit's bounds and adds the endpoint rules", () => {
  const good = { vendor: "anthropic", apiKey: "sk-ant-12345678", model: "claude-opus-5.5" };
  assert.equal(isOwnKeyConfig(good), true);
  assert.equal(isByokConfig(good), true, "the same answer as ai-kit for an ai-kit vendor");
  assert.equal(isOwnKeyConfig({ ...good, apiKey: "short" }), false);
  assert.equal(isOwnKeyConfig({ ...good, apiKey: "" }), false, "a lab needs a key");
  assert.equal(isOwnKeyConfig({ ...good, apiKey: "has space in it" }), false);
  assert.equal(isOwnKeyConfig({ ...good, model: "a\nb" }), false);
  assert.equal(isOwnKeyConfig({ ...good, baseUrl: "https://x.y" }), false, "a lab has no host");
  assert.equal(
    isOwnKeyConfig({ vendor: "moonshot", apiKey: "sk-12345678", model: "kimi-k3" }),
    true,
  );
  const mine = { vendor: "custom", apiKey: "", model: "qwen3", baseUrl: "https://mac.ts.net/v1" };
  assert.equal(isOwnKeyConfig(mine), true, "an endpoint may be keyless");
  assert.equal(isOwnKeyConfig({ ...mine, baseUrl: undefined }), false, "but must have a host");
  assert.equal(isOwnKeyConfig({ ...mine, label: "x".repeat(61) }), false);
  assert.equal(isOwnKeyConfig({ ...mine, label: "MacBook" }), true);
});

check("labels name the vendor (or the endpoint's name) and the model — never a key", () => {
  assert.equal(ownKeyLabel({ vendor: "moonshot", model: "kimi-k3" }), "Moonshot (Kimi) · kimi-k3");
  assert.equal(
    ownKeyLabel({ vendor: "custom", model: "qwen3", label: "MacBook Ollama" }),
    "MacBook Ollama · qwen3",
  );
  assert.equal(ownKeyLabel({ vendor: "custom", model: "qwen3" }), "Your own endpoint · qwen3");
});

console.log(`\nmodel-vendors: ${passed} passed`);
