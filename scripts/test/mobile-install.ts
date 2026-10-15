import ts from "typescript";
import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";
async function main() {
  Object.assign(globalThis, { AsyncLocalStorage });
  const { unstable_doesMiddlewareMatch: unstable_doesProxyMatch } =
    await import("next/experimental/testing/server");
  const parsed = ts.createSourceFile(
    "proxy.ts",
    fs.readFileSync("src/proxy.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = parsed.statements
    .filter(ts.isVariableStatement)
    .flatMap((s) => [...s.declarationList.declarations])
    .find((d) => d.name.getText(parsed) === "config")!;
  const proxyConfig = new Function(`return (${declaration.initializer!.getText(parsed)});`)();
  for (const url of [
    "/app-icons/icon-192.png",
    "/app-icons/icon-512.png",
    "/app-icons/icon-180.png",
    "/app-icons/maskable-512.png",
    "/sw.js",
    "/manifest.json",
  ]) {
    assert(
      !unstable_doesProxyMatch({ config: proxyConfig, url }),
      `${url} must be available before signing in`,
    );
  }
  for (const url of [
    "/api/me/preferences",
    "/api/projects",
    "/control",
    "/app-icons-private",
    "/sw.js/private",
  ])
    assert(unstable_doesProxyMatch({ config: proxyConfig, url }), `${url} stays protected`);
  const manifest = JSON.parse(fs.readFileSync("public/manifest.json", "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  for (const n of [192, 512]) {
    const icon = manifest.icons.find(
      (i: { sizes: string; type: string; purpose: string }) =>
        i.sizes === `${n}x${n}` && i.type === "image/png" && i.purpose === "any",
    );
    assert(icon, `install requires a ${n}px PNG icon`);
    const metadata = await sharp(`public${icon.src}`).metadata();
    assert.equal(metadata.width, n);
    assert.equal(metadata.height, n);
  }
  const mask = manifest.icons.find((i: { purpose: string }) => i.purpose === "maskable");
  assert(mask);
  assert.equal((await sharp(`public${mask.src}`).metadata()).width, 512);
  assert.equal((await sharp("public/app-icons/icon-180.png").metadata()).width, 180);
  console.log("✓ standalone install manifest has valid phone, maskable and Apple raster icons");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
