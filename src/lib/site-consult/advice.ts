import type { Consultation } from "@/lib/site-consult/findings";

/**
 * What Loki SAYS about a consultation — the report turned into a few lines of
 * conversation a consultant would actually speak: what it looked at, the one
 * thing to do first, and what is already good. Rules only (no model), so the
 * anonymous /change page spends no AI and every sentence is backed by a
 * finding. Pure: pinned in scripts/test/site-consult.ts.
 */
export type ConsultTalk = {
  /** "I opened center.com and read 7 of its pages…" */
  opening: string;
  /** The one move to make first, or null when nothing is wrong. */
  firstMove: { title: string; because: string } | null;
  /** A sentence on what already works, or null when nothing passed. */
  strengths: string | null;
  /** The hand-over to the person: what to do next. */
  handover: string;
};

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function consultTalk(c: Consultation): ConsultTalk {
  const read = c.pages.filter((p) => p.ok).length;
  const failed = c.pages.length - read;
  const opening =
    c.pages.length > 1
      ? `I opened ${c.site.host} and read ${read} of its pages the way a new visitor and Google do${failed ? ` — ${failed} of the links I followed did not open` : ""}.`
      : `I opened ${c.site.host} and read it the way a new visitor and Google do.`;

  const top = c.findings[0];
  const firstMove = top ? { title: top.title, because: top.why } : null;

  const good = c.passed.slice(0, 3).map((p) => lower(p.label));
  const strengths =
    good.length === 0
      ? null
      : good.length === 1
        ? `What already works: ${good[0]}.`
        : `What already works: ${good.slice(0, -1).join(", ")} and ${good.at(-1)}.`;

  const handover = c.findings.length
    ? `Keep the fixes you want in the build — they are all on by default. Then two quick questions, and I start on the new version.`
    : `Nothing is broken, so the new version is about what you want next. Two quick questions, and I start.`;

  return { opening, firstMove, strengths, handover };
}

/** The build agent's view of the tour: which pages exist, and which did not open. */
export function tourForBrief(c: Pick<Consultation, "pages">): string[] {
  if (c.pages.length <= 1) return [];
  return c.pages.map(
    (p) =>
      `- ${p.path}${p.ok ? (p.title ? ` — “${p.title.slice(0, 80)}”` : "") : " — did not open (fix or remove the link)"}`,
  );
}
