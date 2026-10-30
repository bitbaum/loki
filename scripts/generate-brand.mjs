#!/usr/bin/env node
// Generate EVERY brand raster/vector asset from the single SSOT in
// src/config/brand-mark.ts. Run via `npm run generate:brand`.
//
//   public/icon.svg                  favicon (disc on dark rounded rect)
//   public/apple-icon.png            180px apple touch icon
//   public/app-icons/*.png           PWA install icons (192, 512, maskable)
//   desktop/resources/icon.png       1024px electron app icon
//   desktop/resources/tray-icon.png  22px monochrome tray glyph (+ @2x 44px)
//   .tmp/brand-preview-*.png         previews for visual review
//
// sharp rasterizes the SVG (librsvg). Keep desktop dependency-free: the PNGs
// are written straight into desktop/resources here and committed, so the
// desktop build just consumes them.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Load the TS SSOT through tsx's loader if present, else a tiny inline copy is
// avoided — we require running under `node --import tsx` or `tsx`. The npm
// script uses tsx.
const { brandMarkSvg, MARK_TURNS } = await import(
  pathToFileURL(join(ROOT, "src/config/brand-mark.ts")).href
);

const INK = "#ededed"; // off-white disc
const CANVAS = "#0a0a0a"; // near-black brand canvas

// Optical sizes: the coil sheds turns as the render shrinks (MARK_TURNS).
const turnsFor = (px) =>
  px <= 24 ? MARK_TURNS.tiny : px <= 64 ? MARK_TURNS.small : MARK_TURNS.large;
const svgGlyph = brandMarkSvg({ fill: INK, turns: MARK_TURNS.tiny }); // transparent
const iconAt = (px) =>
  brandMarkSvg({ fill: INK, background: CANVAS, radius: 22, turns: turnsFor(px) });
const svgIcon = iconAt(16); // the favicon draws at 16–32px: keep its coil open

async function png(svg, size, out) {
  const buf = await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`wrote ${out.replace(ROOT + "/", "")} (${size}px, ${buf.length} bytes)`);
}

// Favicon — keep the .svg as the crisp source of truth.
writeFileSync(join(ROOT, "public/icon.svg"), svgIcon + "\n");
console.log("wrote public/icon.svg");

await png(iconAt(180), 180, join(ROOT, "public/apple-icon.png"));
await png(iconAt(1024), 1024, join(ROOT, "desktop/resources/icon.png"));
await png(svgGlyph, 22, join(ROOT, "desktop/resources/tray-icon.png"));
await png(svgGlyph, 44, join(ROOT, "desktop/resources/tray-icon@2x.png"));

// Linux installer icon set. electron-builder hands `linux.icon` to fpm
// verbatim: given one PNG it installs that single file at its own resolution,
// so a lone 1024px icon lands only in hicolor/1024x1024 — a size no desktop
// panel looks in, which is why Fleet Runner showed a blank launcher on KDE.
// Given a DIRECTORY it installs every <size>x<size>.png into the matching
// hicolor bucket. Rasterized from the SVG at each size rather than downscaled
// from icon.png, so the 16px glyph stays legible.
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  await png(iconAt(size), size, join(ROOT, `desktop/resources/icons/${size}x${size}.png`));
}

// PWA install icons (public/manifest.json). The maskable one sits the tile
// inside the safe zone on a full-bleed canvas, so a launcher's circle or
// squircle crop never cuts the disc.
for (const size of [180, 192, 512]) {
  await png(iconAt(size), size, join(ROOT, `public/app-icons/icon-${size}.png`));
}
{
  const inset = await sharp(Buffer.from(iconAt(384)), { density: 384 })
    .resize(384, 384)
    .png()
    .toBuffer();
  const buf = await sharp({ create: { width: 512, height: 512, channels: 4, background: CANVAS } })
    .composite([{ input: inset, gravity: "centre" }])
    .png()
    .toBuffer();
  writeFileSync(join(ROOT, "public/app-icons/maskable-512.png"), buf);
  console.log("wrote public/app-icons/maskable-512.png (512px)");
}

// Previews for visual review (dark bg behind the transparent glyph too).
await png(iconAt(256), 256, join(ROOT, ".tmp/brand-preview-icon.png"));
await png(iconAt(64), 64, join(ROOT, ".tmp/brand-preview-64.png"));
await png(iconAt(16), 16, join(ROOT, ".tmp/brand-preview-16.png"));
console.log("done");
