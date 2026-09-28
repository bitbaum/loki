import os from "os";
import path from "path";
import { z } from "zod";
import { upsertWidgetToken } from "@/db/queries/widget-tokens";
import { appUrl } from "@/lib/email";
import { planSiteCd } from "@/lib/site-cd";
import { getRepoWriteToken } from "@/lib/github-org-token";
import {
  parseGithubRepoUrl,
  provisionGithubRepo,
  repoHasStarterFiles,
  repoSlug,
  seedTemplate,
} from "@/lib/github-provision";
import { getProjectCore, patchProject } from "@/db/queries/projects";
import { getUserProjectByEntityId, updateUserProject } from "@/db/queries/user-projects";
import { fetchAttributesByEntityIds } from "@/db/queries/utils";
import { createGoal } from "@/db/queries/goals";
import { getProjectAccess } from "@/db/queries/project-access";
import { getProjectDossierByOwner } from "@/db/queries/project-dossier";
import { PROJECT_ATTR } from "@/config/project-attrs";
import {
  DEFAULT_PROVISION_TEMPLATE,
  PROVISION_TEMPLATE_IDS,
  inferProvisionTemplate,
} from "@/config/project-templates";
import { extractProjectProfile, applyProjectProfile, extractRoadmap } from "@/lib/project-brief";
import { scheduleProjectProfileReindexByEntityId } from "@/lib/rag/reindex-project-profile";
import { pastedText } from "@/lib/api/pasted-text";
import { getExecutionAccess } from "@/lib/execution-access";
import { registerProjectSiteCd } from "@/lib/site-cd-register";
import { injectPrompt } from "@/lib/inject-core";
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";
import { PROJECT_DISPATCH_KINDS } from "@/lib/project-dispatch";
import { composeDispatchPrompt } from "@/lib/project-dispatch-prompt";

/**
 * The project setup steps, callable without an HTTP request.
 *
 * Each of these was the body of its own route (brief, roadmap, provision,
 * register-cd, dispatch), which meant only a browser could run "Make it
 * happen": the page called them in order, and a phone that locked its screen
 * or switched apps mid-run suspended the tab and stopped the setup halfway.
 * Moving the bodies here lets the server run the same sequence on its own
 * (lib/kickoff/server-runs) while the routes stay the thin wrappers they
 * should be. Every function returns exactly the status + JSON its route used
 * to, so the routes and the server run cannot answer differently.
 */

export type StepResult = { status: number; body: Record<string, unknown> };

const json = (body: Record<string, unknown>, status = 200): StepResult => ({ status, body });

// ── brief: free-form text → saved description + model-filled profile ─────────

export const BriefBody = z.object({
  text: pastedText("Tell us a bit more — at least a sentence."),
  // Defaults to false so kickoff can fill attrs from the brief. Description is
  // always the operator's exact text (see below) — onlyMissing still protects
  // attrs the health worklist must not overwrite.
  onlyMissing: z.boolean().optional(),
});

export async function briefStep(
  userId: string,
  id: string,
  input: z.infer<typeof BriefBody>,
): Promise<StepResult> {
  const project = await getProjectCore(userId, id);
  if (!project) return json({ error: "Not found" }, 404);

  // Save the brief BEFORE asking the model. The kickoff agent is briefed from
  // the description, so a model outage used to cost the operator their text
  // AND the agent: the extraction threw, nothing was written, and the dispatch
  // two steps later refused with "Describe the project first". The text the
  // person wrote is the one thing on this request that cannot fail to be true.
  const saved = await applyProjectProfile(
    userId,
    id,
    { description: input.text },
    { onlyMissing: input.onlyMissing },
  );
  if (saved === null) return json({ error: "Not found" }, 404);

  let profile;
  try {
    profile = await extractProjectProfile(project.name, input.text);
  } catch (e) {
    console.error("[brief] profile extraction failed:", e instanceof Error ? e.message : e);
    return json(
      {
        error:
          "Your brief is saved, but the AI could not fill the profile fields right now. The agent can still start from the brief.",
        briefSaved: true,
        details: e instanceof Error ? e.message : String(e),
      },
      502,
    );
  }

  // The operator's edited text IS the brief, and it is already saved above.
  // Attrs may be model-filled; the model's 1–2 sentence paraphrase of the
  // description is dropped so it can never overwrite that exact wording.
  const attrsOnly: typeof profile = { ...profile, description: undefined };

  const applied = await applyProjectProfile(userId, id, attrsOnly, {
    onlyMissing: input.onlyMissing,
  });
  if (applied === null) return json({ error: "Not found" }, 404);
  // The up-front save already counted the description under onlyMissing (the
  // second apply sees it occupied), so report both writes as one.
  const all = { ...saved, ...applied };
  if (Object.keys(all).length === 0) {
    return json(
      {
        error: input.onlyMissing
          ? "Nothing to fill — every field the brief could answer is already written."
          : "The text didn't contain anything to fill the profile with.",
      },
      422,
    );
  }
  return json({ ok: true, applied: all });
}

// ── roadmap: spec → milestones created as project goals ──────────────────────

export const RoadmapBody = z.object({
  text: pastedText("Paste the spec — at least a sentence."),
});

export async function roadmapStep(
  userId: string,
  id: string,
  input: z.infer<typeof RoadmapBody>,
): Promise<StepResult> {
  const project = await getProjectCore(userId, id);
  if (!project) return json({ error: "Not found" }, 404);

  let roadmap;
  try {
    roadmap = await extractRoadmap(project.name, input.text);
  } catch (e) {
    return json(
      {
        error: "Could not extract a roadmap from that text. Try again in a moment.",
        details: e instanceof Error ? e.message : String(e),
      },
      502,
    );
  }

  if (roadmap.milestones.length === 0) {
    return json({ error: "The text didn't contain a roadmap to decompose." }, 422);
  }

  // Create each milestone as a project goal linked to this entity. One failure
  // shouldn't lose the rest, so collect successes and report the count.
  const created: string[] = [];
  for (const m of roadmap.milestones) {
    try {
      await createGoal(userId, { title: m.title, description: m.description, entityId: id });
      created.push(m.title);
    } catch (e) {
      console.error("[roadmap] createGoal failed for", m.title, e);
    }
  }

  if (created.length === 0) return json({ error: "Could not create goals for this project." }, 500);
  scheduleProjectProfileReindexByEntityId(userId, id);
  return json({ ok: true, created });
}

// ── provision: create + seed the GitHub repo, link it for the box-runner ──────

// Must match box-workspace.ts DEV_ROOT so dirPath == where the runner clones.
const DEV_ROOT = process.env.LOKI_BOX_DEV_ROOT || path.join(os.homedir(), "dev");

export const ProvisionBody = z.object({
  visibility: z.enum(["private", "public"]).default("private"),
  // "auto" resolves from the project's own stack attribute — the kickoff flow
  // has no template picker on purpose, and the profile already says what this
  // is built with. The explicit ids stay for the manual picker.
  template: z.enum([...PROVISION_TEMPLATE_IDS, "auto"]).default(DEFAULT_PROVISION_TEMPLATE),
});

export async function provisionStep(
  userId: string,
  id: string,
  input: z.infer<typeof ProvisionBody>,
): Promise<StepResult> {
  const project = await getProjectCore(userId, id);
  if (!project) return json({ error: "Not found" }, 404);

  const write = await getRepoWriteToken(userId);
  if (!write) {
    return json(
      { error: "No GitHub account linked. Sign in with GitHub first.", hasGithub: false },
      400,
    );
  }
  const token = write.token;

  let template = input.template;
  if (template === "auto") {
    const attrs = (await fetchAttributesByEntityIds([id]).catch(() => new Map())).get(id) ?? {};
    template = inferProvisionTemplate(attrs[PROJECT_ATTR.STACK]);
  }

  // An already-linked repo is refused unless it is bare: seeding is non-fatal
  // inside provision, so a retry can meet a repo that exists with nothing in
  // it. That repo has nothing to deploy and nothing for an agent to build on;
  // re-seed it rather than refusing as "already linked".
  const linked = project.gitUrl ? parseGithubRepoUrl(project.gitUrl) : null;
  const reseed =
    linked && template !== "bare"
      ? !(await repoHasStarterFiles(token, linked.owner, linked.repo, template))
      : false;
  if (project.gitUrl && !reseed) {
    return json({ error: "Already provisioned — this project already has a repo linked." }, 409);
  }

  // The starter carries its own project-scoped feedback embed from first ship.
  // Restrict ingest to the planned site origin without claiming it is live yet.
  const cdPlan = planSiteCd({
    projectName: project.name,
    repoFullName: `pending/${repoSlug(project.name)}`,
    template,
  });
  const widget =
    template === "nextjs-tailwind" && cdPlan.ok
      ? await upsertWidgetToken(userId, id, { origins: [cdPlan.liveUrl] })
      : null;
  const feedback = widget ? { token: widget.token, appUrl: appUrl() } : undefined;
  const dirPath = path.join(DEV_ROOT, repoSlug(project.name));

  if (linked && reseed) {
    const seeded = await seedTemplate(
      token,
      linked.owner,
      linked.repo,
      template,
      { name: project.name, description: `Started from Loki · ${project.name}` },
      feedback,
    );
    return json(
      {
        ok: seeded,
        error: seeded
          ? undefined
          : "Starter files could not be written to the repository. Try again.",
        repo: {
          name: linked.repo,
          full_name: `${linked.owner}/${linked.repo}`,
          gitUrl: project.gitUrl,
        },
        dirPath,
        template,
        templateSeeded: seeded,
        reseeded: true,
      },
      seeded ? 200 : 502,
    );
  }

  const result = await provisionGithubRepo(token, {
    name: project.name,
    visibility: input.visibility,
    template,
    feedback,
  });
  if (!result.ok) {
    return json({ error: result.error, detail: result.detail }, result.status === 422 ? 409 : 502);
  }

  // Link the repo + set dirPath (the box-runner's clone target) on the
  // user_projects row in ONE update, so a mid-flight crash can never leave a
  // repo linked without a dirPath (= visible but undispatchable in Control).
  // The entity patch comes last: it only mirrors gitUrl for the dossier and
  // the "already provisioned" 409 guard, so a crash before it just means the
  // guard doesn't trip — the project itself is already fully dispatchable.
  const up = await getUserProjectByEntityId(userId, id);
  if (up) await updateUserProject(up.id, userId, { gitUrl: result.repo.html_url, dirPath });
  await patchProject(userId, id, { gitUrl: result.repo.html_url });

  return json({
    ok: true,
    repo: {
      name: result.repo.name,
      full_name: result.repo.full_name,
      gitUrl: result.repo.html_url,
      private: result.repo.private,
    },
    dirPath,
    template,
    templateSeeded: result.templateSeeded,
  });
}

// ── register-cd: wire Hetzner CD for a project that has a GitHub repo ─────────

export const RegisterCdBody = z.object({
  template: z.enum([...PROVISION_TEMPLATE_IDS]).optional(),
});

export async function registerCdStep(
  userId: string,
  id: string,
  input: z.infer<typeof RegisterCdBody>,
): Promise<StepResult> {
  const project = await getProjectCore(userId, id);
  if (!project) return json({ error: "Not found" }, 404);
  if (!project.gitUrl) {
    return json({ error: "No repository linked — provision a repo first." }, 400);
  }

  const parsed = parseGithubRepoUrl(project.gitUrl);
  if (!parsed) {
    return json({ error: "Linked repo is not a GitHub URL — cannot register bitbaum CD." }, 400);
  }

  const up = await getUserProjectByEntityId(userId, id);
  if (!up) {
    return json({ error: "No user_projects row for this entity — cannot record liveUrl." }, 400);
  }

  const token = (await getRepoWriteToken(userId))?.token ?? null;
  if (!token) {
    return json(
      { error: "No GitHub account linked. Sign in with GitHub first.", hasGithub: false },
      400,
    );
  }

  const access = await getExecutionAccess(userId);
  const result = await registerProjectSiteCd({
    userId,
    entityProjectId: id,
    userProjectId: up.id,
    projectName: project.name,
    repoFullName: `${parsed.owner}/${parsed.repo}`,
    template: input.template ?? "nextjs-tailwind",
    githubToken: token,
    cloudBuilderAllowed: access.cloudBuilderAllowed,
  });

  if ("error" in result && result.ok === false) {
    return json({ ok: false, error: result.error, code: result.code }, 400);
  }

  if (!("plan" in result)) {
    return json({ ok: false, error: "Unexpected register result" }, 500);
  }

  return json({
    ok: true,
    registered: result.registered,
    liveUrl: result.liveUrl,
    predictedLiveUrl: result.plan.liveUrl,
    slug: result.plan.slug,
    command: result.command,
    reason: result.reason,
    gate: result.gate,
    deployYmlSeeded: result.deployYmlSeeded,
    alreadyLive: false,
    deploymentStatus: result.deploymentStatus,
    deploymentUrl: result.deploymentUrl,
  });
}

// ── dispatch: turn a profile-stated fact into a scoped agent run ─────────────

export const DispatchBody = z.object({
  kind: z.enum(PROJECT_DISPATCH_KINDS),
  /** Required for fix_signal: which attention attr to fix. */
  signalKey: z.enum(HEALTH_SIGNAL_BASE.map((s) => s.key) as [string, ...string[]]).optional(),
});

export async function dispatchStep(
  userId: string,
  id: string,
  input: z.infer<typeof DispatchBody>,
): Promise<StepResult> {
  // Anyone with canEdit may dispatch — the owner and every builder. Until
  // 2026-09-28 this looked the project up BY OWNER, so a builder whose role
  // said "can run agents" got "Project not found" the moment they tried. The
  // work still runs in the OWNER's tenant (project-capabilities.ts): a builder
  // receives the capability, never the owner's runner credentials.
  const access = await getProjectAccess(userId, id);
  if (!access) return json({ error: "Project not found" }, 404);
  if (!access.canEdit) {
    return json(
      { error: `A ${access.role} can follow this project but not dispatch work on it` },
      403,
    );
  }
  const dossier = await getProjectDossierByOwner(access.ownerUserId, id);
  if (!dossier) return json({ error: "Project not found" }, 404);

  const composed = composeDispatchPrompt(input.kind, input.signalKey, dossier);
  if (composed.error) return json({ error: composed.error }, 409);

  return injectPrompt(
    {
      tab: dossier.detail.project.name,
      projectId: id,
      allowHostedFallback: false,
      customPrompt: composed.prompt,
    },
    access.ownerUserId,
  );
}
