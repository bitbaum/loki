import { AGENT_LABELS, type AnyAgentId } from "@/lib/agent-labels";
import { NAV_ITEMS, type NavItem } from "@/config/navigation";
import { PROMPT_TEMPLATES, type PromptTemplate } from "@/config/prompt-library";
import type { AgentPrompt } from "@/app/api/prompts/agent/route";

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
    sub: `Template · ${t.category}`,
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

/** The rows the palette shows for the current query and composer state. */
export function filterPaletteEntries(input: {
  entries: PaletteEntry[];
  query: string;
  recent: string[];
  /** Set while a resolved command is waiting for the operator to name a project. */
  pending: boolean;
  projectNames: string[];
}): PaletteEntry[] {
  const { entries, query, recent, pending, projectNames } = input;
  const q = query.trim().toLowerCase();

  // Project-picker mode: command resolved but project ambiguous — pick one.
  if (pending) {
    return projectNames
      .filter((name) => !q || name.toLowerCase().includes(q))
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

  // A free-text query is a candidate command — offer it as the top action,
  // above any matching navigate/prompt entries.
  const runRow: PaletteEntry[] = query.trim()
    ? [
        {
          kind: "run-command",
          key: "__run__",
          label: `Run: ${query.trim()}`,
          sub: "Resolve in natural language & dispatch",
          icon: null,
          href: null,
        },
      ]
    : [];

  if (!q) {
    // Default ordering: recents (in order) → nav → agent → templates.
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const recentEntries = recent.map((k) => byKey.get(k)).filter(Boolean) as PaletteEntry[];
    const remaining = entries.filter((e) => !recent.includes(e.key));
    return [...recentEntries, ...remaining].slice(0, PALETTE_RESULT_LIMIT);
  }

  const matches = entries
    .filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.sub.toLowerCase().includes(q) ||
        e.key.toLowerCase().includes(q),
    )
    .slice(0, PALETTE_RESULT_LIMIT - 1);
  return [...runRow, ...matches];
}
