import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody } from "@/lib/api/route-helpers";
import { extractRoadmap } from "@/lib/project-brief";
import { getProjectCore } from "@/db/queries/projects";
import { createGoal } from "@/db/queries/goals";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";
import { pastedText } from "@/lib/api/pasted-text";

// Spec → build roadmap. The user pastes a product/engineering spec; the model
// decomposes it into an ordered set of milestones, which we create as project
// goals (each with acceptance criteria in its description). This is the
// "decompose the doc into milestones" half of spec ingestion — the brief route
// fills the flat profile fields, this creates the roadmap.

const RoadmapBody = z.object({
  text: pastedText("Paste the spec — at least a sentence."),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, RoadmapBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let roadmap;
  try {
    roadmap = await extractRoadmap(project.name, dataOrResp.text);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not extract a roadmap from that text. Try again in a moment.",
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  if (roadmap.milestones.length === 0) {
    return NextResponse.json(
      { error: "The text didn't contain a roadmap to decompose." },
      { status: 422 },
    );
  }

  // Create each milestone as a project goal linked to this entity. One failure
  // shouldn't lose the rest, so collect successes and report the count.
  const created: string[] = [];
  for (const m of roadmap.milestones) {
    try {
      await createGoal(userId, { title: m.title, description: m.description, entityId: idOrResp });
      created.push(m.title);
    } catch (e) {
      console.error("[roadmap] createGoal failed for", m.title, e);
    }
  }

  if (created.length === 0)
    return NextResponse.json(
      { error: "Could not create goals for this project." },
      { status: 500 },
    );
  scheduleProjectProfileReindexByEntityId(userId, idOrResp);
  return NextResponse.json({ ok: true, created });
}
