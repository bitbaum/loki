import {
  runKickoffPlan,
  type KickoffCall,
  type KickoffInput,
  type KickoffRunState,
} from "@/lib/kickoff/orchestrate";
import {
  BriefBody,
  DispatchBody,
  ProvisionBody,
  RegisterCdBody,
  RoadmapBody,
  briefStep,
  dispatchStep,
  provisionStep,
  registerCdStep,
  roadmapStep,
  type StepResult,
} from "@/lib/kickoff/steps";

/**
 * Kickoff runs owned by the SERVER, so nothing the phone does can stop one.
 *
 * The browser used to drive the sequence, and a mobile browser suspends a tab
 * the moment the screen locks or another app comes forward — the most natural
 * thing to do while waiting a minute. Now the page asks the server to start the
 * run and only watches it; closing the tab, locking the phone or opening it on
 * another device all show the same live run.
 *
 * Held in process memory, deliberately: a run lasts a minute or two, the app is
 * one Node process, and everything a run WRITES (profile, repo, dispatch) lands
 * in the database as it goes. What memory loses on a restart is only the
 * progress list — and the client reports that as interrupted, with Try again
 * redoing only what is missing. Finished runs are kept for an hour so a person
 * coming back later still sees how it ended.
 */

const KEEP_FINISHED_MS = 60 * 60_000;

type Store = Map<string, KickoffRunState>;
// On globalThis so dev-server module reloads don't orphan a running kickoff.
const g = globalThis as unknown as { __lokiKickoffRuns?: Store };
const runs: Store = (g.__lokiKickoffRuns ??= new Map());

const keyOf = (userId: string, projectId: string) => `${userId}:${projectId}`;

function prune(now = Date.now()) {
  for (const [key, run] of runs) {
    if (!run.running && now - (run.finishedAt ?? run.startedAt) > KEEP_FINISHED_MS)
      runs.delete(key);
  }
}

export function getServerKickoff(userId: string, projectId: string): KickoffRunState | null {
  prune();
  return runs.get(keyOf(userId, projectId)) ?? null;
}

/** The newest run whose project goes by `tab` (Terminal knows only the name). */
export function findServerKickoffByName(userId: string, tab: string): KickoffRunState | null {
  prune();
  const want = tab.trim().toLowerCase();
  let found: KickoffRunState | null = null;
  for (const [key, run] of runs) {
    if (!key.startsWith(`${userId}:`)) continue;
    if (!run.names.some((n) => n.trim().toLowerCase() === want)) continue;
    if (!found || run.startedAt > found.startedAt) found = run;
  }
  return found;
}

function stepCall(userId: string, projectId: string): KickoffCall {
  // Same validation as the routes, so a server run cannot send a step a body
  // its own route would have refused.
  const invalid = (message: string): StepResult => ({ status: 400, body: { error: message } });
  return async (path, body) => {
    switch (path) {
      case "brief": {
        const p = BriefBody.safeParse(body);
        return p.success
          ? briefStep(userId, projectId, p.data)
          : invalid(p.error.issues[0]!.message);
      }
      case "roadmap": {
        const p = RoadmapBody.safeParse(body);
        return p.success
          ? roadmapStep(userId, projectId, p.data)
          : invalid(p.error.issues[0]!.message);
      }
      case "provision": {
        const p = ProvisionBody.safeParse(body);
        return p.success
          ? provisionStep(userId, projectId, p.data)
          : invalid(p.error.issues[0]!.message);
      }
      case "register-cd": {
        const p = RegisterCdBody.safeParse(body);
        return p.success
          ? registerCdStep(userId, projectId, p.data)
          : invalid(p.error.issues[0]!.message);
      }
      case "dispatch": {
        const p = DispatchBody.safeParse(body);
        return p.success
          ? dispatchStep(userId, projectId, p.data)
          : invalid(p.error.issues[0]!.message);
      }
    }
  };
}

/**
 * Start a run unless one is already going for this project — a second press,
 * a second tab or a second device joins the first run instead of starting a
 * second agent. Returns the snapshot to show immediately, plus the promise that
 * settles when the run ends (the route hands it to `after()`).
 */
export function startServerKickoff(
  userId: string,
  input: KickoffInput,
  call: KickoffCall = stepCall(userId, input.projectId),
): { run: KickoffRunState; done: Promise<unknown>; joined: boolean } {
  const key = keyOf(userId, input.projectId);
  const existing = runs.get(key);
  if (existing?.running) return { run: existing, done: Promise.resolve(), joined: true };

  const done = runKickoffPlan(input, call, (run) => {
    runs.set(key, run);
  }).catch((e) => {
    // runKickoffPlan never throws by contract; this is the belt to that brace.
    console.error("[kickoff] run crashed:", e);
    const run = runs.get(key);
    if (run?.running) runs.set(key, { ...run, running: false, finished: true, interrupted: true });
  });
  // runKickoffPlan emits its initial snapshot synchronously, before any await.
  return { run: runs.get(key)!, done, joined: false };
}
