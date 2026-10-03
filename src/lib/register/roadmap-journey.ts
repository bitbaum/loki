import type { MapRoadmapItem } from "@/lib/register/map";

/**
 * The roadmap as a journey: what is behind us, where we are, what is ahead.
 *
 * Pure — the page renders it, the test pins it. The record is the fleet map's
 * roadmap (ROADMAP.md, read into the map); nothing here invents progress. A
 * percentage is computed only from ticked steps, and an item with no steps
 * says so instead of guessing a number.
 */

export type JourneyPhase = "shipped" | "now" | "next" | "later";

export type JourneyStop = {
  title: string;
  line: string | null;
  phase: JourneyPhase;
  targetDate: string | null;
  done: number;
  total: number;
  /** 0–100 from ticked steps; null when the item has no steps to count. */
  percent: number | null;
  /** The first step not yet ticked — "what happens next" for this stop. */
  nextStep: string | null;
  milestones: MapRoadmapItem["milestones"];
};

export type Journey = {
  shipped: JourneyStop[];
  now: JourneyStop[];
  next: JourneyStop[];
  later: JourneyStop[];
  /** Ticked steps across everything still on the road (now + next + later). */
  stepsDone: number;
  stepsTotal: number;
  /** Shipped items over all items — the headline "how far along" number. */
  percentShipped: number;
};

const PHASE_BY_STATUS: Record<string, JourneyPhase> = {
  done: "shipped",
  shipped: "shipped",
  "in progress": "now",
  planned: "next",
  later: "later",
};

export function phaseOf(status: string | null): JourneyPhase {
  return PHASE_BY_STATUS[(status ?? "planned").toLowerCase()] ?? "next";
}

export function toStop(item: MapRoadmapItem): JourneyStop {
  const total = item.milestones.length;
  const done = item.milestones.filter((m) => m.done).length;
  const phase = phaseOf(item.status);
  return {
    title: item.title,
    line: item.line,
    phase,
    targetDate: item.targetDate,
    done,
    total,
    percent: phase === "shipped" ? 100 : total > 0 ? Math.round((done / total) * 100) : null,
    nextStep: item.milestones.find((m) => !m.done)?.title ?? null,
    milestones: item.milestones,
  };
}

export function buildJourney(items: MapRoadmapItem[]): Journey {
  const stops = items.map(toStop);
  const by = (p: JourneyPhase) => stops.filter((s) => s.phase === p);
  const road = stops.filter((s) => s.phase !== "shipped");
  const shipped = by("shipped");
  return {
    shipped,
    now: by("now"),
    next: by("next"),
    later: by("later"),
    stepsDone: road.reduce((n, s) => n + s.done, 0),
    stepsTotal: road.reduce((n, s) => n + s.total, 0),
    percentShipped: stops.length ? Math.round((shipped.length / stops.length) * 100) : 0,
  };
}
