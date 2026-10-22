import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { ThoughtsLibrary } from "@/components/thoughts/ThoughtsLibrary";
import { Rss } from "lucide-react";
import { NewsletterSignup } from "@/components/thoughts/NewsletterSignup";
import { listThoughtTags, listThoughts } from "@/lib/thoughts-content";

export const metadata = {
  title: "Thoughts",
  description: "Essays on architecture, execution systems, and project momentum",
  alternates: {
    types: { "application/rss+xml": "/rss.xml" },
  },
};

export default function ThoughtsPage() {
  const articles = listThoughts();
  const tags = listThoughtTags();

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid pb-14 pt-10 sm:pb-20 sm:pt-16">
        <div className="flex items-start justify-between gap-4">
          <h1 className="ui-public-page-title">Thoughts</h1>
          <a href="/rss.xml" className="ui-public-icon-link" aria-label="RSS feed" title="RSS feed">
            <Rss className="h-5 w-5" aria-hidden />
          </a>
        </div>

        <div className="mt-8">
          <ThoughtsLibrary articles={articles} tags={tags} />
        </div>

        <div className="mt-14">
          <NewsletterSignup source="thoughts-index" />
        </div>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}
