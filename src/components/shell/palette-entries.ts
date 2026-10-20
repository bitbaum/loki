import { AGENT_LABELS, type AnyAgentId } from "@/lib/agent-labels";
import { NAV_ITEMS, type NavItem } from "@/config/navigation";
import { CATEGORY_META, PROMPT_TEMPLATES, type PromptTemplate } from "@/config/prompt-library";
import type { AgentPrompt } from "@/app/api/prompts/agent/route";
import { rankByQuery, searchHits, TEXT_SPEC, type Range, type SearchSpec } from "@/lib/search";

export type PaletteEntry =
  | { kind: "agent-prompt"; key: string; label: string; sub: string; icon: string; href: string }
  | { kind: "prompt-template"; key: string; label: string; sub: string; icon: null; href: string }
  | { kind: "nav"; key: string; label: string; sub: string; icon: null; href: string }
  | { kind: "project"; key: string; label: string; sub: string; icon: null; href: string }
  | { kind: "switch-agent"; key: string; label: string; sub: string; icon: null; href: string }
  // Composer (Loki Phase 1): run a natural-language command, and the project
  // picker shown when the command is project-ambiguous ("ask when ambiguous").
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
  dirPath?: string | null;
  isActive?: boolean;
};

export const SWITCHABLE_AGENT_IDS = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "grok",
] as const satisfies readonly AnyAgentId[];

export const PALETTE_RESULT_LIMIT = 60;

/**
 * Everything the palette can offer, in its default order.
 *
 * Projects come right after navigation because the most-common Cmd-K intent in
 * a fleet-management product is "jump to project X". The href uses
 * /control?focus=<tab>, which ControlPanel's deep-link handler picks up.
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
      sub: `Agent · ${p.category}`,
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
  const nav = NAV_ITEMS.filter((n) => n.active).map<PaletteEntry>((n: NavItem) => ({
    kind: "nav",
    key: `nav:${n.id}`,
    label: n.label,
    sub: `Go to · ${n.description}`,
    icon: null,
    href: n.href,
  }));
  const active = (input.projects ?? []).filter((p) => p.isActive !== false && p.name);
  const projectEntries = active.map<PaletteEntry>((p) => ({
    kind: "project",
    key: `project:${p.id}`,
    label: p.name,
    sub: `Project · ${p.dirPath ?? "no local path"}`,
    icon: null,
    href: `/control?focus=${encodeURIComponent(p.name)}`,
  }));
  const switchEntries = active
    .filter((p) => p.dirPath)
    .flatMap((p) =>
      SWITCHABLE_AGENT_IDS.map<PaletteEntry>((agentId) => ({
        kind: "switch-agent",
        key: `switch:${p.id}:${agentId}`,
        label: `Switch ${p.name} to ${AGENT_LABELS[agentId]}`,
        sub: `Agent · quits current CLI and launches ${AGENT_LABELS[agentId]}`,
        icon: null,
        href: `/control?focus=${encodeURIComponent(p.name)}&switchTo=${encodeURIComponent(agentId)}`,
      })),
    );
  return [...projectEntries, ...switchEntries, ...nav, ...agent, ...templates];
}

/**
 * The default order of kinds, kept as the last tie-break once something is
 * typed: between two equally good matches, a project still beats a Go-to row.
 */
const KIND_ORDER: readonly PaletteEntry["kind"][] = [
  "project",
  "switch-agent",
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
    // Default ordering: recents (in order) → nav → agent → templates.
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const recentEntries = recent.map((k) => byKey.get(k)).filter(Boolean) as PaletteEntry[];
    const remaining = entries.filter((e) => !recent.includes(e.key));
    return [...recentEntries, ...remaining].slice(0, PALETTE_RESULT_LIMIT);
  }

  // A free-text query is a candidate command — offer it as the top action,
  // above any matching navigate/prompt entries.
  const runRow: PaletteRow = {
    kind: "run-command",
    key: "__run__",
    label: `Run: ${q}`,
    sub: "Resolve in natural language & dispatch",
    icon: null,
    href: null,
  };

  // One slip in a name still finds it ("lkoi" → Loki), best match first.
  const matches = searchHits(entries, PALETTE_SEARCH_SPEC, q)
    .slice(0, PALETTE_RESULT_LIMIT - 1)
    .map<PaletteRow>((hit) => ({ ...hit.item, labelMatches: hit.matches.label }));
  return [runRow, ...matches];
}
