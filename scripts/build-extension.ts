/**
 * Builds Loki for Firefox (extension/) into extension/dist — the unpacked
 * extension, ready for `web-ext sign` or to load as a temporary add-on.
 *
 * The manifest is GENERATED, not checked in: its content scripts must match
 * exactly the hosts recipes fill (config/browser-tasks.ts → BROWSER_RECIPE_HOSTS)
 * plus Loki's own origin, so adding a recipe widens the extension's reach in
 * one place and nowhere else, and a site no recipe names is never touched.
 *
 * Run: npx tsx scripts/build-extension.ts
 */
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { APP_DOMAIN } from "../src/config/brand";
import { BROWSER_RECIPE_HOSTS } from "../src/config/browser-tasks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "extension", "dist");

/** Bump to ship a new extension version (AMO refuses a repeated number). */
export const EXTENSION_VERSION = "0.1.0";

export function extensionManifest() {
  return {
    manifest_version: 3,
    name: "Loki",
    version: EXTENSION_VERSION,
    description:
      "Loki fills forms for you in this browser and stops at the final button, so the one click that is yours stays yours.",
    homepage_url: `https://${APP_DOMAIN}/fill`,
    icons: { "48": "icon.svg", "96": "icon.svg" },
    // Firefox runs `scripts` as an event page; Chromium (used only to test the
    // extension) runs `service_worker`. Each ignores the key it does not use.
    background: { scripts: ["background.js"], service_worker: "background.js" },
    permissions: ["storage"],
    content_scripts: [
      { matches: [`https://${APP_DOMAIN}/*`], js: ["loki.js"], run_at: "document_start" },
      {
        matches: BROWSER_RECIPE_HOSTS.map((host) => `https://${host}/*`),
        js: ["fill.js"],
        run_at: "document_idle",
      },
    ],
    browser_specific_settings: {
      gecko: { id: "browser@loki.orangecat.ch", strict_min_version: "121.0" },
      gecko_android: { strict_min_version: "121.0" },
    },
  };
}

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: {
      background: "extension/src/background.ts",
      loki: "extension/src/loki.ts",
      fill: "extension/src/fill.ts",
    },
    outdir: out,
    bundle: true,
    format: "iife",
    target: "firefox121",
    alias: { "@": join(root, "src") },
    define: { "process.env.NEXT_PUBLIC_APP_DOMAIN": JSON.stringify(APP_DOMAIN) },
    logLevel: "warning",
  });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(extensionManifest(), null, 2)}\n`);
  copyFileSync(join(root, "public", "icon.svg"), join(out, "icon.svg"));
  console.log(
    `extension built → ${out} (v${EXTENSION_VERSION}, fills: ${BROWSER_RECIPE_HOSTS.join(", ")})`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
