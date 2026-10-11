/**
 * What a thread needs from you, read off its last message.
 *
 * Claude's session list answers "what did I open recently"; a person running a
 * dozen projects needs "what needs me, what is running, what finished since I
 * looked". Every input for that already exists — a dispatch turn, the outcome
 * the server writes back when the run closes, the "which project?" question a
 * command left standing — but the rail showed a title, a last line and a
 * time, and nothing about state. This derives the state once, in one place,
 * for the rail, the start screen and the sort order, so the three cannot
 * disagree.
 *
 * Pure. No I/O, no dates read except the `now` the caller passes.
 */

export type ThreadStateKind = "needs-you" | "running" | "done" | "unread" | "quiet";

export type ThreadState = {
  kind: ThreadStateKind;
  /** The state in words, for the row — never a code word. */
  label: string;
};

/** The shape the list query returns per thread (dates as ISO strings). */
export type ThreadStateInput = {
  lastRole: string | null;
  lastKind: string | null;
  lastAt: string | null;
  /** dispatch: meta.ok; outcome: whether the run succeeded or partly did. */
  lastOk: boolean | null;
  /** outcome: the run's recorded outcome word. */
  lastOutcome: string | null;
  /** command: the turn is waiting on a project pick. */
  lastNeedsProject: boolean | null;
  lastReadAt: string | null;
};

/**
 * A dispatch older than this with no outcome written back is not "running":
 * the reaper closes runs long before, and a thread that says "running" for a
 * day teaches the person the word means nothing.
 */
export const RUNNING_STALE_MS = 6 * 60 * 60 * 1000;

const SUCCESS_OUTCOMES = new Set(["success", "partial"]);

function ms(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function isUnread(t: Pick<ThreadStateInput, "lastRole" | "lastAt" | "lastReadAt">): boolean {
  if (t.lastRole !== "assistant" || !t.lastAt) return false;
  return ms(t.lastAt) > ms(t.lastReadAt);
}

export function deriveThreadState(t: ThreadStateInput, now: number = Date.now()): ThreadState {
  const unread = isUnread(t);
  if (t.lastRole === "assistant") {
    if (t.lastKind === "command" && t.lastNeedsProject) {
      return { kind: "needs-you", label: "Needs you · which project?" };
    }
    if (t.lastKind === "dispatch") {
      if (t.lastOk === false) return { kind: "needs-you", label: "Could not start" };
      const age = now - ms(t.lastAt);
      if (age >= 0 && age < RUNNING_STALE_MS) return { kind: "running", label: "Running" };
      return unread
        ? { kind: "unread", label: "No outcome recorded" }
        : { kind: "quiet", label: "" };
    }
    if (t.lastKind === "outcome") {
      const ok =
        t.lastOk === true || (t.lastOutcome !== null && SUCCESS_OUTCOMES.has(t.lastOutcome));
      if (!ok) return { kind: "needs-you", label: "Did not finish" };
      return unread ? { kind: "done", label: "Done" } : { kind: "quiet", label: "Done" };
    }
    if (unread) return { kind: "unread", label: "Answered" };
  }
  return { kind: "quiet", label: "" };
}

const ORDER: Record<ThreadStateKind, number> = {
  "needs-you": 0,
  running: 1,
  done: 2,
  unread: 2,
  quiet: 3,
};

export type ThreadForSort = ThreadStateInput & {
  updatedAt: string;
  pinnedAt?: string | null;
};

/**
 * Pinned first, then what needs you, then what runs, then what came back
 * while you were away, then the rest — each by recency. Stable for ties, so
 * the list does not reshuffle under the pointer.
 */
export function sortThreads<T extends ThreadForSort>(threads: T[], now: number = Date.now()): T[] {
  return threads
    .map((t, i) => ({ t, i, state: deriveThreadState(t, now) }))
    .sort((a, b) => {
      const pa = a.t.pinnedAt ? 0 : 1;
      const pb = b.t.pinnedAt ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const oa = ORDER[a.state.kind];
      const ob = ORDER[b.state.kind];
      if (oa !== ob) return oa - ob;
      const ta = ms(a.t.updatedAt);
      const tb = ms(b.t.updatedAt);
      if (ta !== tb) return tb - ta;
      return a.i - b.i;
    })
    .map((x) => x.t);
}

export type ThreadStateCounts = { needsYou: number; running: number; done: number };

/** How many threads sit in each state that asks for a look. */
export function countThreadStates(
  threads: ThreadStateInput[],
  now: number = Date.now(),
): ThreadStateCounts {
  const counts: ThreadStateCounts = { needsYou: 0, running: 0, done: 0 };
  for (const t of threads) {
    const { kind } = deriveThreadState(t, now);
    if (kind === "needs-you") counts.needsYou += 1;
    else if (kind === "running") counts.running += 1;
    else if (kind === "done" || kind === "unread") counts.done += 1;
  }
  return counts;
}

/**
 * The one line above the greeting: "1 needs you · 2 running · 3 came back".
 * Empty when there is nothing to say — a line that reads "0 · 0 · 0" is noise.
 */
export function threadStateSummary(counts: ThreadStateCounts): string {
  const parts: string[] = [];
  if (counts.needsYou > 0)
    parts.push(`${counts.needsYou} need${counts.needsYou === 1 ? "s" : ""} you`);
  if (counts.running > 0) parts.push(`${counts.running} running`);
  if (counts.done > 0) parts.push(`${counts.done} came back`);
  return parts.join(" · ");
}

/** The key under which the thread is grouped when the rail is by project. */
export const NO_PROJECT_GROUP = "No project";

export type ProjectGroup<T> = { project: string; threads: T[]; counts: ThreadStateCounts };

/**
 * Threads by project, each group sorted as the flat list is, groups ordered
 * by urgency (a project with something that needs you first), then by the
 * newest thread in it. Threads without a project close the list.
 */
export function groupThreadsByProject<T extends ThreadForSort & { projectKeys: string[] }>(
  threads: T[],
  now: number = Date.now(),
): ProjectGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const t of threads) {
    const key = t.projectKeys[0] ?? NO_PROJECT_GROUP;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else buckets.set(key, [t]);
  }
  const groups: ProjectGroup<T>[] = [];
  for (const [project, list] of buckets) {
    const sorted = sortThreads(list, now);
    groups.push({ project, threads: sorted, counts: countThreadStates(sorted, now) });
  }
  return groups.sort((a, b) => {
    if ((a.project === NO_PROJECT_GROUP) !== (b.project === NO_PROJECT_GROUP)) {
      return a.project === NO_PROJECT_GROUP ? 1 : -1;
    }
    const ua = a.counts.needsYou > 0 ? 0 : a.counts.running > 0 ? 1 : 2;
    const ub = b.counts.needsYou > 0 ? 0 : b.counts.running > 0 ? 1 : 2;
    if (ua !== ub) return ua - ub;
    return ms(b.threads[0]?.updatedAt ?? null) - ms(a.threads[0]?.updatedAt ?? null);
  });
}
