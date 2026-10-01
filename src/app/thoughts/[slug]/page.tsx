import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { extractToc } from "bip-kit";
import { Toc, ReadingProgress } from "bip-kit/react";
import "bip-kit/styles.css";
import "./thoughts-article.css";
import { APP_URL } from "@/config/brand";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { ThoughtArticleNav } from "@/components/thoughts/ThoughtArticleNav";
import { ShareBar } from "@/components/thoughts/ShareBar";
import { NewsletterSignup } from "@/components/thoughts/NewsletterSignup";
import { ThoughtArticleBody } from "@/components/thoughts/ThoughtArticleBody";
import { SupersededNotice } from "@/components/thoughts/SupersededNotice";
import { supersededNotice } from "@/lib/thought-superseded";
import {
  getAdjacentThoughts,
  getRelatedThoughts,
  getThought,
  parseThoughtBlocks,
} from "@/lib/thoughts-content";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getThought(slug);
  if (!article) return { title: "Not Found" };
  // type=article + publishedTime + tags turn the OG preview into a recognized
  // article card on Facebook/LinkedIn/Slack. Image falls back to the root
  // layout's /opengraph-image (generic Loki card) until a per-essay
  // image generator exists.
  return {
    title: article.title,
    description: article.summary,
    alternates: {
      types: { "application/rss+xml": "/rss.xml" },
    },
    openGraph: {
      type: "article",
      title: article.title,
      description: article.summary,
      publishedTime: article.publishedAt || undefined,
      tags: article.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.summary,
    },
  };
}

export default async function ThoughtArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getThought(slug);
  if (!article) notFound();
  const blocks = parseThoughtBlocks(article.body);
  const toc = extractToc(blocks);
  const { previous, next } = getAdjacentThoughts(slug);
  const related = getRelatedThoughts(slug);
  const superseded = supersededNotice(article);

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <ReadingProgress />
      <div className="relative z-10 mx-auto max-w-5xl space-y-6 px-6 pb-24 pt-16 sm:px-10">
        <div className="ui-public-doc-header">
          <h1 className="ui-public-doc-title">{article.title}</h1>
          {article.summary && <p className="ui-public-doc-subtitle">{article.summary}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/thoughts" className="ui-btn-chip">
            All essays
          </Link>
          <span className="ui-badge">{article.publishedAt}</span>
          <span className="ui-badge">{article.readingTimeMin} min</span>
          {article.tags.map((tag) => (
            <span key={tag} className="ui-tag ui-tag-neutral">
              {tag}
            </span>
          ))}
          <div className="ml-auto">
            <ShareBar url={`${APP_URL}/thoughts/${slug}`} title={article.title} />
          </div>
        </div>

        {superseded && <SupersededNotice notice={superseded} />}

        {/* On xl the sticky TOC gets a right rail; the article column keeps
            bip-kit's measured line length regardless. Toc hides itself under
            3 headings, so short essays render a clean single column. */}
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_240px] xl:items-start xl:gap-8">
          <article className="ui-card-shell-raised p-6 md:p-8">
            <ThoughtArticleBody blocks={blocks} />
          </article>
          <aside className="hidden xl:block">
            <Toc items={toc} />
          </aside>
        </div>

        <NewsletterSignup source={slug} />

        <ThoughtArticleNav previous={previous} next={next} related={related} />
      </div>
    </PublicSurface>
  );
}
