/**
 * What Loki knows about how a site is BUILT — the part a page outline cannot
 * show. Pure: the route reads the records, this writes the lines the advisor
 * reads.
 *
 * WHY: the owner asked Loki on their own site "are we using our packages?"
 * twice and got the same advice about one textarea twice (2026-10-15). The
 * advisor saw the page and the project's name; it had no way to know what the
 * site is built from, so it could not answer, and repeated itself instead.
 * Loki has the answer — the package observations it reads from every
 * repository (lib/packages/sync.ts) and the kickoff's plan (user_projects.
 * kit_plan) — so the advisor gets it, along with the conventions every build
 * is held to.
 */
import { KIT_FEATURES } from "@/config/kit-plan";
import { renderBuildConventions } from "@/config/build-conventions";

export type WidgetBuildFacts = {
  /** The project has a repository (or a folder) Loki builds from. */
  hasRepository: boolean;
  /** Catalogue names the kickoff planned, in plan order. Empty when none was recorded. */
  planned: string[];
  /** Catalogue names (and versions) the last read of the repository found;
   *  null when the repository has never been read. */
  observed: Array<{ name: string; version: string | null }> | null;
  /** When that read happened. */
  readAt: Date | null;
};

/** Lines kept short: this rides on every question asked on the site. */
export const BUILD_FACTS_MAX = 2_000;

const day = (d: Date) => d.toISOString().slice(0, 10);

function described(name: string): string {
  const use = KIT_FEATURES[name]?.use;
  return use ? `${name} — ${use}` : name;
}

export function renderBuildFacts(facts: WidgetBuildFacts | null): string {
  const lines = [
    "How this site is built (Loki's own records — the page outline cannot show this):",
  ];
  if (!facts) {
    lines.push("- Loki has no record of how this site is built; say so if asked.");
  } else {
    lines.push(
      facts.hasRepository
        ? "- It has a repository Loki builds from."
        : "- It has no repository yet; Loki builds it directly.",
    );
    const seen = new Set((facts.observed ?? []).map((p) => p.name));
    if (facts.observed === null) {
      lines.push(
        "- Its code has not been read for the fleet's shared packages yet, so which ones it uses is not known — say exactly that if asked; never guess.",
      );
    } else if (!facts.observed.length) {
      lines.push(
        `- The last read of its code${facts.readAt ? ` (${day(facts.readAt)})` : ""} found none of the fleet's shared packages.`,
      );
    } else {
      lines.push(
        `- Shared packages its code uses${facts.readAt ? ` (read ${day(facts.readAt)})` : ""}:`,
        ...facts.observed.map(
          (p) => `  - ${described(p.name)}${p.version ? ` (version ${p.version})` : ""}`,
        ),
      );
    }
    const missing = facts.planned.filter((n) => !seen.has(n));
    if (facts.observed !== null && missing.length) {
      lines.push(
        `- Planned at the start but not found in its code: ${missing.map(described).join("; ")}.`,
      );
    } else if (facts.observed === null && facts.planned.length) {
      lines.push(`- Planned at the start: ${facts.planned.map(described).join("; ")}.`);
    }
  }
  lines.push("", renderBuildConventions());
  return lines.join("\n").slice(0, BUILD_FACTS_MAX);
}
