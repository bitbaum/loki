import Link from "next/link";
import { Suspense } from "react";
import { PageLayout } from "@/components/ui/page-layout";
import { CardSkeleton } from "@/components/ui/card";
import { requirePageUserId } from "@/lib/session";
import { FeedbackInbox } from "@/components/feedback/FeedbackInbox";

export const metadata = { title: "Feedback" };

/**
 * The feedback product's own front door (SoC): visitor reports, AI-review
 * findings, and synthesized briefs across every project, each with the live
 * phase of its fix. Control stays operations; Projects stays the catalog;
 * the ironing-out loop lives here.
 */
export default async function FeedbackPage() {
  await requirePageUserId();
  return (
    <PageLayout
      title="Feedback"
      maxWidth="max-w-5xl"
      right={
        <Link href="/feedback/studio" className="ui-btn-secondary">
          Studio requests
        </Link>
      }
    >
      <Suspense fallback={<CardSkeleton />}>
        <FeedbackInbox />
      </Suspense>
    </PageLayout>
  );
}
