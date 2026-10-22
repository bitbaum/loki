"use client";

import Link from "next/link";
import { citedIds } from "@bitbaum/chatkit";
import { Markdown } from "@bitbaum/chatkit/react";
import { CitationNote } from "./citation-note";

export type CitationMap = Record<string, { label: string; detail: string }>;

/** All LLM output uses the fleet renderer; Loki keeps its own source sheet. */
export function MarkdownText({
  text,
  className,
  citations,
}: {
  text: string;
  className?: string;
  citations?: CitationMap;
}) {
  const records = citations
    ? citedIds(text)
        .filter((id) => citations[id])
        .map((id) => ({ id, ...citations[id] }))
    : [];
  return (
    <>
      <Markdown
        text={withoutCitations(text)}
        className={className}
        sources={false}
        renderLink={({ href, internal, className, children }) =>
          internal ? (
            <Link href={href} className={className}>
              {children}
            </Link>
          ) : (
            <a href={href} className={className} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        }
      />
      {records.length > 0 && <CitationNote records={records} />}
    </>
  );
}

export function withoutCitations(text: string): string {
  return text
    .replace(/(\[[FD]\d+(?:,\s*[FD]\d+)*\])\s*[–-]\s*(?=\[[FD]\d)/g, "$1")
    .replace(/\s*\[[FD]\d+(?:,\s*[FD]\d+)*\]/g, "");
}
