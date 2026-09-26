/**
 * Server-side CD registration for a provisioned project.
 *
 * Prefer running scripts/hetzner/register-site.sh when this process is on the
 * studio box (script + deploy key present, eligible account). Otherwise seed
 * deploy.yml via the GitHub API and return the one command — never claim a
 * live site with no registration.
 */
import path from "path";
import {
  describeSiteDeployment,
  siteDeploymentIsLive,
  type SiteDeploymentRun,
  type SiteDeploymentStatus,
} from "@/lib/site-cd-deployment";
import { spawn } from "child_process";
import { GITHUB_API_BASE } from "@/lib/github-api";
import { HTTP_TIMEOUT_SHORT_MS } from "@/lib/constants/time";
import { setProjectLiveUrl } from "@/db/queries/atlas";
import { fetchAttributesByEntityIds, upsertEntityAttribute } from "@/db/queries/utils";
import { PROJECT_ATTR } from "@/config/project-attrs";
import {
  DEPLOY_WORKFLOW_PATH,
  isRegistrationNextStep,
  planSiteCd,
  type SiteCdPlan,
} from "@/lib/site-cd";
import {
  probeRegisterSiteLocally,
  studioDevRoot,
  studioRepoRoot,
  type RegisterSiteGate,
} from "@/lib/site-cd-local";

export {
  canRunRegisterSiteLocally,
  probeRegisterSiteLocally,
  resolveDeployKeyPath,
  resolveRegisterScriptPath,
  studioDevRoot,
  studioRepoRoot,
  type RegisterSiteGate,
  type RegisterSiteLocalProbe,
} from "@/lib/site-cd-local";

export type SiteCdRegisterResult = {
  plan: Extract<SiteCdPlan, { ok: true }>;
  deployYmlSeeded: boolean;
  /** True only when register-site.sh finished successfully on this host. */
  registered: boolean;
  liveUrl: string | null;
  /** Present when registration still needs an operator/box step. */
  command: string | null;
  reason: string | null;
  /** Which local gate blocked auto-register, when applicable. */
  gate: RegisterSiteGate | null;
  deploymentStatus?: "pending" | "failed" | "live";
  deploymentUrl?: string | null;
};

async function ghJson(
  token: string,
  apiPath: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const res = await fetch(`${GITHUB_API_BASE}${apiPath}`, {
    ...init,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_SHORT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { ok: res.ok, status: res.status, json };
}

/** Ensure deploy.yml exists on the default branch (Contents API). Non-fatal.
 * Also repairs legacy `secrets: inherit` shims — inherit does not pass secrets
 * when the caller repo is outside the workflow owner's org (e.g. catomean → bitbaum).
 */
export async function ensureDeployWorkflow(
  token: string,
  owner: string,
  repo: string,
  yaml: string,
): Promise<boolean> {
  const pathEnc = DEPLOY_WORKFLOW_PATH.split("/").map(encodeURIComponent).join("/");
  const existing = await ghJson(token, `/repos/${owner}/${repo}/contents/${pathEnc}`);
  if (existing.ok) {
    const file = existing.json as { content?: string; sha?: string } | null;
    const raw = Buffer.from(file?.content ?? "", "base64").toString("utf8");
    // Upgrade the two shapes that break deploys: the legacy `secrets: inherit`
    // (cross-owner key), and a shim that does not grant `actions: read` — on
    // a private repo its CI gate cannot see CI and passes every deploy.
    const legacySecrets =
      raw.includes("secrets: inherit") && yaml.includes("HETZNER_SSH_PRIVATE_KEY");
    const blindGate = !raw.includes("actions: read") && yaml.includes("actions: read");
    if (legacySecrets || blindGate) {
      const put = await ghJson(token, `/repos/${owner}/${repo}/contents/${pathEnc}`, {
        method: "PUT",
        body: JSON.stringify({
          message: blindGate
            ? `fix: let the deploy's CI gate read this repo's workflow runs`
            : `fix: pass HETZNER_SSH_PRIVATE_KEY explicitly for cross-owner deploy`,
          content: Buffer.from(yaml, "utf8").toString("base64"),
          sha: file?.sha,
          branch: "main",
        }),
      });
      return put.ok;
    }
    return true; // already present and OK
  }

  const put = await ghJson(token, `/repos/${owner}/${repo}/contents/${pathEnc}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore: add self-host deploy shim for ${repo}`,
      content: Buffer.from(yaml, "utf8").toString("base64"),
      // Prefer main; GitHub uses the repo default when omitted on some APIs,
      // but Contents PUT wants an explicit branch when the repo is not empty.
      branch: "main",
    }),
  });
  return put.ok;
}

function runRegisterSiteScript(args: {
  slug: string;
  repoFullName: string;
  title: string;
  scriptPath: string;
  deployKeyPath: string;
  githubToken: string;
}): Promise<{ ok: boolean; output: string }> {
  const script = args.scriptPath;
  const repoRoot = studioRepoRoot();
  const devRoot = studioDevRoot();
  return new Promise((resolve) => {
    const child = spawn(
      "bash",
      [
        script,
        args.slug,
        "--repo",
        args.repoFullName,
        "--title",
        args.title,
        // CI owns builds. Dispatch only after registration, secret and env exist.
        "--no-deploy",
      ],
      {
        detached: true,
        env: {
          ...process.env,
          LOKI_REPO_ROOT: repoRoot,
          DEV_ROOT: devRoot,
          DEPLOY_KEY_PATH: args.deployKeyPath,
          GH_TOKEN: args.githubToken,
        },
        // register-site resolves FC_REPO from env; cwd is only a fallback.
        cwd: path.dirname(path.dirname(script)),
      },
    );
    let output = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });
    const timeout = setTimeout(() => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }
    }, 90_000);
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, output: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, output });
    });
  });
}

/**
 * Seed deploy.yml, try box-local register-site.sh when eligible+possible,
 * record liveUrl only when registration actually ran.
 */
export async function registerProjectSiteCd(input: {
  userId: string;
  entityProjectId: string;
  userProjectId: string;
  projectName: string;
  repoFullName: string;
  template?: string | null;
  githubToken: string;
  /** Same gate as shared cloud builder — studio box CD is not multi-tenant. */
  cloudBuilderAllowed: boolean;
}): Promise<SiteCdRegisterResult | { ok: false; error: string; code: string }> {
  const plan = planSiteCd({
    projectName: input.projectName,
    repoFullName: input.repoFullName,
    template: input.template,
  });
  if (!plan.ok) return plan;

  const [owner, repo] = input.repoFullName.split("/");
  let deployYmlSeeded = false;
  if (owner && repo) {
    deployYmlSeeded = await ensureDeployWorkflow(input.githubToken, owner, repo, plan.deployYml);
  }

  // Do NOT write production_url / liveUrl until registration succeeds —
  // Check live resolves those and must not pretend a Caddy host exists yet.
  // predictedLiveUrl rides the API/UI response; next_step holds the command.

  if (!input.cloudBuilderAllowed) {
    const reason =
      "Shared bitbaum CD is studio-only (isDefault or LOKI_CLOUD_BUILDER_USER_IDS). Connect Fleet Runner for local work, or run the register command on the box.";
    await upsertEntityAttribute(
      input.userId,
      input.entityProjectId,
      PROJECT_ATTR.NEXT_STEP,
      `Register CD on the studio box: ${plan.command}`,
    );
    return {
      plan,
      deployYmlSeeded,
      registered: false,
      liveUrl: null,
      command: plan.command,
      reason,
      gate: "cloud-builder-private",
    };
  }

  const probe = probeRegisterSiteLocally();
  if (!probe.ok) {
    await upsertEntityAttribute(
      input.userId,
      input.entityProjectId,
      PROJECT_ATTR.NEXT_STEP,
      `${probe.reason ?? "Auto-register unavailable"} — ${plan.command}`,
    );
    return {
      plan,
      deployYmlSeeded,
      registered: false,
      liveUrl: null,
      command: plan.command,
      reason: probe.reason,
      gate: probe.gate,
    };
  }

  const ran = await runRegisterSiteScript({
    slug: plan.slug,
    repoFullName: input.repoFullName,
    title: input.projectName,
    scriptPath: probe.scriptPath!,
    deployKeyPath: probe.deployKeyPath!,
    githubToken: input.githubToken,
  });

  if (!ran.ok) {
    const reason = `register-site.sh failed — run manually. ${ran.output.slice(-400)}`;
    await upsertEntityAttribute(
      input.userId,
      input.entityProjectId,
      PROJECT_ATTR.NEXT_STEP,
      `${reason} — ${plan.command}`,
    );
    return {
      plan,
      deployYmlSeeded,
      registered: false,
      liveUrl: null,
      command: plan.command,
      reason,
      gate: "script-failed",
    };
  }

  return checkProjectSiteDeployment(input, true);
}

/** A workflow success on the current main commit plus a public response is
 * evidence of a deployment. A registered hostname alone is not a live site. */
export async function checkProjectSiteDeployment(
  input: {
    userId: string;
    entityProjectId: string;
    userProjectId: string;
    projectName: string;
    repoFullName: string;
    githubToken: string;
  },
  dispatch = false,
): Promise<SiteCdRegisterResult | { ok: false; error: string; code: string }> {
  const plan = planSiteCd(input);
  if (!plan.ok) return plan;
  const base = `/repos/${input.repoFullName}`;
  const head = await ghJson(input.githubToken, `${base}/commits/main`);
  const sha = (head.json as { sha?: string } | null)?.sha;
  if (!head.ok || !sha)
    return {
      ok: false,
      error: "Cannot read the repository's main commit.",
      code: "github-unavailable",
    };
  // No head_sha filter: a run that is still queued for an OLDER commit, or one
  // GitHub has not materialised yet for a dispatch sent seconds ago, must read
  // as "starting", not "no deployment exists". The first GET after kickoff
  // used to land in that gap and stop polling on a false failure.
  const runs = await ghJson(
    input.githubToken,
    `${base}/actions/workflows/deploy.yml/runs?per_page=20`,
  );
  const workflowMissing = runs.status === 404;
  if (!runs.ok && !workflowMissing) {
    return {
      ok: false,
      error: `Cannot read deployment status (GitHub HTTP ${runs.status}). Check repository Actions access and retry.`,
      code: "github-unavailable",
    };
  }
  const allRuns =
    (runs.json as { workflow_runs?: SiteDeploymentRun[] } | null)?.workflow_runs ?? [];
  const described = describeSiteDeployment(allRuns, sha, { dispatch, workflowMissing });
  const { run, inFlight } = described;
  let status: SiteDeploymentStatus = described.status;
  let reason = described.reason;
  if (run?.status === "completed" && run.conclusion === "success") {
    try {
      const response = await fetch(plan.liveUrl, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        redirect: "manual",
      });
      if (siteDeploymentIsLive(run, response.status)) status = "live";
      else {
        status = "failed";
        reason = `Deployment completed, but the public site returned HTTP ${response.status}.`;
      }
    } catch {
      status = "failed";
      reason = "Deployment completed, but the public site is not reachable yet.";
    }
  }
  if (dispatch && !inFlight && (!run || status === "failed")) {
    const triggered = await ghJson(
      input.githubToken,
      `${base}/actions/workflows/deploy.yml/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({ ref: "main" }),
      },
    );
    status = triggered.ok ? "pending" : "failed";
    reason = triggered.ok
      ? "Deployment queued. The live link appears after deployment and a public check pass."
      : `Could not start deployment (GitHub HTTP ${triggered.status}). Retry registration.`;
  }
  if (status === "live") {
    await setProjectLiveUrl(input.userId, input.userProjectId, plan.liveUrl);
    await upsertEntityAttribute(
      input.userId,
      input.entityProjectId,
      PROJECT_ATTR.PRODUCTION_URL,
      plan.liveUrl,
    );
  }
  // next_step is the OWNER's "what should happen next": Control shows it as
  // "Suggested next" and every dispatch briefs the agent with it. A status is
  // not a step. This wrote "Live site: <url>" there on success, so Skif's
  // agents were briefed "next: Live site: https://skif.orangecat.ch" and the
  // owner's plan was gone (2026-09-25). Only a failure is a next step (the
  // owner must retry); on success, clear a message registration itself left.
  if (status === "failed") {
    await upsertEntityAttribute(
      input.userId,
      input.entityProjectId,
      PROJECT_ATTR.NEXT_STEP,
      reason,
    );
  } else {
    const current = (await fetchAttributesByEntityIds([input.entityProjectId])).get(
      input.entityProjectId,
    )?.[PROJECT_ATTR.NEXT_STEP];
    if (isRegistrationNextStep(current)) {
      await upsertEntityAttribute(input.userId, input.entityProjectId, PROJECT_ATTR.NEXT_STEP, "");
    }
  }
  const registered = Boolean(run) || inFlight || (dispatch && status !== "failed");
  return {
    plan,
    deployYmlSeeded: true,
    registered,
    liveUrl: status === "live" ? plan.liveUrl : null,
    command: null,
    reason: status === "live" ? null : reason,
    gate: null,
    deploymentStatus: status,
    deploymentUrl: run?.html_url ?? null,
  };
}
