/**
 * One person's agent sessions, read: the list (at most 25 rows, what needs
 * the person first, with the `total`), one run, or one project with the last
 * things said in its conversation.
 *
 * Two doors read through here and nothing else: OrangeCat's signed rail
 * (/api/orangecat/sessions, as the Loki user linked to an OrangeCat actor)
 * and the person's own session or `ck_` token (/api/control/sessions). Both
 * answer the same thing, so an agent that steers a session over either one
 * reads what the person reads on Control and Watch.
 *
 * Shaping and the contract are lib/integrations/orangecat-sessions.ts. The
 * conversation is the copy the server already keeps for the transcript view
 * (lastTranscript in lib/sse-bus). When nothing is cached, a read joins as a
 * viewer for a few seconds, exactly as the transcript stream does, so the
 * runner posts a snapshot; then it leaves again.
 */
import { getUserProjects, getOrgProjects } from "@/db/queries/user-projects";
import {
  getLatestRunForProjectKey,
  getOrchestrationRunById,
} from "@/db/queries/orchestration-runs";
import { enqueuePeekCommand } from "@/db/queries/pending-commands";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import {
  SESSIONS_DEFAULT_ITEMS,
  SESSIONS_MAX_PROJECTS,
  orderSessions,
  shapeSessionRow,
  shapeTranscriptItems,
  type SessionRow,
  type SessionRowInput,
} from "@/lib/integrations/orangecat-sessions";
import { loadRunTrack, type TrackableRun } from "@/lib/run-track-load";
import { addPeekViewer, lastTranscript, removePeekViewer } from "@/lib/sse-bus";
import { mergeVisibleProjects } from "@/lib/visible-projects";

/** How long a read waits for the runner's first snapshot of a conversation. */
const SNAPSHOT_WAIT_MS = 6_000;
const SNAPSHOT_POLL_MS = 300;

type Presence = SessionRowInput["presence"];
type RunRow = TrackableRun & { projectKey: string };

export type SessionsQuery = {
  /** One project: its row and the end of its conversation. */
  project?: string;
  /** One run: its row with the owner's full track. */
  runId?: string;
  /** How many conversation items, for a project read. */
  items?: number;
};

/** HTTP status and JSON body; each door adds only what is its own. */
export type SessionsRead = { status: number; body: Record<string, unknown> };

async function rowFor(
  userId: string,
  project: { name: string; builderPref?: string | null },
  run: RunRow | null,
  presence: Presence,
  ownerView: boolean,
): Promise<SessionRow> {
  const loaded = run ? await loadRunTrack(userId, run, { ownerView }).catch(() => null) : null;
  const tab = run?.payload?.sessionTab ?? project.name;
  const pr = loaded?.fix && !loaded.fix.foreignPr ? (loaded.fix.pr?.url ?? null) : null;
  return shapeSessionRow({
    project: project.name,
    builderPref: project.builderPref ?? null,
    presence,
    run:
      run && loaded
        ? {
            id: run.id,
            state: loaded.canonical.state,
            label: loaded.canonical.label,
            reason: loaded.canonical.reason,
            task: loaded.prompt?.text ?? null,
            track: loaded.track.summary,
            prUrl: pr,
            lastProgressAt: loaded.snap?.lastProgressAt ?? null,
          }
        : null,
    transcriptAt: lastTranscript(userId, tab)?.at ?? null,
    tab,
  });
}

/** The cached conversation, asking the runner for a snapshot when there is none. */
async function readTranscript(userId: string, tab: string) {
  const cached = lastTranscript(userId, tab);
  if (cached) return cached;
  const command = { tab };
  if (addPeekViewer(userId, tab)) {
    await enqueuePeekCommand(userId, "peek_start", command).catch(() => {});
  }
  try {
    const until = Date.now() + SNAPSHOT_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, SNAPSHOT_POLL_MS));
      const frame = lastTranscript(userId, tab);
      if (frame) return frame;
    }
    return null;
  } finally {
    if (removePeekViewer(userId, tab)) {
      await enqueuePeekCommand(userId, "peek_stop", command).catch(() => {});
    }
  }
}

/** Read one person's sessions, as that person. */
export async function readSessions(userId: string, query: SessionsQuery): Promise<SessionsRead> {
  const { project: wanted, runId, items } = query;
  const [own, org, presence] = await Promise.all([
    getUserProjects(userId).catch(() => []),
    getOrgProjects(userId).catch(() => []),
    getBuilderPresence(userId).catch(() => ({ cloud: false, local: false, any: false })),
  ]);
  const projects = mergeVisibleProjects(own, org);
  const generatedAt = new Date().toISOString();
  const builders = { cloud: presence.cloud, local: presence.local };

  if (runId) {
    const run = await getOrchestrationRunById(userId, runId);
    if (!run) {
      return {
        status: 404,
        body: { error: "run not found", detail: "No run with that id belongs to this account." },
      };
    }
    const project = projects.find((p) => p.name.toLowerCase() === run.projectKey.toLowerCase()) ?? {
      name: run.projectKey,
    };
    const row = await rowFor(userId, project, run, presence, true);
    return { status: 200, body: { ok: true, generatedAt, builders, sessions: [row] } };
  }

  if (wanted) {
    const project = projects.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
    if (!project) {
      const available = projects.map((p) => p.name).sort((a, b) => a.localeCompare(b));
      return {
        status: 404,
        body: {
          error: "project not found",
          detail: `No project named "${wanted}". Projects you can read: ${available.join(", ") || "none yet"}.`,
          available,
        },
      };
    }
    const run = await getLatestRunForProjectKey(userId, project.name);
    const tab = run?.payload?.sessionTab ?? project.name;
    const [row, frame] = await Promise.all([
      rowFor(userId, project, run, presence, true),
      readTranscript(userId, tab),
    ]);
    return {
      status: 200,
      body: {
        ok: true,
        generatedAt,
        builders,
        sessions: [row],
        transcript: frame
          ? {
              project: project.name,
              at: new Date(frame.at).toISOString(),
              items: shapeTranscriptItems(frame.items, items ?? SESSIONS_DEFAULT_ITEMS),
            }
          : null,
      },
    };
  }

  // The list never reaches GitHub or spends the owner's budget: ownerView
  // is off, so each row is the run's own facts and its cached ledger.
  const rows = await Promise.all(
    projects.map(async (project) =>
      rowFor(
        userId,
        project,
        await getLatestRunForProjectKey(userId, project.name).catch(() => null),
        presence,
        false,
      ),
    ),
  );
  // At most SESSIONS_MAX_PROJECTS rows, what needs the person first; `total`
  // says how many there were, so a cut list is never read as the whole one.
  return {
    status: 200,
    body: {
      ok: true,
      generatedAt,
      builders,
      total: rows.length,
      sessions: orderSessions(rows).slice(0, SESSIONS_MAX_PROJECTS),
    },
  };
}
