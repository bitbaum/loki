import type { TrackStageState } from "@/lib/run-track";

/**
 * The project's build as ONE line above the box: "Pull request open · 4 min",
 * "Live on aoz-housing.orangecat.ch", "Claude Code went quiet — it may be
 * stuck". Watch's card says the same in a column of stages; here it is the
 * sentence the track already composes, and a tone the dot can show. Pure;
 * tested in scripts/test/workbench-state-line.ts.
 */
export type StateLineInput = {
  run?: { live: boolean } | null;
  status?: { label: string; stalled: boolean; error: string | null } | null;
  track?: {
    summary: string;
    stages: { id: string; state: TrackStageState }[];
    current: string;
    settled: boolean;
  } | null;
};

export type StateLineTone = "positive" | "warning" | "negative" | "neutral";

export type StateLine = {
  text: string;
  tone: StateLineTone;
  /** Something can still change: keep asking. */
  moving: boolean;
};

const TONE_OF: Record<TrackStageState, StateLineTone> = {
  done: "positive",
  now: "positive",
  next: "neutral",
  attention: "warning",
  failed: "negative",
};

export const IDLE_STATE_LINE: StateLine = {
  text: "Nothing is being built right now. Say what to change.",
  tone: "neutral",
  moving: false,
};

export function stateLine(input: StateLineInput | null): StateLine {
  if (!input) return IDLE_STATE_LINE;
  if (input.track) {
    const current = input.track.stages.find((s) => s.id === input.track?.current);
    return {
      text: input.track.summary,
      tone: current ? TONE_OF[current.state] : "neutral",
      moving: !input.track.settled,
    };
  }
  if (input.status) {
    const tone: StateLineTone = input.status.error
      ? "negative"
      : input.status.stalled
        ? "warning"
        : input.run?.live
          ? "positive"
          : "neutral";
    return { text: input.status.label, tone, moving: Boolean(input.run?.live) };
  }
  return IDLE_STATE_LINE;
}
