/** Raster install icons from the existing brand SVG. Run after changing public/icon.svg. */
import fs from "node:fs/promises";
import sharp from "sharp";
const svg = await fs.readFile(new URL("../public/icon.svg", import.meta.url));
const directory = new URL("../public/app-icons/", import.meta.url);
await fs.mkdir(directory, { recursive: true });
for (const size of [180, 192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(new URL(`icon-${size}.png`, directory).pathname);
}
const background = /<rect[^>]*fill="([^"]+)"/.exec(svg.toString())?.[1];
if (!background) throw new Error("Brand icon has no background colour");
const inset = await sharp(svg).resize(384, 384).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: inset, gravity: "centre" }])
  .png()
  .toFile(new URL("maskable-512.png", directory).pathname);
