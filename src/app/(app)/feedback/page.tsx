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
 * the ironing-out loop lives here. The inbox draws its own page header: its
 * one action ("Do all") needs the list's state.
 */
export default async function FeedbackPage() {
  await requirePageUserId();
  return (
    <Suspense
      fallback={
        <PageLayout title="Feedback" maxWidth="max-w-2xl">
          <CardSkeleton />
        </PageLayout>
      }
    >
      <FeedbackInbox />
    </Suspense>
  );
}
