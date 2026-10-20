import { BUILD_REQUESTS } from "@/config/build-requests";
import {
  claimBuildRequest,
  recordBuildRequestPreview,
  reopenBuildRequest,
} from "@/db/queries/build-requests";
import { getProjectPreviewCode } from "@/db/queries/preview-code";
import { upsertProjectMember } from "@/db/queries/project-access";
import { getUserById } from "@/db/queries/users";
import { getUserProjectByEntityId } from "@/db/queries/user-projects";
import type { BuildRequest } from "@/db/schema/build-requests";
import { appUrl, buildRequestTemplate, sendEmailFire } from "@/lib/email";
import { newAccessCode, startWebsitePreview } from "@/lib/previews/from-website";
import { WebsiteBuildBody } from "@/lib/website-brief";

export type BuildDecision = { decision: "approve" } | { decision: "decline"; note: string | null };

export type DecideResult =
  { ok: true; row: BuildRequest } | { ok: false; status: number; error: string };

const PROJECT_PATH = /^\/projects\/([\da-f-]{36})\/watch$/;

/**
 * The operator's answer to a new account's build request.
 *
 * Approve builds it as the OPERATOR's client work — the cloud builder only
 * runs the operator's commands, and that is the boundary, not a formality —
 * behind a code of its own, so the visitor is never handed the code that
 * opens every other preview. If the build cannot start, the request goes back
 * to waiting with the reason, so nothing is lost and nobody is told a lie.
 */
export async function decideBuildRequest(
  operatorId: string,
  id: string,
  decision: BuildDecision,
): Promise<DecideResult> {
  if (decision.decision === "decline") {
    const row = await claimBuildRequest(id, "declined", decision.note?.trim() || null);
    if (!row) return { ok: false, status: 409, error: "That request was already decided." };
    void tell(row);
    return { ok: true, row };
  }

  const row = await claimBuildRequest(id, "building", null);
  if (!row) return { ok: false, status: 409, error: "That request was already decided." };
  // The build's own request id is this request's: the visitor's id names
  // their brief, and the operator's projects must never collide with it.
  const brief = WebsiteBuildBody.safeParse({ ...row.brief, requestId: row.id, code: undefined });
  if (!brief.success) {
    await reopenBuildRequest(id);
    return {
      ok: false,
      status: 422,
      error: "The brief in this request no longer reads; ask them to send it again.",
    };
  }
  const ownCode = newAccessCode();
  let started;
  try {
    started = await startWebsitePreview(operatorId, brief.data, { ownCode });
  } catch (e) {
    await reopenBuildRequest(id);
    throw e;
  }
  if (!started || !started.ok) {
    await reopenBuildRequest(id);
    return started
      ? { ok: false, status: started.status, error: started.error }
      : { ok: false, status: 503, error: "Previews are not set up on this server." };
  }
  const projectId = PROJECT_PATH.exec(started.projectPath)?.[1] ?? null;
  // A retried approval finds the preview it already made and is told nothing
  // new about it; read the address and code back from the project.
  const project = projectId ? await getUserProjectByEntityId(operatorId, projectId) : null;
  const preview = {
    projectId,
    previewUrl: started.previewUrl ?? project?.liveUrl ?? null,
    accessCode:
      started.accessCode ??
      (projectId
        ? await getProjectPreviewCode({ userId: operatorId, entityProjectId: projectId })
        : null),
  };
  await recordBuildRequestPreview(id, preview);
  // The person who asked gets a seat on the site made for them: their notes
  // are theirs, and each goes to the operator to build.
  if (projectId) await upsertProjectMember(projectId, row.userId, "client").catch(() => null);
  const done = { ...row, ...preview };
  void tell(done);
  return { ok: true, row: done };
}

/** Mail the visitor the decision, at their account's address. */
async function tell(row: BuildRequest): Promise<void> {
  const user = await getUserById(row.userId).catch(() => null);
  const to = user?.email?.trim();
  if (!to || row.status === "waiting") return;
  const mail = buildRequestTemplate({
    status: row.status,
    website: row.website,
    pageUrl: `${appUrl()}${BUILD_REQUESTS.pagePath(row.id)}`,
    previewUrl: row.previewUrl,
    accessCode: row.accessCode,
    note: row.note,
  });
  sendEmailFire(to, mail.subject, mail.html, mail.text);
}
