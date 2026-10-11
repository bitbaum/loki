/**
 * From a list of usage events to one line per surface that a person — or Loki
 * — can act on: shown how often, tapped how often, which kinds were offered
 * and never taken, when it was last used.
 *
 * Pure: no DB, no clock of its own (`now` is passed), so the test drives it
 * directly and the same summary feeds both Loki's facts and any later report.
 */
import { USAGE_SURFACES, USAGE_WINDOW_DAYS, isUsageSurface } from "@/config/usage-surfaces";

export type UsageEventLike = {
  surface: string;
  action: string;
  target: string | null;
  meta: unknown;
  createdAt: Date;
};

export type KindUsage = { kind: string; offered: number; taps: number };

export type SurfaceUsageSummary = {
  surface: string;
  label: string;
  path: string | null;
  days: number;
  shown: number;
  taps: number;
  rotates: number;
  /** taps / shown, or null when it was never shown. */
  tapRate: number | null;
  /** Per kind (the part of `target` before the first colon), most offered first. */
  kinds: KindUsage[];
  /** Kinds offered at least twice and never tapped — the surface's dead weight. */
  neverTapped: string[];
  /** The most-tapped targets, most first. */
  topTargets: { target: string; taps: number }[];
  lastShownAt: Date | null;
  lastTapAt: Date | null;
  verdict: "never shown" | "shown, never used" | "used";
};

export function kindOf(target: string): string {
  const i = target.indexOf(":");
  return i > 0 ? target.slice(0, i) : target;
}

function offeredKinds(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const kinds = (meta as { kinds?: unknown }).kinds;
  return Array.isArray(kinds) ? kinds.filter((k): k is string => typeof k === "string") : [];
}

function later(a: Date | null, b: Date): Date {
  return a && a > b ? a : b;
}

/**
 * One summary per surface that has events in the window, in the registry's
 * order, followed by any surface the registry does not know (an old row after
 * a rename is still a row). A registered surface with no events is included
 * as "never shown", because "we built it and it never appeared" is the first
 * thing a report should say.
 */
export function summarizeUsage(
  events: UsageEventLike[],
  opts: { now?: Date; days?: number } = {},
): SurfaceUsageSummary[] {
  const now = opts.now ?? new Date();
  const days = opts.days ?? USAGE_WINDOW_DAYS;
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  const inWindow = events.filter(
    (e) => e.createdAt.getTime() >= since && e.createdAt.getTime() <= now.getTime(),
  );

  const bySurface = new Map<string, UsageEventLike[]>();
  for (const id of Object.keys(USAGE_SURFACES)) bySurface.set(id, []);
  for (const e of inWindow) {
    const list = bySurface.get(e.surface) ?? [];
    list.push(e);
    bySurface.set(e.surface, list);
  }

  const out: SurfaceUsageSummary[] = [];
  for (const [surface, list] of bySurface) {
    const spec = isUsageSurface(surface) ? USAGE_SURFACES[surface] : null;
    let shown = 0;
    let taps = 0;
    let rotates = 0;
    let lastShownAt: Date | null = null;
    let lastTapAt: Date | null = null;
    const kinds = new Map<string, KindUsage>();
    const targets = new Map<string, number>();
    const kindEntry = (kind: string) => {
      const k = kinds.get(kind) ?? { kind, offered: 0, taps: 0 };
      kinds.set(kind, k);
      return k;
    };
    for (const e of list) {
      if (e.action === "shown") {
        shown += 1;
        lastShownAt = later(lastShownAt, e.createdAt);
        for (const kind of offeredKinds(e.meta)) kindEntry(kind).offered += 1;
      } else if (e.action === "tap") {
        taps += 1;
        lastTapAt = later(lastTapAt, e.createdAt);
        if (e.target) {
          kindEntry(kindOf(e.target)).taps += 1;
          targets.set(e.target, (targets.get(e.target) ?? 0) + 1);
        }
      } else if (e.action === "rotate") {
        rotates += 1;
      }
    }
    const kindList = [...kinds.values()].sort((a, b) => b.offered - a.offered || b.taps - a.taps);
    out.push({
      surface,
      label: spec?.label ?? surface,
      path: spec?.path ?? null,
      days,
      shown,
      taps,
      rotates,
      tapRate: shown > 0 ? taps / shown : null,
      kinds: kindList,
      neverTapped: kindList.filter((k) => k.offered >= 2 && k.taps === 0).map((k) => k.kind),
      topTargets: [...targets.entries()]
        .map(([target, n]) => ({ target, taps: n }))
        .sort((a, b) => b.taps - a.taps)
        .slice(0, 5),
      lastShownAt,
      lastTapAt,
      verdict:
        shown === 0 && taps === 0 ? "never shown" : taps === 0 ? "shown, never used" : "used",
    });
  }
  return out;
}

/** The summary as one sentence a model or a report can quote. */
export function usageLine(s: SurfaceUsageSummary): string {
  if (s.verdict === "never shown") {
    return `${s.label}: not shown once in the last ${s.days} days.`;
  }
  const rate =
    s.tapRate === null ? "" : ` (${Math.round(s.tapRate * 100)}% of the times it was shown)`;
  const parts = [`${s.label}: shown ${s.shown}×, tapped ${s.taps}×${rate}`];
  if (s.rotates > 0) parts.push(`"Other ideas" pressed ${s.rotates}×`);
  if (s.topTargets.length > 0) {
    parts.push(`most tapped: ${s.topTargets.map((t) => `${t.target} (${t.taps})`).join(", ")}`);
  }
  if (s.neverTapped.length > 0) {
    parts.push(`offered and never tapped: ${s.neverTapped.join(", ")}`);
  }
  return `${parts.join("; ")}.`;
}
