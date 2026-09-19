/**
 * Rephrase the interview's questions in terms of THIS project.
 *
 * "Who is this for, and who pays for it?" is a fine question and a generic one.
 * Asked about a CHF 100 service listing whose whole public description is one
 * line, "Your OrangeCat page offers this at CHF 100 — who is the buyer, and is
 * that per booking or per month?" gets a better answer, because it shows the
 * owner that Loki has read their page and tells them which part is still blank.
 *
 * The model may only REWORD. The set of questions, their order and the field
 * each one fills are decided by project-interview.ts and are not sent back for
 * the model to revise — so a bad completion costs a plainer question, never a
 * question about the wrong thing or a missing one. Every failure path returns
 * the bank unchanged, because an interview with generic wording is worth far
 * more than no interview.
 */

import { z } from "zod";
import { callGroqText } from "@/lib/groq";
import { parseModelJson } from "@/lib/ai/model-json";
import { type InterviewField } from "@/lib/project-interview";

/** Long enough to name the specific thing, short enough to read in one go. */
const QUESTION_MAX = 180;

const TailoredSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string().trim().min(8).max(QUESTION_MAX),
    }),
  ),
});

const SYSTEM_PROMPT = `You rewrite interview questions so they are about ONE specific project.

You get the project's name, what is publicly known about it, and a list of questions to rewrite. Each question has an "id" and generic wording. Return ONLY a JSON object — no prose, no markdown fences:
{"questions":[{"id":"<the same id>","question":"<rewritten>"}]}

Rules:
- Return exactly one entry per id you were given, with that id unchanged. Never add, drop, merge or reorder.
- Keep what the question ASKS FOR identical. You are changing the wording, not the subject.
- Ground it in a detail from the project text — its name, what it sells, its price, who runs it. That detail is why the rewrite is worth anything.
- If the text gives you nothing specific for a question, return its original wording unchanged rather than inventing a detail.
- NEVER state a fact the text does not contain, and never imply the answer. Asking "is that per booking or per month?" is good; asking "so it is per booking, correct?" is not.
- One sentence, max ${QUESTION_MAX} characters, addressed to the owner as "you". Plain language, no jargon, no preamble.
- Write in the same language as the project text (default English).`;

export type InterviewContext = {
  projectName: string;
  /** Everything publicly known: the OrangeCat description, the page URL, its type. */
  publicText: string;
};

/**
 * Tailored questions for the given fields, or those fields unchanged.
 *
 * Returns the SAME field objects (id, hint, essential) with only `question`
 * possibly replaced, so every caller keeps the planner's contract.
 */
export async function tailorInterviewQuestions(
  context: InterviewContext,
  fields: readonly InterviewField[],
): Promise<InterviewField[]> {
  const asked = [...fields];
  if (asked.length === 0) return asked;
  // Nothing to ground a rewrite in. A model handed a bare title invents the
  // detail that makes the question feel specific, which is worse than generic.
  if (context.publicText.trim().length < 20) return asked;

  try {
    const prompt = [
      `Project name: ${context.projectName}`,
      "",
      "What is publicly known about it:",
      context.publicText.slice(0, 4_000),
      "",
      "Questions to rewrite:",
      ...asked.map((field) => `- ${field.id}: ${field.question}`),
    ].join("\n");

    const raw = await callGroqText(prompt, {
      feature: "project-interview",
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 500,
      temperature: 0.3,
      timeoutMs: 20_000,
    });
    const parsed = TailoredSchema.safeParse(parseModelJson(raw));
    if (!parsed.success) return asked;

    const byId = new Map(parsed.data.questions.map((q) => [q.id, q.question]));
    return asked.map((field) => {
      const rewritten = byId.get(field.id);
      // An id we never asked about is ignored by construction — we map over the
      // planner's fields, not over the model's reply.
      return rewritten ? { ...field, question: rewritten } : field;
    });
  } catch {
    // Model down, rate-limited, budget exhausted, timed out. The interview is
    // the point; its wording is not. Ask the plain questions.
    return asked;
  }
}

/** The public text a tailoring call should read, assembled from what we hold. */
export function interviewContextText(input: {
  description: string | null | undefined;
  originUrl?: string | null;
  entityType?: string | null;
}): string {
  return [
    input.description?.trim() || "",
    input.originUrl ? `Public page: ${input.originUrl}` : "",
    input.entityType ? `Listed on OrangeCat as a ${input.entityType}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
