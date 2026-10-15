import { answer } from "@/lib/project-display";
import { timeAgo } from "@/lib/dates";
import { DAY_MS } from "@/lib/constants/time";
import { RECENT_WORK_DAYS } from "@/lib/start-my-day/rank";
import type { SessionState } from "@/lib/control-types";

/** Historical handoffs remain in history; only recent ones lead the composer. */
export function controlNextStep(
  session: Pick<SessionState, "next" | "mtime"> | null,
  profileValue: string | undefined,
  nowS: number,
) {
  const fresh =
    session &&
    session.mtime <= nowS * 1000 &&
    session.mtime >= nowS * 1000 - RECENT_WORK_DAYS * DAY_MS;
  const next = fresh ? answer(session.next) : null;
  if (next)
    return {
      text: next,
      label: `Next (agent, ${timeAgo(session!.mtime)}):`,
      sourceTitle: "From this project's latest agent handoff.",
    };
  const profile = answer(profileValue);
  return profile
    ? {
        text: profile,
        label: "Suggested next (profile):",
        sourceTitle: "From the project profile — written during enrichment, not by a recent run.",
      }
    : null;
}
