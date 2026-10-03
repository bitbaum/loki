/**
 * The "Make it happen" sequence — one definition, run by the server.
 *
 * Pure: it knows the order, what each answer means and what to tell the
 * person, and nothing about HTTP, React or storage. The server run
 * (lib/kickoff/server-runs) hands it the step functions; the tests hand it a
 * script. That is the whole reason it is separate: the order and the wording
 * are the product, and they can only be pinned if they can run without a DB.
 */
import type { KickoffStepId } from "@/lib/project-kickoff";
import type { SiteDeployment } from "@/hooks/use-site-deployment";

export type KickoffStepState = "pending" | "running" | "done" | "failed";
export type KickoffStepRun = { id: KickoffStepId; state: KickoffStepState; note?: string };

/** Where the agent ended up, so every surface sends people to the right page. */
export type KickoffDispatchOutcome = "running" | "queued-offline" | "not-sent" | "failed";

export type KickoffRunState = {
  projectId: string;
  /** How other surfaces name this project — Terminal only knows the tab. */
  names: string[];
  steps: KickoffStepRun[];
  running: boolean;
  finished: boolean;
  /** The run stopped before it finished (a reload, a server restart). */
  interrupted?: boolean;
  startedAt: number;
  finishedAt?: number;
  dispatch?: KickoffDispatchOutcome;
  deployment?: SiteDeployment;
  /**
   * A step was refused because no GitHub account is linked. Carried as a flag,
   * not read out of the note text, so the card can offer the one button that
   * fixes it instead of a sentence telling the person to go find it.
   */
  needsGithub?: boolean;
  /**
   * The agent was refused because this account has no builder it may use: the
   * shared cloud builder is private to eligible accounts, so the way forward is
   * the person's own computer (Fleet Runner), offered as a button.
   */
  needsBuilder?: boolean;
};

/** A step's route answer: status + JSON body, or a thrown transport error. */
export type KickoffCall = (
  path: "brief" | "roadmap" | "provision" | "register-cd" | "dispatch",
  body: Record<string, unknown>,
) => Promise<{ status: number; body: Record<string, unknown> }>;

export type KickoffInput = {
  projectId: string;
  names: string[];
  plan: KickoffStepId[];
  source: string | null;
  visibility: "private" | "public";
};

export function initialKickoffRun(input: KickoffInput, now = Date.now()): KickoffRunState {
  return {
    projectId: input.projectId,
    names: input.names.filter(Boolean),
    steps: input.plan.map((id) => ({ id, state: "pending" })),
    running: true,
    finished: false,
    startedAt: now,
  };
}

type CdBody = SiteDeployment & { ok?: boolean; predictedLiveUrl?: string; error?: string };

/**
 * Run the plan, calling `emit` with a fresh snapshot after every change.
 * Never throws: a step that throws is reported as failed, like any refusal.
 */
export async function runKickoffPlan(
  input: KickoffInput,
  call: KickoffCall,
  emit: (run: KickoffRunState) => void,
): Promise<KickoffRunState> {
  let run = initialKickoffRun(input);
  const set = (next: KickoffRunState) => {
    run = next;
    emit(run);
  };
  const mark = (id: KickoffStepId, state: KickoffStepState, note?: string) =>
    set({ ...run, steps: run.steps.map((s) => (s.id === id ? { ...s, state, note } : s)) });
  const finish = (dispatch?: KickoffDispatchOutcome) => {
    set({ ...run, running: false, finished: true, finishedAt: Date.now(), dispatch });
    return run;
  };

  emit(run);

  /** Call a step; returns its body, or null with the step marked failed. */
  async function step(
    id: KickoffStepId,
    path: Parameters<KickoffCall>[0],
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    mark(id, "running");
    try {
      const res = await call(path, body);
      if (res.status >= 400 || !res.body.ok) {
        const error = res.body.error;
        if (res.body.hasGithub === false) set({ ...run, needsGithub: true });
        if (res.body.code === "cloud-builder-private" || res.body.code === "builder-required") {
          set({ ...run, needsBuilder: true });
        }
        mark(id, "failed", typeof error === "string" ? error : `HTTP ${res.status}`);
        return null;
      }
      return res.body;
    } catch (e) {
      console.error(`[kickoff] ${path} threw:`, e instanceof Error ? e.message : e);
      mark(id, "failed", "Something went wrong on our side. Try again in a moment.");
      return null;
    }
  }

  const { plan, source, visibility } = input;

  // Profile and milestones read the same text and don't depend on each other.
  // Run them together — serialising two model calls is waiting for nothing.
  await Promise.all(
    plan
      .filter((id) => id === "profile" || id === "milestones")
      .map(async (id) => {
        const body = await step(id, id === "profile" ? "brief" : "roadmap", { text: source });
        if (!body) return;
        if (id === "profile") {
          const count = Object.keys((body.applied as object) ?? {}).length;
          mark(id, "done", `${count} field${count === 1 ? "" : "s"} filled`);
        } else {
          const created = (body.created as string[]) ?? [];
          mark(id, "done", `${created.length} milestone${created.length === 1 ? "" : "s"}`);
        }
      }),
  );

  // Repo second: "auto" resolves the starter from the stack the profile step
  // just wrote, so this only picks well once that has landed.
  if (plan.includes("repo")) {
    const body = await step("repo", "provision", { template: "auto", visibility });
    if (!body) {
      // No repository — do not dispatch. An agent with nowhere to write code is
      // worse than a paused kickoff; Try again resumes from here.
      mark("dispatch", "failed", "Not started — the repository step has to land first.");
      return finish("not-sent");
    }
    if (body.templateSeeded === false) {
      // The repo exists but is bare: nothing to deploy, nothing to build on.
      // Try again re-seeds the same repo (provision detects the bare repo).
      mark(
        "repo",
        "failed",
        "Repository created, but the starter files were not written. Try again to add them.",
      );
      mark("dispatch", "failed", "Not started — waiting on the starter files.");
      return finish("not-sent");
    }
    const repoName =
      (body.repo as { full_name?: string } | undefined)?.full_name ?? "Repository created";
    const template = typeof body.template === "string" ? body.template : undefined;
    // Same flow, next beat: wire Hetzner CD (or return the one box command).
    mark("repo", "running", "Repository created — connecting the site deploy…");
    mark("repo", "done", await registerCd(repoName, template));
  }

  async function registerCd(repoName: string, template: string | undefined): Promise<string> {
    try {
      const res = await call("register-cd", {
        template:
          template === "bare" || template === "nextjs-tailwind" ? template : "nextjs-tailwind",
      });
      const cd = res.body as CdBody;
      if (res.status >= 400 || !cd.ok) {
        return cd.error ? `${repoName} · site deploy: ${cd.error}` : repoName;
      }
      set({ ...run, deployment: cd });
      if (cd.registered && cd.liveUrl) return `${repoName} · live ${cd.liveUrl}`;
      const why = cd.reason?.trim();
      const cmd = cd.command?.trim();
      if (why || cmd) return `${repoName} · ${why && cmd ? `${why} — ${cmd}` : why || cmd}`;
      if (cd.predictedLiveUrl) return `${repoName} · site will be ${cd.predictedLiveUrl}`;
      return repoName;
    } catch {
      return `${repoName} · site deploy skipped (it can be connected later)`;
    }
  }

  // Dispatch last. The prompt is composed server-side from whatever landed —
  // including the brief, which the profile step saves even when the model fails.
  const dispatched = await step("dispatch", "dispatch", { kind: "kickoff" });
  if (!dispatched) return finish("failed");

  // `ok: true` is not the same as "an agent is working". injectPrompt answers
  // ok when it REFUSED because the user was mid-keystroke in the target tab,
  // and when it queued a command with no builder connected to collect it.
  if (dispatched.blocked) {
    mark("dispatch", "failed", "Not sent — you were typing in that session. Try again.");
    return finish("not-sent");
  }
  if (dispatched.warning === "runner-offline") {
    mark(
      "dispatch",
      "done",
      "Queued — no builder is online yet, so the agent starts the moment one connects.",
    );
    return finish("queued-offline");
  }
  mark(
    "dispatch",
    "done",
    dispatched.mode === "direct"
      ? "Agent is working now."
      : "Sent to the builder — the session opens in Terminal within a minute.",
  );
  return finish("running");
}
