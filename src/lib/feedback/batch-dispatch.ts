import { markFeedbackDispatchedBulk } from "@/db/queries/site-feedback";
import { injectPrompt } from "@/lib/inject-core";
import { feedbackInjectAccepted } from "@/lib/feedback/dispatch-accept";
import {
  composeFeedbackBatchFixPrompt,
  type FeedbackPromptFields,
} from "@/lib/feedback/compose-dispatch";

/**
 * Several feedback items as ONE build: one prompt, one agent pass, every item
 * marked with the run that took it. Shared by the inbox's "Implement all as
 * one" and the widget's "Build all" (one build per page of saved notes).
 */
export async function dispatchFeedbackBatch(
  userId: string,
  project: { id: string; name: string },
  items: Array<FeedbackPromptFields & { id: string }>,
  note?: string,
) {
  const { status, body } = await injectPrompt(
    {
      tab: project.name,
      projectId: project.id,
      allowHostedFallback: true,
      refuseOfflineQueue: true,
      // Honor user_projects.builder_pref via pickDispatchChannel — do not force cloud.
      customPrompt: composeFeedbackBatchFixPrompt(items, project.name, note),
      notifyOnClose: true,
    },
    userId,
  );
  const accepted = feedbackInjectAccepted(status, body);
  if (accepted)
    await markFeedbackDispatchedBulk(
      userId,
      items.map((f) => f.id),
      body.runId,
    );
  return { status, body, accepted };
}
