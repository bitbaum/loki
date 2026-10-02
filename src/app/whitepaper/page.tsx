import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { DocContents } from "@/components/public/DocContents";
import { extractToc, normalizeMarkdown, parseFrontmatter } from "bip-kit";
import "bip-kit/styles.css";
import "../thoughts/[slug]/thoughts-article.css";
import { ThoughtArticleBody } from "@/components/thoughts/ThoughtArticleBody";
import { parseThoughtBlocks } from "@/lib/thoughts-content";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "A technical architecture for sustained autonomous execution across many projects simultaneously.",
};

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
  // The same heading ids the rendered headings carry, so the two cannot drift.
  const toc = extractToc(blocks).filter((entry) => entry.level === 2);
  // The short version, from the document's own frontmatter — so a reader can
  // decide whether to read 1,900 words before scrolling 11,000px of them.
  const summary = Array.isArray(meta.summary) ? meta.summary.map(String) : [];
  const minutes = Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 230));

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="relative z-10 mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-10 sm:pb-32 sm:pt-16">
        <div className="ui-public-doc-header">
          <div className="ui-public-doc-meta-row">
            <span className="ui-public-doc-badge">WHITEPAPER</span>
            <span className="ui-public-doc-meta">v{version}</span>
            {publishedAt && <span className="ui-public-doc-meta">{publishedAt}</span>}
            <span className="ui-public-doc-meta">{minutes} min read</span>
          </div>
          <h1 className="ui-public-doc-title">{title}</h1>
          {subtitle && <p className="ui-public-doc-subtitle">{subtitle}</p>}
        </div>

        {summary.length > 0 && (
          <section className="ui-whitepaper-summary" aria-labelledby="in-short">
            <h2 id="in-short" className="ui-public-eyebrow">
              In short
            </h2>
            <ul className="mt-3 space-y-2">
              {summary.map((line) => (
                <li key={line} className="ui-public-prose-li">
                  <span className="ui-public-prose-bullet" />
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {toc.length > 1 && <DocContents toc={toc} />}

        <article className="ui-whitepaper-body">
          <ThoughtArticleBody blocks={blocks} />
        </article>

        <div className="ui-public-doc-footer">
          <p className="ui-public-doc-footer-title">Ready to close the execution gap?</p>
          <p className="ui-public-doc-footer-note">
            Create an account and give {APP_NAME} your first project. It is free while prices are
            not announced.
          </p>
          <div className="mx-auto flex max-w-sm flex-col gap-2.5 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
            <Link href={ROUTES.SIGN_UP} className="ui-public-cta w-full sm:w-auto">
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
