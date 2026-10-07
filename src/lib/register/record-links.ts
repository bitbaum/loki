import { linkDevelopment, readRefs, type Advance, type ChangeRef } from "bip-kit";
import type { MapRoadmapItem } from "@/lib/register/map";

/**
 * The roadmap and the changelog read as one record, for Loki's own pages and
 * every fleet profile it renders.
 *
 * A `{#id}` token on a ROADMAP.md milestone and on the CHANGELOG.md line that
 * delivered it links the two (bip-kit 0.6.0, `linkDevelopment` — one model for
 * every fleet site). The token rides inside the strings the map already
 * carries, so EVERY place that prints record text strips it: `recordText`.
 * Before this existed, /fleet/orangecat printed "Events, end to end {#events}".
 */

/** Record text as a reader sees it: the `{#id}` tokens taken out. */
export function recordText(text: string): string {
  return readRefs(text).text;
}

export type RecordLinks = {
  /** Changelog days that delivered a milestone, one per day, oldest first. */
  deliveredIn: (milestoneTitle: string) => ChangeRef[];
  /** The milestone anchor for a raw milestone title, when it carries an id. */
  stepAnchor: (milestoneTitle: string) => string | null;
  /** What one raw changelog line delivered on the roadmap. */
  advances: (line: string) => Advance[];
};

export function recordLinks(
  roadmap: MapRoadmapItem[],
  changelog: Array<{ date: string; done: string }>,
): RecordLinks {
  const linked = linkDevelopment({
    slug: "",
    name: "",
    what: null,
    roadmap: roadmap.map((g) => ({ ...g, milestones: g.milestones })),
    changelog,
  });
  const steps = new Map(
    linked.goals.flatMap((g) => g.steps.filter((s) => s.id).map((s) => [s.id as string, s])),
  );
  const ids = new Map(linked.goals.flatMap((g) => (g.id ? [[g.id, g] as const] : [])));
  const firstId = (text: string) => readRefs(text).refs[0] ?? null;
  return {
    deliveredIn: (title) => {
      const step = steps.get(firstId(title) ?? "");
      const refs = step?.deliveredIn ?? [];
      return refs.filter((c, i) => refs.findIndex((r) => r.anchor === c.anchor) === i);
    },
    stepAnchor: (title) => steps.get(firstId(title) ?? "")?.anchor ?? null,
    advances: (line) =>
      readRefs(line).refs.flatMap((id): Advance[] => {
        const step = steps.get(id);
        const goal = linked.goals.find((g) => g.steps.includes(step!)) ?? ids.get(id);
        if (!goal) return [];
        return [
          {
            goal: goal.title,
            goalAnchor: goal.anchor,
            step: step?.title ?? null,
            stepAnchor: step?.anchor ?? null,
            done: step ? step.done : null,
          },
        ];
      }),
  };
}
