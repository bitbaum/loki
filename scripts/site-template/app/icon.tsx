import { ImageResponse } from "next/og";

/**
 * The product's icon: the browser tab at 32px, and the install icons at 192
 * and 512 that app/manifest.ts names. One drawing, generated, so a new mark is
 * one edit here and the tab and the home screen cannot disagree. Android only
 * offers "Install app" for a manifest with an icon of at least 144px, which is
 * why a lone favicon is not enough. Served at /icon/32, /icon/192, /icon/512.
 *
 * Replace the placeholder disc with the product's mark.
 */
const SIZES = [32, 192, 512] as const;
export const contentType = "image/png";

export function generateImageMetadata() {
  return SIZES.map((edge) => ({
    id: String(edge),
    size: { width: edge, height: edge },
    contentType,
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const edge = Number(await id);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a1a1a",
        borderRadius: Math.round(edge * 0.22),
      }}
    >
      <div
        style={{
          width: Math.round(edge * 0.4),
          height: Math.round(edge * 0.4),
          borderRadius: "50%",
          background: "#f5f5f5",
        }}
      />
    </div>,
    { width: edge, height: edge },
  );
}
