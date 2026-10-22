"use client";

import Link from "next/link";
import { citedIds } from "@bitbaum/chatkit";
import { Markdown, type RenderLink } from "@bitbaum/chatkit/react";
import { CitationNote } from "@/components/ui/citation-note";
import { withoutCitations, type CitationMap } from "@/components/ui/markdown-text";

/**
 * An answer in the Loki chat, drawn by the fleet's renderer: a list of named
 * things reads as cards, a table is a table, headings keep their level, and
 * the sources the answer cites are ONE button under it that opens every
 * record (CitationNote), the way MarkdownText did — the handles themselves
 * are taken out of the sentences first. Other LLM-output surfaces
 * (digests, project bios, the work trail) use the same renderer via MarkdownText.
 */
export function AnswerMarkdown({
  text,
  citations,
  onReply,
}: {
  text: string;
  citations?: CitationMap;
  onReply?: (text: string) => void;
}) {
  const records = citations
    ? citedIds(text)
        .filter((id) => citations[id])
        .map((id) => ({ id, ...citations[id]! }))
    : [];
  return (
    <>
      <Markdown
        text={withoutCitations(text)}
        renderLink={renderLink}
        sources={false}
        onReply={onReply}
      />
      {records.length > 0 && (
        <p className="ui-loki-answer-sources">
          <CitationNote records={records} />
        </p>
      )}
    </>
  );
}

// An in-app route must navigate in place — a new tab strands the reader
// outside the app they are already in.
const renderLink: RenderLink = ({ href, internal, className, children }) =>
  internal ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
