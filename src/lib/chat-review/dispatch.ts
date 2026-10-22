import type { ChatTranscript } from "@bitbaum/chatkit";
import type { ChatReviewProduct } from "@/config/chat-review";
import { findProjectByRepo } from "@/db/queries/user-projects";
import { getActiveWidgetToken } from "@/db/queries/widget-tokens";
import { injectPrompt } from "@/lib/inject-core";
import { composeChatReviewPrompt } from "./prompt";

export type DispatchResult =
  { ok: true; runId: string | null; project: string } | { ok: false; skipped: string };

/**
 * Hand a product's day of conversations to an agent run on the Loki project
 * whose repository is the product's, as that project's owner — the same path
 * the autopilot night takes to read a live page (autopilot-night.ts →
 * injectPrompt). The agent judges and files; this server never calls a
 * model for it. Nothing to review, no project, no widget token: a skip with
 * its reason, never a throw, so one product cannot end the night.
 */
export async function dispatchReview(
  product: ChatReviewProduct,
  scope: string,
  transcripts: ChatTranscript[],
): Promise<DispatchResult> {
  const withAnswers = transcripts.filter((t) => t.turns.some((x) => x.role === "assistant"));
  if (withAnswers.length === 0) return { ok: false, skipped: "no conversations with an answer" };
  const project = await findProjectByRepo(product.repo);
  if (!project) return { ok: false, skipped: `no Loki project links ${product.repo}` };
  const token = await getActiveWidgetToken(project.userId, project.id);
  if (!token) return { ok: false, skipped: `project ${project.name} has no active widget token` };
  try {
    const { status, body } = await injectPrompt(
      {
        tab: project.name,
        projectId: project.id,
        customPrompt: composeChatReviewPrompt({
          product,
          scope,
          transcripts: withAnswers,
          project: { id: project.id, name: project.name },
          widgetToken: token.token,
        }),
      },
      project.userId,
    );
    if (status >= 400) {
      const error = typeof body.error === "string" ? body.error : `inject ${status}`;
      return { ok: false, skipped: `dispatch refused: ${error}` };
    }
    return {
      ok: true,
      runId: typeof body.runId === "string" ? body.runId : null,
      project: project.name,
    };
  } catch (e) {
    return { ok: false, skipped: `dispatch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
