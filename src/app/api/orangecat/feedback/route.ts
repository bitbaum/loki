/**
 * POST /api/orangecat/feedback — a person's OrangeCat bot files a finding
 * into a Loki project's feedback inbox, or reads where one is.
 *
 * Not a second inbox and not a second contract: the filing is
 * lib/feedback/agent-filing, the body of POST /api/projects/[id]/feedback
 * (docs/foundation/LOOP-WALK.md, "Agent walk"). This door only replaces the
 * seat's Bearer token with the signed OrangeCat rail: the filer is the Loki
 * account linked to the OrangeCat actor in the body, on a project that
 * account has a seat on, never anyone else's.
 *
 * Two reads on one door:
 *  - `project` + `suggestion` + `agentName` (+ `idempotencyKey`, `url`,
 *    `page`, `pageTitle`): file. Answers like the seat door: 201
 *    `{id, status, statusUrl, replayed}`, or 200 on a replayed key.
 *  - `feedbackId`: the report's canonical status, as that account may see it.
 *
 * Filing never builds unless the project's owner opted in, exactly as for a
 * seat. Words only: no screenshots cross this rail.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectAccess } from "@/db/queries/project-access";
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import { getUserByOrangeCatActorId } from "@/db/queries/users";
import {
  AgentFilingFields,
  fileAgentFeedback,
  readFeedbackStatus,
} from "@/lib/feedback/agent-filing";
import { isFreshIssuedAt } from "@/lib/integrations/orangecat-actor-status";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { mergeVisibleProjects } from "@/lib/visible-projects";

export const dynamic = "force-dynamic";

const Base = { actorId: z.string().uuid(), issuedAt: z.string().datetime() };

const Body = z.union([
  z.object({ ...Base, feedbackId: z.string().uuid() }).strict(),
  z
    .object({
      ...Base,
      /** The Loki project, by name, as the person says it. */
      project: z.string().trim().min(1).max(120),
      ...AgentFilingFields,
    })
    .strict(),
]);

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "feedback not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const data = dataOrResp;

  // Signed, but with no nonce: without this a captured request replays forever.
  if (!isFreshIssuedAt(data.issuedAt)) {
    return NextResponse.json({ error: "stale request" }, { status: 401 });
  }

  try {
    const user = await getUserByOrangeCatActorId(data.actorId);
    if (!user) {
      return NextResponse.json(
        {
          error: "no linked Loki account",
          detail:
            "This OrangeCat identity is not linked to a Loki account yet. Sign in to Loki with the same OrangeCat identity once, then try again.",
        },
        { status: 409 },
      );
    }

    if ("feedbackId" in data) {
      const status = await readFeedbackStatus(user.id, data.feedbackId);
      if (!status) {
        return NextResponse.json(
          { error: "feedback not found", detail: "No report with that id is yours to read." },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { ok: true, ...status },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const [own, org] = await Promise.all([
      getUserProjects(user.id).catch(() => []),
      getOrgProjects(user.id).catch(() => []),
    ]);
    const projects = mergeVisibleProjects(own, org);
    const project = projects.find((p) => p.name.toLowerCase() === data.project.toLowerCase());
    const access = project?.entityProjectId
      ? await getProjectAccess(user.id, project.entityProjectId)
      : null;
    if (!project?.entityProjectId || !access) {
      const available = projects
        .filter((p) => p.entityProjectId)
        .map((p) => p.name)
        .sort((a, b) => a.localeCompare(b));
      return NextResponse.json(
        {
          error: "project not found",
          detail: `No project named "${data.project}" to file into. Nothing was filed. Projects you can file into: ${available.join(", ") || "none yet"}.`,
          available,
        },
        { status: 404 },
      );
    }

    const { suggestion, agentName, idempotencyKey, page, url, pageTitle } = data;
    const filed = await fileAgentFeedback(user.id, project.entityProjectId, access, {
      suggestion,
      agentName,
      idempotencyKey,
      page,
      url,
      pageTitle,
    });
    if (!filed.ok) {
      return NextResponse.json(
        { error: filed.error, detail: filed.error },
        { status: filed.status },
      );
    }
    return NextResponse.json(
      { ok: true, project: project.name, ...filed.body },
      { status: filed.status },
    );
  } catch (err) {
    console.error("[orangecat/feedback] failed:", (err as Error).message);
    return NextResponse.json({ error: "feedback failed" }, { status: 500 });
  }
}
