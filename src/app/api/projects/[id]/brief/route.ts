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

  let profile;
  try {
    profile = await extractProjectProfile(project.name, dataOrResp.text);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not extract a profile from that text. Try again in a moment.",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  // The operator's edited text IS the brief. Attrs may be model-filled; never
  // overwrite that exact wording with a regenerated 1–2 sentence paraphrase.
  profile = { ...profile, description: dataOrResp.text };

  const applied = await applyProjectProfile(userId, idOrResp, profile, {
    onlyMissing: dataOrResp.onlyMissing,
  });
  if (applied === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Object.keys(applied).length === 0) {
    return NextResponse.json(
      {
        error: dataOrResp.onlyMissing
          ? "Nothing to fill — every field the brief could answer is already written."
          : "The text didn't contain anything to fill the profile with.",
      },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, applied });
}
