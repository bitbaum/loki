import { ArticleBody } from "bip-kit/react";
import { MermaidBlock } from "bip-kit/react/mermaid";
import type { ThoughtBlock } from "@/lib/thoughts-content";

/**
 * A technical section the reader opens if they want it.
 *
 * Essays here are written for anyone first; the parts that name files,
 * regexes and seams sit behind one line — "Under the hood: …" — as a native
 * <details>, closed by default. The markdown is a fence:
 *
 *     ```deep Under the hood: the grammar
 *     ordinary markdown, any blocks
 *     ```
 *
 * bip-kit parses an unknown fence as a code block whose `lang` is the whole
 * info string, so the renderer re-parses the body as markdown and renders it
 * through the same ArticleBody. No JavaScript, keyboard and screen-reader
 * native, and the printed page shows it closed, which is what it is.
 */
export const DEEP_LANG = "deep";

export function isDeepBlock(block: ThoughtBlock): block is Extract<ThoughtBlock, { type: "code" }> {
  return block.type === "code" && block.lang.split(/\s+/)[0] === DEEP_LANG;
}

export function deepTitle(lang: string): string {
  return lang.slice(DEEP_LANG.length).trim() || "Under the hood";
}

export function DeepBlock({ title, blocks }: { title: string; blocks: ThoughtBlock[] }) {
  return (
    <details className="bp-deep">
      <summary className="bp-deep-summary">{title}</summary>
      <div className="bp-deep-body">
        <ArticleBody blocks={blocks} components={{ mermaid: MermaidBlock }} />
      </div>
    </details>
  );
}
