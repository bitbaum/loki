import { HeroSection } from "@bitbaum/sitekit/react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/routing";
import { publishedPosts } from "@/lib/content";
import { SITE } from "@/lib/site";
import { shell, link } from "@/components/ui";
export default async function Journal({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const t = await getTranslations("Journal");
  const posts = publishedPosts();
  return (
    <div className={shell}>
      <HeroSection
        appearance="application"
        section={{ kind: "hero", eyebrow: SITE.title, statement: t("title"), lead: [t("lead")] }}
      />
      {posts.length ? (
        <ol className="grid gap-6 pb-16">
          {posts.map((post) => (
            <li key={post.slug} className="border-t border-subtle py-4">
              <p className="text-sm text-fg-secondary">{post.date}</p>
              <h2 className="text-xl font-semibold">
                <Link className={link} href={"/blog/" + post.slug}>
                  {post.title}
                </Link>
              </h2>
              <p className="text-fg-secondary">{post.summary}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pb-16 text-fg-secondary">{t("empty")}</p>
      )}
    </div>
  );
}
