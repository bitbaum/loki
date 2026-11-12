import { ImageResponse } from "next/og";
import {
  APP_DESCRIPTION,
  APP_NAME,
  MARKETING_HERO_PRIMARY,
  MARKETING_HERO_SECONDARY,
  MARKETING_POSITIONING,
} from "@/config/brand";
import { BRAND_MARK, MARK_TURNS, markPathD } from "@/config/brand-mark";
import { PALETTE } from "@/lib/palette";

// Next.js file-convention OG image: served at /opengraph-image and auto-picked
// up by the framework when the root layout's `openGraph` block is set.
// 1200×630 is the canonical Facebook/Slack/Twitter card size (1.91:1 ratio).

export const runtime = "edge";
export const alt = APP_DESCRIPTION;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  // The card a link to Loki draws in a chat or a feed. It was the mark, the
  // name at 96px and the tagline in lower case on a third of the canvas: the
  // one sentence that says what Loki is came last and smallest. Now the
  // sentence is the picture (the homepage's own headline, in its two tones),
  // with the brand above it and the terms under it.
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: PALETTE.dark.surfacePage,
        color: PALETTE.dark.textPrimary,
        padding: "72px 80px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Brand — the rotorelief disc from the SSOT (src/config/brand-mark.ts) */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <svg width="56" height="56" viewBox={`0 0 ${BRAND_MARK.viewBox} ${BRAND_MARK.viewBox}`}>
          <path
            d={markPathD({ turns: MARK_TURNS.hero })}
            fill={PALETTE.dark.textPrimary}
            fillRule="evenodd"
          />
        </svg>
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em" }}>{APP_NAME}</div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 92,
          fontWeight: 700,
          letterSpacing: "-0.035em",
          lineHeight: 1.04,
        }}
      >
        <div>{MARKETING_HERO_PRIMARY}</div>
        <div style={{ color: PALETTE.zinc[400] }}>{MARKETING_HERO_SECONDARY}</div>
      </div>

      <div style={{ fontSize: 30, color: PALETTE.zinc[500] }}>{MARKETING_POSITIONING}</div>
    </div>,
    { ...size },
  );
}
