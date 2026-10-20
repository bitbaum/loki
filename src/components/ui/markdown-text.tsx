import type { ReactNode } from "react";
import Link from "next/link";
import { CitationNote } from "./citation-note";

// Renderer for plain LLM output: paragraphs, list bullets, headings, **bold**,
// `inline code`, [links](url), and ```fenced code blocks```. Deliberately a
// small hand-rolled subset (no tables/images) — pull in a real markdown lib if a
// surface needs more. Lives in ui/ so every LLM-output panel (digest, project
// bios, Loki responses) renders consistently.
export function MarkdownText({
  text,
  className,
  citations,
}: {
  text: string;
  className?: string;
  citations?: CitationMap;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={className ?? "space-y-2 text-sm leading-relaxed text-text-secondary"}>
      {blocks.map((block, i) => {
        if (block.kind === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-xs leading-relaxed text-text-primary"
            >
              <code className="font-mono whitespace-pre">{block.items.join("\n")}</code>
            </pre>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={i} className="space-y-1 pl-4 list-disc marker:text-text-tertiary">
              {block.items.map((item, j) => (
                <li key={j}>
                  {renderInline(item)}
                  {sourcesFor(item, citations)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "h") {
          return (
            <h3 key={i} className="text-sm font-semibold text-text-primary mt-2">
              {renderInline(block.items[0])}
            </h3>
          );
        }
        return (
          <p key={i}>
            {renderInline(block.items[0])}
            {sourcesFor(block.items[0], citations)}
          </p>
        );
      })}
    </div>
  );
}

type Block = { kind: "p" | "ul" | "h" | "code"; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let currentList: string[] | null = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // ``` fenced code block — collect verbatim until the closing fence.
    if (line.startsWith("```")) {
      currentList = null;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", items: code });
      continue; // i sits on the closing fence; the for-loop's i++ skips it
    }
    if (!line) {
      currentList = null;
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!currentList) {
        currentList = [];
        blocks.push({ kind: "ul", items: currentList });
      }
      currentList.push(line.slice(2));
    } else if (/^#{1,3} /.test(line)) {
      currentList = null;
      blocks.push({ kind: "h", items: [line.replace(/^#+\s+/, "")] });
    } else {
      currentList = null;
      blocks.push({ kind: "p", items: [line] });
    }
  }
  return blocks;
}

// Inline spans: `code`, **bold**, [text](url) links and bare https URLs. One
// split keeps the order they appear; everything else is plain text. Bare URLs
// joined late: run outcomes wrote "Pull request: https://…" and it rendered
// as text you could not tap, on the one surface meant to save the trip.
const INLINE_RE =
  /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|\[[FD]\d+(?:,\s*[FD]\d+)*\]|https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;

/**
 * What a grounded answer's [F8] / [D1] handle refers to.
 *
 * Citations exist so a claim can be traced, but a raw `[F8]` in a sentence is
 * internal plumbing wearing the costume of a source — it tells the reader
 * nothing and makes the prose worse. The handles are taken out of the sentence
 * and the paragraph ends with ONE "Sources" button that opens every record it
 * cited, on a phone or with a keyboard. Unknown handles are dropped.
 *
 * One button per paragraph, not one per claim: a button has to be 44px tall to
 * be tapped, so eight of them inline (observed on the live site, 2026-10-15)
 * made every line a different height and turned one answer into a wall of
 * "Source" — the reading got worse exactly where the answer was most careful.
 */
export type CitationMap = Record<string, { label: string; detail: string }>;

const CITE_RE = /\[[FD]\d+(?:,\s*[FD]\d+)*\]/g;

/** The paragraph's one sources button, or nothing when it cites no known record. */
function sourcesFor(text: string, citations?: CitationMap): ReactNode {
  if (!citations) return null;
  const ids = [...text.matchAll(CITE_RE)].flatMap((m) => m[0].slice(1, -1).split(/,\s*/));
  const known = [...new Set(ids.filter((id) => citations[id]))];
  if (known.length === 0) return null;
  return <CitationNote records={known.map((id) => ({ id, ...citations[id] }))} />;
}

/** The sentence without its handles: "offline [F1]." reads "offline.", and a
 *  range "[F5]–[F7]" leaves no stray dash behind. */
export function withoutCitations(text: string): string {
  return text
    .replace(/(\[[FD]\d+(?:,\s*[FD]\d+)*\])\s*[–-]\s*(?=\[[FD]\d)/g, "$1")
    .replace(/\s*\[[FD]\d+(?:,\s*[FD]\d+)*\]/g, "");
}

function renderInline(text: string): ReactNode {
  return withoutCitations(text)
    .split(INLINE_RE)
    .map((part, i) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded bg-surface-raised px-1 py-0.5 font-mono text-text-primary"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="text-text-primary">
            {part.slice(2, -2)}
          </strong>
        );
      }
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        const linkClass = "text-accent-text underline underline-offset-2 hover:text-text-primary";
        // An in-app route must navigate in place — a new tab strands the reader
        // outside the app they are already in (observed on the phone: tapping
        // "Review on Today" in a Loki reply opened a second browser tab).
        if (link[2].startsWith("/")) {
          return (
            <Link key={i} href={link[2]} className={linkClass}>
              {link[1]}
            </Link>
          );
        }
        return (
          <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className={linkClass}>
            {link[1]}
          </a>
        );
      }
      if (/^https?:\/\//.test(part)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent-text underline underline-offset-2 hover:text-text-primary"
          >
            {part.replace(/^https?:\/\//, "")}
          </a>
        );
      }
      return <span key={i}>{part}</span>;
    });
}
