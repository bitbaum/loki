/**
 * What the headphones say UNASKED, engineered for a channel that cannot be
 * skimmed. Pure; pinned by scripts/test/voice-announce.ts.
 *
 * The rules, each learned from listening to the first version for an hour:
 *   - Coalesce. Three runs finishing in one poll is one sentence with three
 *     names, not three sentences with the same verb.
 *   - Vary. The same phrasing every twenty seconds is what makes a voice
 *     sound like a machine; a small rotation of equivalents, chosen by a
 *     counter the caller advances, is enough to stop that.
 *   - Prioritise. What needs the person (approvals, failures, the builder
 *     dropping) is said first; what merely happened (a run finished, a
 *     project started) comes after, or is held for a digest in "important"
 *     mode and read as a count.
 *   - Cue. Every announcement names the earcon that precedes it, so the ear
 *     knows good from bad before the first word.
 *   - Details on request. The first sentence is the headline; "details"
 *     reads what each run actually did.
 */
import type { AnnounceMode } from "@/config/no-screen";
import { count, excerptForSpeech, list, spoken } from "@/lib/voice/briefing";
import type { EarconKind } from "@/lib/voice/soundscape";

export type FleetChange =
  | { kind: "finished"; project: string; note: string | null }
  | { kind: "failed"; project: string; note: string | null }
  | { kind: "approval"; id: string; title: string }
  | { kind: "builder-offline" }
  | { kind: "builder-online" }
  | { kind: "alert"; title: string }
  | { kind: "started"; project: string };

export type Announcement = { earcon: EarconKind; text: string };

/** Which tone precedes which news. */
export function earconFor(kind: FleetChange["kind"]): EarconKind {
  switch (kind) {
    case "finished":
    case "started":
      return "finished";
    case "failed":
    case "alert":
      return "failed";
    case "approval":
      return "attention";
    case "builder-offline":
      return "offline";
    case "builder-online":
      return "online";
  }
}

/** Urgency order: what needs the person first. */
const PRIORITY: Record<FleetChange["kind"], number> = {
  "builder-offline": 0,
  failed: 1,
  approval: 2,
  alert: 3,
  "builder-online": 4,
  finished: 5,
  started: 6,
};

const pick = <T>(options: readonly T[], variant: number): T =>
  options[((variant % options.length) + options.length) % options.length];

const FINISHED_ONE = [
  (p: string, n: string) => `${p} finished${n ? `: ${n}` : "."}`,
  (p: string, n: string) => `${p} is done${n ? `. ${n}` : "."}`,
  (p: string, n: string) => `Done on ${p}${n ? `: ${n}` : "."}`,
] as const;
const FINISHED_MANY = [
  (ps: string[]) =>
    `${count(ps.length, "run")} finished: ${list(ps)}. Say "details" for what they did.`,
  (ps: string[]) => `${list(ps)} are done. Say "details" to hear what changed.`,
] as const;
const FAILED_ONE = [
  (p: string, n: string) => `${p} failed${n ? `: ${n}` : "."}`,
  (p: string, n: string) => `A run failed on ${p}${n ? `: ${n}` : "."}`,
] as const;
const STARTED = [
  (ps: string[]) => `${list(ps)} started working.`,
  (ps: string[]) => `Work started on ${list(ps)}.`,
] as const;

/** Split changes by mode: said now, or held for the digest. */
export function splitByMode(
  changes: FleetChange[],
  mode: AnnounceMode,
): { now: FleetChange[]; held: FleetChange[] } {
  if (mode === "everything") return { now: changes, held: [] };
  const now = changes.filter((c) => c.kind !== "finished" && c.kind !== "started");
  const held = changes.filter((c) => c.kind === "finished" || c.kind === "started");
  return { now, held };
}

/** Changes → sentences, coalesced by kind, most urgent first. */
export function phraseChanges(changes: FleetChange[], variant = 0): Announcement[] {
  const out: Announcement[] = [];
  const sorted = [...changes].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const byKind = <K extends FleetChange["kind"]>(k: K) =>
    sorted.filter((c): c is Extract<FleetChange, { kind: K }> => c.kind === k);

  if (byKind("builder-offline").length)
    out.push({
      earcon: "offline",
      text: "The builder went offline. Nothing can run until it is back.",
    });

  const failed = byKind("failed");
  if (failed.length === 1) {
    const f = failed[0];
    out.push({
      earcon: "failed",
      text: pick(FAILED_ONE, variant)(spoken(f.project), excerptForSpeech(f.note, 160)),
    });
  } else if (failed.length > 1) {
    out.push({
      earcon: "failed",
      text: `${count(failed.length, "run")} failed: ${list(failed.map((f) => spoken(f.project)))}. Say "what failed" for the errors.`,
    });
  }

  const approvals = byKind("approval");
  if (approvals.length === 1)
    out.push({
      earcon: "attention",
      text: `New approval: ${excerptForSpeech(approvals[0].title, 120)}. Say approve or reject.`,
    });
  else if (approvals.length > 1)
    out.push({
      earcon: "attention",
      text: `${count(approvals.length, "new approval")}. Say "what's waiting" to hear them.`,
    });

  for (const a of byKind("alert"))
    out.push({ earcon: "failed", text: `Alert: ${excerptForSpeech(a.title, 120)}.` });

  if (byKind("builder-online").length)
    out.push({ earcon: "online", text: "The builder is back online." });

  const finished = byKind("finished");
  if (finished.length === 1) {
    const f = finished[0];
    out.push({
      earcon: "finished",
      text: pick(FINISHED_ONE, variant)(spoken(f.project), excerptForSpeech(f.note, 160)),
    });
  } else if (finished.length > 1) {
    out.push({
      earcon: "finished",
      text: pick(FINISHED_MANY, variant)(finished.map((f) => spoken(f.project))),
    });
  }

  const started = byKind("started");
  if (started.length)
    out.push({
      earcon: "finished",
      text: pick(STARTED, variant)(started.map((s) => spoken(s.project))),
    });

  return out;
}

/** The digest of held changes, as one sentence, or null when there is nothing. */
export function phraseHeld(held: FleetChange[], variant = 0): Announcement | null {
  const finished = held.filter(
    (c): c is Extract<FleetChange, { kind: "finished" }> => c.kind === "finished",
  );
  if (finished.length === 0) return null;
  const names = [...new Set(finished.map((f) => spoken(f.project)))];
  return {
    earcon: "finished",
    text: pick(
      [
        `Since I last said: ${count(finished.length, "run")} finished on ${list(names)}. Say "details" if you want them.`,
        `${count(finished.length, "run")} finished while you were walking: ${list(names)}. "Details" reads them.`,
      ] as const,
      variant,
    ),
  };
}

/** What "details" reads: each finished or failed run with its note. */
export function detailsFor(changes: FleetChange[]): string {
  const runs = changes.filter(
    (c): c is Extract<FleetChange, { kind: "finished" | "failed" }> =>
      c.kind === "finished" || c.kind === "failed",
  );
  if (runs.length === 0) return "Nothing to add.";
  return runs
    .map((r) => {
      const note = excerptForSpeech(r.note, 220);
      return `${spoken(r.project)} ${r.kind === "failed" ? "failed" : "finished"}${note ? `: ${note}` : ", and left no note."}`;
    })
    .join(" ");
}
