import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { DocContents } from "@/components/public/DocContents";
import { normalizeMarkdown, parseFrontmatter } from "bip-kit";
import { parseThoughtBlocks } from "@/lib/thoughts-content";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "A technical architecture for sustained autonomous execution across many projects simultaneously.",
};

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

// Stable anchor ids for H2 sections — feeds both the ToC links and the
// heading ids, so the two can never drift.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function WhitepaperPage() {
  const raw = fs.readFileSync(path.join(process.cwd(), "content", "whitepaper.md"), "utf-8");
  const { meta, body } = parseFrontmatter(raw);
  const blocks = parseThoughtBlocks(normalizeMarkdown(body));
  const field = (key: string) => {
    const value = meta[key];
    return Array.isArray(value) ? value.join(", ") : value;
  };
  const title = field("title") ?? "Whitepaper";
  const subtitle = field("subtitle") ?? "";
  const version = field("version") ?? "0.1";
  const publishedAt = field("publishedAt") ?? "";
  const toc = blocks.flatMap((block) =>
    block.type === "h2" ? [{ text: block.text, id: slugify(block.text) }] : [],
  );

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="relative z-10 mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-10 sm:pb-32 sm:pt-16">
        <div className="ui-public-doc-header">
          <div className="ui-public-doc-meta-row">
            <span className="ui-public-doc-badge">WHITEPAPER</span>
            <span className="ui-public-doc-meta">v{version}</span>
            {publishedAt && <span className="ui-public-doc-meta">{publishedAt}</span>}
          </div>
          <h1 className="ui-public-doc-title">{title}</h1>
          {subtitle && <p className="ui-public-doc-subtitle">{subtitle}</p>}
        </div>

        {toc.length > 1 && <DocContents toc={toc} />}

        <article className="ui-public-prose ui-public-prose-doc">
          {blocks.map((block, i) => {
            switch (block.type) {
              case "h2":
                return (
                  <h2 key={i} id={slugify(block.text)} className="ui-public-prose-h2 scroll-mt-24">
                    {block.text}
                  </h2>
                );
              case "h3":
                return (
                  <h3 key={i} className="ui-public-prose-h3">
                    {block.text}
                  </h3>
                );
              case "p":
                return (
                  <p
                    key={i}
                    className="ui-public-prose-p"
                    dangerouslySetInnerHTML={{ __html: renderInline(block.text) }}
                  />
                );
              case "blockquote":
                return (
                  <blockquote key={i} className="ui-public-prose-blockquote">
                    {block.text.map((line, j) => (
                      <p key={j} className="ui-public-prose-blockquote-p">
                        {line}
                      </p>
                    ))}
                  </blockquote>
                );
              case "ul":
                return (
                  <ul key={i} className="space-y-2 pl-4">
                    {block.items.map((item, j) => (
                      <li key={j} className="ui-public-prose-li">
                        <span className="ui-public-prose-bullet" />
                        <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                      </li>
                    ))}
                  </ul>
                );
              case "ol":
                return (
                  <ol key={i} className="space-y-2 pl-4">
                    {block.items.map((item, j) => (
                      <li key={j} className="ui-public-prose-li">
                        <span className="ui-public-prose-ol-index">{j + 1}.</span>
                        <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                      </li>
                    ))}
                  </ol>
                );
              case "code":
                return (
                  <div key={i} className="ui-public-code-block">
                    {block.lang && <p className="ui-public-code-lang">{block.lang}</p>}
                    <pre className="ui-public-code-pre">
                      <code>{block.text}</code>
                    </pre>
                  </div>
                );
              default:
                return null;
            }
          })}
        </article>

        <div className="ui-public-doc-footer">
          <p className="ui-public-doc-footer-title">Ready to close the execution gap?</p>
          <p className="ui-public-doc-footer-note">
            Start using {APP_NAME} as your builder operating system.
          </p>
          <div className="mx-auto flex max-w-sm flex-col gap-2.5 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
            <Link href={ROUTES.SIGN_IN} className="ui-public-cta w-full sm:w-auto">
              Get started →
            </Link>
            <Link href="/" className="ui-public-cta-ghost w-full sm:w-auto">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </PublicSurface>
  );
}
