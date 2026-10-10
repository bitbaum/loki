/**
 * "Back in 30 minutes" — the rules, with no database behind them: the status
 * from two timestamps and the clock, and the return card's lines. The
 * queries live in lib/away.ts. Tested in scripts/test/away.ts.
 */
export const AWAY_MAX_MINUTES = 24 * 60;
/** An absence nobody came back from expires: a card from three days ago is noise. */
const AWAY_STALE_MS = 3 * 24 * 60 * 60_000;

export type AwayStatus =
  | { state: "none" }
  | { state: "away"; since: string; until: string }
  | { state: "back"; since: string; until: string };

/** Away, back, or neither — from the two timestamps and the clock. Pure. */
export function awayStatus(
  prefs: { awaySince: string | null; awayUntil: string | null },
  now = Date.now(),
): AwayStatus {
  if (!prefs.awaySince || !prefs.awayUntil) return { state: "none" };
  const since = Date.parse(prefs.awaySince);
  const until = Date.parse(prefs.awayUntil);
  if (Number.isNaN(since) || Number.isNaN(until) || now - since > AWAY_STALE_MS)
    return { state: "none" };
  return now < until
    ? { state: "away", since: prefs.awaySince, until: prefs.awayUntil }
    : { state: "back", since: prefs.awaySince, until: prefs.awayUntil };
}

export type AwaySummary = {
  since: string;
  until: string;
  /** Minutes actually away, by the clock at read time. */
  minutes: number;
  runs: { started: number; finished: number; ok: number; failed: number; running: number };
  /** Projects a run touched since, for the sentence. */
  projects: string[];
  reports: { arrived: number; live: number };
  needsYou: number;
};

/** "32 min" / "1 h 05 min" / "2 days". */
export function awayDuration(minutes: number): string {
  if (minutes < 1) return "a moment";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

export type AwayLine = { text: string; href: string };

/**
 * The card's lines: what happened, each pointing at where it is seen or
 * acted on. Nothing happened → one honest line, not an empty card. Pure.
 */
export function awayLines(s: AwaySummary): AwayLine[] {
  const lines: AwayLine[] = [];
  if (s.needsYou > 0) {
    lines.push({
      text: `${s.needsYou} ${s.needsYou === 1 ? "thing needs" : "things need"} you`,
      href: "/feedback",
    });
  }
  if (s.reports.live > 0) {
    lines.push({
      text: `${s.reports.live} ${s.reports.live === 1 ? "fix is" : "fixes are"} live — check ${s.reports.live === 1 ? "it" : "them"}`,
      href: "/feedback",
    });
  }
  if (s.runs.finished > 0) {
    const bits = [
      s.runs.ok ? `${s.runs.ok} ok` : null,
      s.runs.failed ? `${s.runs.failed} failed` : null,
    ].filter(Boolean);
    const where = s.projects.length ? ` on ${s.projects.slice(0, 3).join(", ")}` : "";
    lines.push({
      text: `${s.runs.finished} ${s.runs.finished === 1 ? "run" : "runs"} finished${bits.length ? ` (${bits.join(", ")})` : ""}${where}`,
      href: "/activity",
    });
  }
  if (s.runs.running > 0) {
    lines.push({
      text: `${s.runs.running} still ${s.runs.running === 1 ? "runs" : "run"}`,
      href: "/control",
    });
  }
  if (s.reports.arrived > 0) {
    lines.push({
      text: `${s.reports.arrived} new ${s.reports.arrived === 1 ? "report" : "reports"} arrived`,
      href: "/feedback",
    });
  }
  if (lines.length === 0)
    lines.push({ text: "Nothing moved. Nothing needs you.", href: "/control" });
  return lines;
}
