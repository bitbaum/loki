import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { extractProjectProfile, applyProjectProfile } from "@/lib/project-brief";
import { getProjectCore } from "@/db/queries/projects";
import { pastedText } from "@/lib/api/pasted-text";

// Free-form project brief → structured profile. The user writes (or dictates)
// what the project should be in plain language; the model fills description +
// mission/vision/customers/stack/status/next_step. No forms.

const BriefBody = z.object({
  text: pastedText("Tell us a bit more — at least a sentence."),
  // Defaults to false so kickoff can fill attrs from the brief. Description is
  // always the operator's exact text (see below) — onlyMissing still protects
  // attrs the health worklist must not overwrite.
  onlyMissing: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, BriefBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Save the brief BEFORE asking the model. The kickoff agent is briefed from
  // the description, so a model outage used to cost the operator their text
  // AND the agent: the extraction threw, nothing was written, and the dispatch
  // two steps later refused with "Describe the project first". The text the
  // person wrote is the one thing on this request that cannot fail to be true.
  const saved = await applyProjectProfile(
    userId,
    idOrResp,
    { description: dataOrResp.text },
    { onlyMissing: dataOrResp.onlyMissing },
  );
  if (saved === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let profile;
  try {
    profile = await extractProjectProfile(project.name, dataOrResp.text);
  } catch (e) {
    console.error("[brief] profile extraction failed:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error:
          "Your brief is saved, but the AI could not fill the profile fields right now. The agent can still start from the brief.",
        briefSaved: true,
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  // The operator's edited text IS the brief, and it is already saved above.
  // Attrs may be model-filled; the model's 1–2 sentence paraphrase of the
  // description is dropped so it can never overwrite that exact wording.
  const attrsOnly: typeof profile = { ...profile, description: undefined };

  const applied = await applyProjectProfile(userId, idOrResp, attrsOnly, {
    onlyMissing: dataOrResp.onlyMissing,
  });
  if (applied === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The up-front save already counted the description under onlyMissing (the
  // second apply sees it occupied), so report both writes as one.
  const all = { ...saved, ...applied };
  if (Object.keys(all).length === 0) {
    return NextResponse.json(
      {
        error: dataOrResp.onlyMissing
          ? "Nothing to fill — every field the brief could answer is already written."
          : "The text didn't contain anything to fill the profile with.",
      },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, applied: all });
}
