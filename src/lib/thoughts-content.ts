import path from "path";
import { parseContentBlocks, type ContentBlock } from "bip-kit";
import { readCollection } from "bip-kit/node";

const THOUGHTS_DIR = path.join(process.cwd(), "content", "thoughts");

export type ThoughtMeta = {
  slug: string;
  title: string;
  summary: string;
  excerpt: string;
  publishedAt: string;
  tags: string[];
  featured: boolean;
  author: string;
  readingTimeMin: number;
};

/**
 * The block union, frontmatter, body parser and folder reader live in
 * `bip-kit` — the open-source extract of exactly this file's former inline
 * parser. This repo dogfoods the package; the alias keeps the Thoughts UI's
 * vocabulary.
 */
export type ThoughtBlock = ContentBlock;

// bip-kit frontmatter values can be YAML arrays (`key: [a, b]`); a scalar
// field written that way still reads as one string.
function metaStr(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/**
 * Every essay, newest first. bip-kit reads the folder: frontmatter, the
 * normalized body, and a `publishedAt:` that is not YYYY-MM-DD fails the
 * build naming the file. What stays here is Loki's own vocabulary.
 */
export function listThoughts(): Array<ThoughtMeta & { body: string }> {
  return readCollection(THOUGHTS_DIR).map((entry) => {
    const { meta } = entry;
    return {
      slug: entry.slug,
      title: entry.title,
      // Six early essays carried their one-liner under `subtitle:` — the
      // renderer ignored it and they listed as bare titles. Honor it.
      summary: metaStr(meta.summary) ?? metaStr(meta.subtitle) ?? "",
      excerpt: metaStr(meta.excerpt) ?? metaStr(meta.subtitle) ?? "",
      publishedAt: entry.date,
      tags: entry.tags,
      featured: (metaStr(meta.featured) ?? "false") === "true",
      author: entry.author ?? "Loki",
      readingTimeMin: Number(metaStr(meta.readingTimeMin) ?? entry.readingMinutes),
      body: entry.body,
    };
  });
}

export function getThought(slug: string) {
  return listThoughts().find((a) => a.slug === slug) ?? null;
}

export function listThoughtTags(): string[] {
  return [...new Set(listThoughts().flatMap((article) => article.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function getAdjacentThoughts(slug: string) {
  const articles = listThoughts();
  const index = articles.findIndex((article) => article.slug === slug);
  if (index === -1) return { previous: null, next: null };

  return {
    previous: articles[index + 1] ?? null,
    next: articles[index - 1] ?? null,
  };
}

export function getRelatedThoughts(slug: string, limit = 3) {
  const articles = listThoughts();
  const current = articles.find((article) => article.slug === slug);
  if (!current) return [];

  return articles
    .filter((article) => article.slug !== slug)
    .map((article) => ({
      article,
      sharedTags: article.tags.filter((tag) => current.tags.includes(tag)).length,
    }))
    .filter((entry) => entry.sharedTags > 0)
    .sort(
      (a, b) =>
        b.sharedTags - a.sharedTags || (a.article.publishedAt < b.article.publishedAt ? 1 : -1),
    )
    .slice(0, limit)
    .map((entry) => entry.article);
}

/** Parse an essay body into typed blocks — delegates to bip-kit. */
export const parseThoughtBlocks = parseContentBlocks;
