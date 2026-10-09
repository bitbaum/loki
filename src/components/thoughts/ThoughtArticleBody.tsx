import fs from "fs";
import path from "path";
import { ArticleBody, setHighlighterLoader } from "bip-kit/react";
import { MermaidBlock } from "bip-kit/react/mermaid";

// shiki is an OPTIONAL peer of bip-kit; its zero-config load goes through an
// import the bundler and Next's file tracer cannot see, so a standalone
// deploy would silently ship without shiki and lose highlighting (this exact
// hole shipped once). bip-kit 0.2.1's supported seam: register the loader at
// module scope so the literal `import("shiki")` lives in OUR code, where the
// bundler resolves and ships it. This runs on import, before any ArticleBody
// render, and replaces the old serverExternalPackages entry + deploy-time
// node_modules/shiki symlink.
setHighlighterLoader(() => import("shiki"));

import { parseThoughtBlocks, type ThoughtBlock } from "@/lib/thoughts-content";
import { DeepBlock, deepTitle, isDeepBlock } from "./DeepBlock";

/**
 * Essay body renderer: bip-kit's reference renderer (`ArticleBody`) with two
 * Loki-specific behaviors layered on top of the raw block stream:
 *
 * 1. Alt-as-caption. Essays here caption images through the alt text (the
 *    pre-bip-kit renderer displayed `alt` as the figcaption). bip-kit only
 *    captions `figure` blocks (the `![alt](src "caption")` syntax), so plain
 *    `image` blocks with a non-empty alt are promoted to `figure` blocks with
 *    `caption = alt` — existing captions keep rendering without editing 60+
 *    essays.
 *
 * 2. Inline local SVG diagrams. Repo-authored SVGs under /public/thoughts
 *    reference design tokens (var(--*)) for fill/stroke so they flip with the
 *    theme. An external <img> SVG cannot read page CSS vars and would freeze
 *    to hardcoded hex, so those blocks are rendered as inlined SVG markup
 *    (trusted committed content, never user input) instead of going through
 *    bip-kit's <img>-based Figure. The block stream is split into segments
 *    around them; everything else renders through ArticleBody.
 */

// Read a repo-authored SVG diagram from /public so it can be inlined into the
// DOM. Only same-origin absolute paths are allowed, and any miss falls back
// to the regular <img> path. Returns null on any failure.
function readLocalSvg(src: string): string | null {
  if (!src.startsWith("/") || src.includes("..")) return null;
  try {
    return fs.readFileSync(path.join(process.cwd(), "public", src), "utf-8");
  } catch {
    return null;
  }
}

type SvgSegment = { kind: "svg"; svg: string; alt: string; caption?: string };
type DeepSegment = { kind: "deep"; title: string; blocks: ThoughtBlock[] };
type Segment = { kind: "article"; blocks: ThoughtBlock[] } | SvgSegment | DeepSegment;

function toSegments(blocks: ThoughtBlock[]): Segment[] {
  const segments: Segment[] = [];
  let current: ThoughtBlock[] = [];
  const footnotes: ThoughtBlock[] = [];

  const flush = () => {
    if (current.length > 0) segments.push({ kind: "article", blocks: current });
    current = [];
  };

  for (const block of blocks) {
    // A ```deep fence: a closed technical section (DeepBlock), rendered as
    // its own segment so the native <details> wraps a whole ArticleBody.
    if (isDeepBlock(block)) {
      flush();
      segments.push({
        kind: "deep",
        title: deepTitle(block.lang),
        blocks: parseThoughtBlocks(block.text),
      });
      continue;
    }
    if (block.type === "image" || block.type === "figure") {
      const caption =
        block.type === "figure" ? block.caption : block.alt.trim() ? block.alt : undefined;
      const svg = block.src.endsWith(".svg") ? readLocalSvg(block.src) : null;
      if (svg) {
        flush();
        segments.push({ kind: "svg", svg, alt: block.alt, caption });
        continue;
      }
      // Alt-as-caption promotion for raster/remote images.
      if (block.type === "image" && caption) {
        current.push({ type: "figure", src: block.src, alt: block.alt, caption });
        continue;
      }
    }
    // Hoist footnote definitions to the last segment: ArticleBody collects
    // them per call, and a mid-article footnotes section (possible once the
    // stream is split around an SVG) would read as a bug.
    if (block.type === "footnote") {
      footnotes.push(block);
      continue;
    }
    current.push(block);
  }
  current.push(...footnotes);
  flush();
  return segments;
}

export function ThoughtArticleBody({ blocks }: { blocks: ThoughtBlock[] }) {
  return (
    <>
      {toSegments(blocks).map((segment, i) =>
        segment.kind === "article" ? (
          <ArticleBody key={i} blocks={segment.blocks} components={{ mermaid: MermaidBlock }} />
        ) : segment.kind === "deep" ? (
          <div key={i} className="bp-article">
            <DeepBlock title={segment.title} blocks={segment.blocks} />
          </div>
        ) : (
          <div key={i} className="bp-article">
            <figure className="bp-figure">
              <div
                role="img"
                aria-label={segment.alt || undefined}
                className="[&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: segment.svg }}
              />
              {segment.caption && (
                <figcaption className="bp-figcaption">{segment.caption}</figcaption>
              )}
            </figure>
          </div>
        ),
      )}
    </>
  );
}
