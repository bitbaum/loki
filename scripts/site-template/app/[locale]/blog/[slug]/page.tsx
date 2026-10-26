import { notFound } from "next/navigation";
import { ArticleBody, ReadingProgress } from "bip-kit/react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { publishedPost } from "@/lib/content";
import { shell, link } from "@/components/ui";
export default async function Post({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(toLocale(locale));
  const t = await getTranslations("Journal");
  const post = publishedPost(slug);
  if (!post) notFound();
  return (
    <div className={`${shell} py-10`}>
      <ReadingProgress />
      <Link className={link} href="/blog">
        {t("back")}
      </Link>
      <article>
        <header className="py-8">
          <p className="text-sm text-fg-secondary">{post.date}</p>
          <h1 className="font-display text-4xl">{post.title}</h1>
          <p className="mt-4 text-fg-secondary">{post.summary}</p>
        </header>
        <ArticleBody blocks={post.blocks} />
      </article>
    </div>
  );
}
