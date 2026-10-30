import { ImageResponse } from "next/og";
import { APP_NAME, APP_TAGLINE, APP_DESCRIPTION } from "@/config/brand";
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
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        background: PALETTE.dark.surfacePage,
        color: PALETTE.dark.textPrimary,
        padding: "80px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Brand mark — rotorelief disc from the SSOT (src/config/brand-mark.ts) */}
      <svg
        width="120"
        height="120"
        viewBox={`0 0 ${BRAND_MARK.viewBox} ${BRAND_MARK.viewBox}`}
        style={{ marginBottom: 48 }}
      >
        <path
          d={markPathD({ turns: MARK_TURNS.hero })}
          fill={PALETTE.dark.textPrimary}
          fillRule="evenodd"
        />
      </svg>

      <div
        style={{
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        {APP_NAME}
      </div>
      <div
        style={{
          marginTop: 24,
          fontSize: 36,
          color: PALETTE.zinc[400],
          lineHeight: 1.2,
          maxWidth: 900,
        }}
      >
        {APP_TAGLINE}
      </div>
    </div>,
    { ...size },
  );
}
