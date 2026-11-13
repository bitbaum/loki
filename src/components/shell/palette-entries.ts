import { NAV_ITEMS, SIDEBAR_SECTIONS, type NavItem } from "@/config/navigation";
import { CATEGORY_META, PROMPT_TEMPLATES, type PromptTemplate } from "@/config/prompt-library";
import type { AgentPrompt } from "@/app/api/prompts/agent/route";
import { projectTitle } from "@/lib/project-display";
import { rankByQuery, searchHits, TEXT_SPEC, type Range, type SearchSpec } from "@/lib/search";

export type PaletteEntry =
  | { kind: "agent-prompt"; key: string; label: string; sub: string; icon: string; href: string }
  | { kind: "prompt-template"; key: string; label: string; sub: string; icon: null; href: string }
  | { kind: "nav"; key: string; label: string; sub: string; icon: null; href: string }
  | { kind: "project"; key: string; label: string; sub: string; icon: null; href: string }
  // Composer (Loki Phase 1): hand typed words to an agent as a task, and the
  // project picker shown when the command is project-ambiguous ("ask when
  // ambiguous"). Offered LAST and never on Enter by default: the box is
  // opened by a magnifier, and a search that started a build on Enter was a
  // build nobody meant (audit, 2026-11-12).
  | { kind: "run-command"; key: string; label: string; sub: string; icon: null; href: null }
  | {
      kind: "pick-project";
      key: string;
      label: string;
      sub: string;
      icon: null;
      href: null;
      projectName: string;
    };

/** A row as the palette shows it: the entry, plus where the query landed in its label. */
export type PaletteRow = PaletteEntry & { labelMatches?: readonly Range[] };

export type UserProjectLite = {
  id: string;
  name: string;
  title?: string | null;
  description?: string | null;
  liveUrl?: string | null;
  isActive?: boolean;
};

export const PALETTE_RESULT_LIMIT = 60;

/** Pages in the order the sidebar shows them, then every other page (Cmd-K reaches them all). */
function navInSidebarOrder(): NavItem[] {
  const seen = new Set<string>();
  const ordered: NavItem[] = [];
  for (const item of [...SIDEBAR_SECTIONS.flatMap((s) => s.items), ...NAV_ITEMS]) {
    if (!item.active || seen.has(item.id)) continue;
    seen.add(item.id);
    ordered.push(item);
  }
  return ordered;
}

/** "https://www.xhiva.art/" → "xhiva.art"; null when the project has no site. */
function siteHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Everything the palette can offer, in its default order: the pages first, in
 * the sidebar's order, then the projects, then prompts.
 *
 * Pages lead because with nothing typed the list is a map of the app; the
 * projects (40-odd) used to come first and pushed every page past the row
 * limit, so Activity, Prompts or Settings never showed (audit, 2026-11-12).
 * A project row says what a person knows it by (its title, its site), not
 * the server folder it lives in. Switching a project's agent is not here:
 * it is done on the project's own screen, where the agent is visible.
 * The project href uses /control?focus=<tab>, which ControlPanel's
 * deep-link handler picks up.
 */
export function buildPaletteEntries(input: {
  agentPrompts: AgentPrompt[] | null | undefined;
  projects: UserProjectLite[] | null | undefined;
}): PaletteEntry[] {
  const agent = (input.agentPrompts ?? [])
    .filter((p) => p.style !== "internal")
    .map<PaletteEntry>((p) => ({
      kind: "agent-prompt",
      key: `agent:${p.key}`,
      label: p.label,
      sub: `Prompt · ${p.category}`,
      icon: p.icon,
      href: `/control?prompt=${encodeURIComponent(p.key)}`,
    }));
  const templates = PROMPT_TEMPLATES.map<PaletteEntry>((t: PromptTemplate) => ({
    kind: "prompt-template",
    key: `template:${t.id}`,
    label: t.name,
    sub: `Template · ${CATEGORY_META[t.category].label}`,
    icon: null,
    href: `/prompts?template=${encodeURIComponent(t.id)}`,
  }));
  const nav = navInSidebarOrder().map<PaletteEntry>((n: NavItem) => ({
    kind: "nav",
    key: `nav:${n.id}`,
    label: n.label,
    sub: `Page · ${n.description}`,
    icon: null,
    href: n.href,
  }));
  const active = (input.projects ?? []).filter((p) => p.isActive !== false && p.name);
  const projectEntries = active.map<PaletteEntry>((p) => {
    const host = siteHost(p.liveUrl);
    return {
      kind: "project",
      key: `project:${p.id}`,
      label: projectTitle(p),
      sub: host ? `Project · ${host}` : "Project",
      icon: null,
      href: `/control?focus=${encodeURIComponent(p.name)}`,
    };
  });
  return [...nav, ...projectEntries, ...agent, ...templates];
}

/**
 * The last tie-break once something is typed: between two equally good
 * matches, a project still beats a page ("Loki" the project, "Loki" the chat).
 */
const KIND_ORDER: readonly PaletteEntry["kind"][] = [
  "project",
  "nav",
  "agent-prompt",
  "prompt-template",
];

/** What the palette searches: the label first, then the line under it. */
export const PALETTE_SEARCH_SPEC: SearchSpec<PaletteEntry> = {
  fields: [
    { name: "label", get: (e) => e.label },
    { name: "sub", get: (e) => e.sub },
  ],
  rank: (e) => -KIND_ORDER.indexOf(e.kind),
};

/** The rows the palette shows for the current query and composer state. */
export function filterPaletteEntries(input: {
  entries: PaletteEntry[];
  query: string;
  recent: string[];
  /** Set while a resolved command is waiting for the operator to name a project. */
  pending: boolean;
  projectNames: string[];
}): PaletteRow[] {
  const { entries, query, recent, pending, projectNames } = input;
  const q = query.trim();

  // Project-picker mode: command resolved but project ambiguous — pick one.
  if (pending) {
    return rankByQuery(projectNames, TEXT_SPEC, q)
      .map<PaletteEntry>((name) => ({
        kind: "pick-project",
        key: `pick:${name}`,
        label: name,
        sub: "Run the command here",
        icon: null,
        href: null,
        projectName: name,
      }))
      .slice(0, PALETTE_RESULT_LIMIT);
  }

  if (!q) {
    // Default ordering: recents (in order) → pages → projects → prompts.
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const recentEntries = recent.map((k) => byKey.get(k)).filter(Boolean) as PaletteEntry[];
    const remaining = entries.filter((e) => !recent.includes(e.key));
    return [...recentEntries, ...remaining].slice(0, PALETTE_RESULT_LIMIT);
  }

  // One slip in a name still finds it ("lkoi" → Loki), best match first.
  const matches = searchHits(entries, PALETTE_SEARCH_SPEC, q)
    .slice(0, PALETTE_RESULT_LIMIT - 1)
    .map<PaletteRow>((hit) => ({ ...hit.item, labelMatches: hit.matches.label }));

  // The typed words can also be handed to an agent — offered last, after
  // everything they found, and worded as what it does.
  const askRow: PaletteRow = {
    kind: "run-command",
    key: "__run__",
    label: `Ask Loki to do: “${q}”`,
    sub: "Sends these words to an agent as a task",
    icon: null,
    href: null,
  };
  return [...matches, askRow];
}

/**
 * The row Enter opens. Enter is a search's key, so it opens the best match;
 * it never hands the words to an agent unless that row was chosen with the
 * arrow keys first (`chosen`).
 */
export function enterTarget(rows: PaletteRow[], index: number, chosen: boolean): PaletteRow | null {
  const row = rows[index];
  if (!row) return null;
  if (row.kind === "run-command" && !chosen) return null;
  return row;
}
