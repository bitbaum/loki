import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { fetchAttributesByEntityIds } from "@/db/queries/utils";
import { getSessionUserId } from "@/lib/session";
import { jsonOk, readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { applyProjectProfile } from "@/lib/project-brief";
import { PROJECT_ATTR } from "@/config/project-attrs";
import {
  INTERVIEW_ANSWER_MAX,
  clampedAnswerFields,
  mergeInterviewIntoDescription,
  needsInterview,
  planInterview,
  usableAnswers,
  type InterviewAnswers,
} from "@/lib/project-interview";
import { interviewContextText, tailorInterviewQuestions } from "@/lib/project-interview-ai";

/**
 * The interview — Loki asking the owner what the OrangeCat page never said.
 *
 * GET plans the questions (and lets a model reword them for this project).
 * POST stores the answers in the owner's exact words: each one as the profile
 * attribute it answers, and all of them appended to the project's description,
 * which is the text every downstream step actually reads.
 *
 * There is no model between the owner's words and what gets stored. Extraction
 * happens later, in the kickoff's profile step, from a brief that now says
 * something — which is the whole point of asking.
 */

/** Project row + attributes, or null when it is not this user's project. */
async function readProject(userId: string, id: string) {
  const [project] = await db
    .select({ id: entities.id, name: entities.name, description: entities.description })
    .from(entities)
    .where(and(eq(entities.id, id), eq(entities.userId, userId)));
  if (!project) return null;
  const attrs = (await fetchAttributesByEntityIds([id])).get(id) ?? {};
  return { project, attrs };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const found = await readProject(userId, idOrResp);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { project, attrs } = found;

  const planned = planInterview({ attrs });
  // Tailoring is best-effort by construction (see project-interview-ai); a
  // model outage costs plainer wording, never the interview.
  const questions = await tailorInterviewQuestions(
    {
      projectName: project.name,
      publicText: interviewContextText({
        description: project.description,
        originUrl: attrs[PROJECT_ATTR.URL] ?? null,
      }),
    },
    planned,
  );

  return jsonOk({
    questions: questions.map((field) => ({
      id: field.id,
      question: field.question,
      hint: field.hint,
      essential: field.essential,
    })),
    needed: needsInterview({ attrs }),
  });
}

const AnswersBody = z.object({
  answers: z.record(z.string(), z.string().max(INTERVIEW_ANSWER_MAX * 4)),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, AnswersBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const found = await readProject(userId, idOrResp);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { project, attrs } = found;

  // usableAnswers drops keys we never asked about as well as non-answers, so a
  // hand-rolled POST cannot write an arbitrary attribute through this route.
  const usable = usableAnswers(dataOrResp.answers as InterviewAnswers);
  if (Object.keys(usable).length === 0) {
    // Everything was skipped. That is a legitimate choice — the caller moves on
    // to the kickoff — so it is not an error, and nothing is written.
    return jsonOk({ applied: {}, skipped: true });
  }

  const description = mergeInterviewIntoDescription(project.description, usable);
  // Not onlyMissing: these answers came from the person who owns the project,
  // and they were asked precisely because the existing values were blank or
  // placeholder. Their words win over anything a model previously guessed.
  const applied = await applyProjectProfile(userId, idOrResp, { ...usable, description });
  if (applied === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Remaining is measured against the profile as it now stands, not as it was.
  return jsonOk({
    applied,
    skipped: false,
    remaining: planInterview({ attrs: { ...attrs, ...usable } }).length,
    // Stored, but not whole: these answers were cut to INTERVIEW_ANSWER_MAX.
    // Empty in the normal case — the textarea's maxLength means only a direct
    // API caller can send more — and never silent when it is not.
    clamped: clampedAnswerFields(dataOrResp.answers as InterviewAnswers),
  });
}
