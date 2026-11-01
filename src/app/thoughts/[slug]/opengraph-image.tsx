import { ImageResponse } from "next/og";
import { getThought } from "@/lib/thoughts-content";
import { APP_NAME } from "@/config/brand";
import { BRAND_MARK, MARK_TURNS, markPathD } from "@/config/brand-mark";
import { PALETTE } from "@/lib/palette";

// Per-essay OG image: dark 1200×630 canvas with a small brand stamp top-left,
// the essay title large, summary as 2-line clamp, and a footer row showing
// publishedAt + reading time + up to 3 tags. Same Satori pattern as
// /u/[username]/opengraph-image; reads from filesystem (listThoughts) so no
// edge runtime — default Node runtime is correct.

export const alt = `Essay on ${APP_NAME}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function EssayOGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = getThought(slug);

  if (!article) {
    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PALETTE.dark.surfacePage,
          color: PALETTE.zinc[400],
          fontSize: 48,
          fontFamily: "sans-serif",
        }}
      >
        Essay not found
      </div>,
      { ...size },
    );
  }

  const visibleTags = article.tags.slice(0, 3);
  const metaParts = [
    article.publishedAt || null,
    `${article.readingTimeMin} min read`,
    `by ${article.author}`,
  ].filter((p): p is string => Boolean(p));

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
        padding: "64px 80px",
        fontFamily: "sans-serif",
      }}
    >
      {/* Brand stamp — rotorelief disc from the SSOT (src/config/brand-mark.ts) */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <svg width="40" height="40" viewBox={`0 0 ${BRAND_MARK.viewBox} ${BRAND_MARK.viewBox}`}>
          <path
            d={markPathD({ turns: MARK_TURNS.small })}
            fill={PALETTE.dark.textPrimary}
            fillRule="evenodd"
          />
        </svg>
        <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em" }}>{APP_NAME}</span>
        <span style={{ fontSize: 20, color: PALETTE.zinc[600], marginLeft: 4 }}>· Essay</span>
      </div>

      {/* Title + summary */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {article.title}
        </div>
        {article.summary && (
          <div
            style={{
              fontSize: 28,
              color: PALETTE.zinc[400],
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {article.summary}
          </div>
        )}
      </div>

      {/* Footer meta — published date, read time, tags */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 22,
            color: PALETTE.zinc[400],
          }}
        >
          {metaParts.map((part, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {i > 0 && <span style={{ color: PALETTE.zinc[600] }}>·</span>}
              <span>{part}</span>
            </div>
          ))}
        </div>
        {visibleTags.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {visibleTags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 18,
                  color: PALETTE.zinc[400],
                  border: `1px solid ${PALETTE.zinc[700]}`,
                  borderRadius: 999,
                  padding: "6px 14px",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>,
    { ...size },
  );
}
