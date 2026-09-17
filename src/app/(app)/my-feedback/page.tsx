import { requirePageUserId } from "@/lib/session";
import { listReporterFeedback } from "@/db/queries/site-feedback";
import { PageLayout } from "@/components/ui/page-layout";

export const metadata = { title: "My feedback" };

const STATUS_LABEL: Record<string, string> = {
  new: "Received",
  dispatched: "Being implemented",
  resolved: "Implemented",
  archived: "Closed",
};

export default async function MyFeedbackPage() {
  const userId = await requirePageUserId();
  const feedback = await listReporterFeedback(userId);
  return (
    <PageLayout title="My feedback" maxWidth="max-w-4xl">
      <p className="mb-4 text-sm text-text-secondary">
        Reports you submitted and claimed. Tracking a report never grants permission to edit its
        project.
      </p>
      {feedback.length === 0 ? (
        <div className="ui-empty-page">No claimed feedback yet.</div>
      ) : (
        <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface-raised px-4">
          {feedback.map((item) => (
            <article key={item.id} className="space-y-1 py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
                <span className="ui-badge">{STATUS_LABEL[item.status] ?? item.status}</span>
                <span>{item.projectName}</span>
                <time
                  dateTime={item.createdAt.toISOString()}
                  title={item.createdAt.toLocaleString()}
                >
                  Submitted {item.createdAt.toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-text-primary">{item.suggestion}</p>
            </article>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
