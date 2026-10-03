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
    // Studio requests is linked from the inbox's filter line, not a lone
    // bordered button above everything (on a phone it sat by itself between
    // the top bar and the filters, reading as the page's main action).
    <PageLayout title="Feedback" maxWidth="max-w-5xl">
      <Suspense fallback={<CardSkeleton />}>
        <FeedbackInbox />
      </Suspense>
    </PageLayout>
  );
}
