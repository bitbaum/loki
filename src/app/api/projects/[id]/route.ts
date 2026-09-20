import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSessionUserId } from "@/lib/session";
import { readIdParam, readJsonBody, isUniqueViolation } from "@/lib/api/route-helpers";
import { readCronJobs } from "@/lib/crons";
import {
  patchProject,
  deleteProject,
  getProjectCore,
  PatchProjectBody,
  resolveProjectDetailWithOrgFallback,
} from "@/db/queries/projects";
import {
  scheduleDeletedProjectProfileRemoval,
  scheduleProjectProfileReindexByEntityId,
  scheduleRenamedProjectProfileReindex,
} from "@/lib/rag/reindex-project-profile";
import { getProjectActivity } from "@/db/queries/activity";
import { getProjectStateByProjectId } from "@/db/queries/project-states";
import { getUserProjectByEntityId, setProjectFeatured } from "@/db/queries/user-projects";
import { isSiteOperator } from "@/db/queries/users";
import { getRepoWriteToken } from "@/lib/github-org-token";
import { deprovisionGithubRepo } from "@/lib/github-provision";

function getLinkedJobs(projectId: string, projectName: string) {
  const nameLower = projectName.toLowerCase();
  return readCronJobs()
    .filter((job) => {
      const byId = job.projectId === projectId;
      const jobNameLower = (job.name ?? "").toLowerCase();
      const msgLower = (job.payload?.message ?? "").toLowerCase();
      // Fallback: fuzzy name match when no projectId set on the job
      const byFuzzy =
        !job.projectId && (jobNameLower.includes(nameLower) || msgLower.includes(nameLower));
      return byId || byFuzzy;
    })
    .map((job) => ({
      id: job.id,
      name: job.name,
      message: job.payload?.message ?? "",
      enabled: job.enabled,
      schedule: job.schedule?.expr ?? "",
      lastStatus: job.state?.lastStatus,
      consecutiveErrors: job.state?.consecutiveErrors ?? 0,
      projectId: job.projectId,
    }));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const dataOrResp = await readJsonBody(req, PatchProjectBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  // `featured` is the site operator's editorial pick for the landing hero, so
  // it is handled here rather than in patchProject and is NOT scoped to the
  // caller's own projects: curating the homepage means featuring other
  // tenants' work. That is precisely why it needs its own authorization — a
  // tenant PATCHing their own project must not be able to promote it.
  const { featured, ...ownFields } = dataOrResp;
  if (featured !== undefined) {
    if (!(await isSiteOperator(userId))) {
      return NextResponse.json(
        { error: "Only the site operator can feature a project" },
        { status: 403 },
      );
    }
    const ok = await setProjectFeatured(idOrResp, featured);
    if (!ok) {
      // Either no such project, or it has not consented to be listed. Featuring
      // cannot override consent — see db/queries/public-visibility.ts.
      return NextResponse.json(
        { error: "Not found, or the owner has not listed this project publicly" },
        { status: 404 },
      );
    }
    if (Object.keys(ownFields).length === 0) return NextResponse.json({ ok: true });
  }

  try {
    const before = ownFields.name !== undefined ? await getProjectCore(userId, idOrResp) : null;
    const updated = await patchProject(userId, idOrResp, ownFields);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (ownFields.name !== undefined && before?.name) {
      scheduleRenamedProjectProfileReindex(userId, idOrResp, before.name);
    } else if (ownFields.description !== undefined) {
      scheduleProjectProfileReindexByEntityId(userId, idOrResp);
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      return NextResponse.json(
        { error: "A project with that name already exists" },
        { status: 409 },
      );
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;

  const resolved = await resolveProjectDetailWithOrgFallback(userId, idOrResp);
  if (!resolved || resolved.ownerId !== userId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userProject = await getUserProjectByEntityId(userId, idOrResp).catch(() => null);
  const deprovision = req.nextUrl.searchParams.get("deprovision");
  const deleteLocal = req.nextUrl.searchParams.get("deleteLocal") === "1";

  if (deprovision === "archive-repo" || deprovision === "delete-repo") {
    const gitUrl = resolved.detail.project.gitUrl ?? userProject?.gitUrl ?? null;
    if (!gitUrl)
      return NextResponse.json(
        { error: "No GitHub repo is linked to this project." },
        { status: 400 },
      );
    const token = (await getRepoWriteToken(userId))?.token ?? null;
    if (!token)
      return NextResponse.json(
        { error: "No GitHub account linked. Sign in with GitHub first." },
        { status: 400 },
      );
    const gh = await deprovisionGithubRepo(
      token,
      gitUrl,
      deprovision === "delete-repo" ? "delete" : "archive",
    );
    if (!gh.ok)
      return NextResponse.json({ error: gh.error, detail: gh.detail }, { status: gh.status });
  }

  if (deleteLocal && userProject?.dirPath) {
    const local = safeLocalProjectPath(userProject.dirPath);
    if (!local.ok) return NextResponse.json({ error: local.error }, { status: 400 });
    await fs.rm(local.path, { recursive: true, force: true });
  }

  const deleted = await deleteProject(userId, idOrResp);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  scheduleDeletedProjectProfileRemoval(userId, resolved.detail.project.name);
  return NextResponse.json({ ok: true });
}

function safeLocalProjectPath(
  dirPath: string,
): { ok: true; path: string } | { ok: false; error: string } {
  const devRoot = path.resolve(process.env.LOKI_BOX_DEV_ROOT || path.join(os.homedir(), "dev"));
  const target = path.resolve(dirPath);
  if (target === devRoot || !target.startsWith(devRoot + path.sep)) {
    return { ok: false, error: "Refusing to delete a folder outside the configured dev root." };
  }
  return { ok: true, path: target };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const id = idOrResp;

  const resolved = await resolveProjectDetailWithOrgFallback(userId, id);
  if (!resolved) return NextResponse.json(null, { status: 404 });
  const { detail, ownerId } = resolved;
  const {
    project,
    createdAt,
    attrs,
    relations,
    recentInteractions,
    linkedGoals,
    devLog,
    resources,
    notes,
  } = detail;
  const readonly = ownerId !== userId;

  // Runtime state + activity both belong to the project owner — fetch under their
  // userId so org peers viewing a shared project see the same rows the owner's
  // runner writes. Activity is the unified read-model SSOT (prompts + run
  // outcomes + lifecycle, deduped) keyed by project name — the same source the
  // /control Activity panel uses, instead of a parallel bespoke assembly.
  const [runtimeState, activity, userProjectForDetail] = await Promise.all([
    getProjectStateByProjectId(ownerId, id).catch(() => null),
    getProjectActivity(ownerId, project.name, { days: 90, limit: 50 }).catch((e) => {
      console.error("[projects/[id]] activity query failed:", e);
      return [];
    }),
    getUserProjectByEntityId(ownerId, id).catch(() => null),
  ]);

  const linkedJobs = getLinkedJobs(project.id, project.name);

  return NextResponse.json({
    id: project.id,
    name: project.name,
    type: project.type,
    description: project.description,
    gitUrl: project.gitUrl ?? null,
    dirPath: userProjectForDetail?.dirPath ?? null,
    source: project.source,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : (createdAt ?? null),
    readonly: readonly || undefined,
    attrs,
    relations,
    interactions: recentInteractions,
    linkedJobs,
    linkedGoals,
    resources,
    notes,
    devLog: [...(devLog ?? [])].reverse().slice(0, 20),
    activity,
    runtimeState: runtimeState
      ? {
          tabName: runtimeState.tabName,
          readyAt: runtimeState.readyAt?.toISOString() ?? null,
          closingAt: runtimeState.closingAt?.toISOString() ?? null,
          closedAt: runtimeState.closedAt?.toISOString() ?? null,
          currentPromptLabel: runtimeState.currentPromptLabel,
          currentPromptStartedAt: runtimeState.currentPromptStartedAt?.toISOString() ?? null,
          sessionUpdatedAt: runtimeState.sessionUpdatedAt?.toISOString() ?? null,
        }
      : null,
  });
}
