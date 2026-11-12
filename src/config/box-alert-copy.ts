import { ALERT_SEVERITY } from "@/lib/constants/statuses";

/**
 * What a box alarm says to the owner — SSOT for the plain words on /system.
 *
 * The box's monitors (scripts/hetzner/*) write one shell line per finding,
 * and lib/notify/box.ts records it as an alert: the part before the first
 * colon became the title, the rest the description. So /system read like a
 * terminal — "🧟 STRANDED agent work in loki-wt-scope — unpushed fc/1840a4dd-…",
 * "🐳 NEW CONTAINER … docker stop <name>", "♻️ REBOOT PENDING … sudo reboot" —
 * with nothing to tap but Dismiss (audit, 2026-11-12). The owner is not the
 * one who runs those commands; an agent is.
 *
 * Applied when the alarm is DRAWN, not when it is stored: the rows already
 * open read plainly too, and the stored line stays the technical record. Each
 * known kind gets a title a person understands, one sentence, and one action
 * that hands the fix to Loki with the original line attached. The raw line
 * sits after a blank line, so the list shows it only behind "Details"
 * (AlertList's splitDescription).
 *
 * The notice itself keeps no buttons (lib/notify/box.ts): a box line with a
 * button would count as actionable and reach the phone, which only an
 * intrusion may.
 */

/** A box alert as stored: title before the line's first colon, the rest as description. */
export type BoxAlertInput = { title: string; description: string | null };

export type PlainBoxAlert = {
  /** One row per thing to fix: rows sharing a kind collapse into the newest. */
  kind: string;
  title: string;
  /** Summary, a blank line, then the raw line (shown only behind "Details"). */
  description: string;
  actionLabel: string;
  actionUrl: string;
};

/** Composer pre-filled with the ask; the person reads it and sends it. */
export function askLokiHref(prompt: string): string {
  return `/loki?${new URLSearchParams({ q: prompt }).toString()}`;
}

/** Leading emoji and variation selectors the box puts before every line. */
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}\u{200D}\s]+/u;

export function stripLeadingEmoji(text: string): string {
  return text.replace(LEADING_EMOJI, "").trim();
}

/** A worktree's directory name ("loki-wt-scope") names its repository ("loki"). */
function repoName(dir: string): string {
  return dir.replace(/-wt-[\w-]+$/, "");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "gemini" → "Gemini"; "openai" → "OpenAI". */
function providerName(raw: string): string {
  const p = raw.trim().toLowerCase();
  if (p === "openai") return "OpenAI";
  if (p === "openrouter") return "OpenRouter";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

type Rule = {
  test: RegExp;
  build: (
    m: RegExpMatchArray,
    line: string,
  ) => Omit<PlainBoxAlert, "description" | "actionUrl"> & {
    summary: string;
    prompt: string;
  };
};

const RULES: Rule[] = [
  {
    test: /STRANDED agent work in (\S+) — (.*)$/,
    build: (m, line) => {
      const repo = repoName(m[1]);
      const rest = m[2];
      const uncommitted = Number(/(\d+) uncommitted/.exec(rest)?.[1] ?? 0);
      const branches = /unpushed:?\s*(.*?)(?:\. It exists|$)/.exec(rest)?.[1] ?? "";
      const branchCount = branches ? branches.split(/,\s*/).filter(Boolean).length : 0;
      const parts = [
        uncommitted ? `${plural(uncommitted, "changed file", "changed files")} not saved` : null,
        branchCount ? `${plural(branchCount, "branch", "branches")} never sent to GitHub` : null,
      ].filter(Boolean);
      return {
        kind: `stranded:${repo}`,
        title: `Work in ${repo} was never saved to GitHub`,
        summary: `${parts.join(" and ") || "Agent work"}. It exists only on the server, so nobody can see it or build on it.`,
        actionLabel: "Ask Loki to save it",
        prompt: `Agent work in ${repo} on the server was never pushed to GitHub. Save what is worth keeping: commit it, push the branches and open pull requests; tell me what you dropped and why.\n\nThe server reported: ${line}`,
      };
    },
  },
  {
    test: /NEW CONTAINER:?\s*(\S+)\s+(\S+)/,
    build: (m, line) => ({
      kind: `container:${m[1]}`,
      title: `A new program started on the server: ${m[1]}`,
      summary:
        "If it did not come from a deploy, it should not be running. Loki can check where it came from and stop it if it does not belong.",
      actionLabel: "Ask Loki to check it",
      prompt: `A new container "${m[1]}" (${m[2].replace(/\.$/, "")}) appeared on the server. Find out what started it. If no deploy or app of ours needs it, stop it and tell me what you found.\n\nThe server reported: ${line}`,
    }),
  },
  {
    test: /(\d+) NEW CRITICAL DEPENDENCY ALERT\(S\):?\s*(.*)$/,
    build: (m, line) => {
      // "orangecat:bitcoinjs-lib" → "bitcoinjs-lib in orangecat"
      const where = (m[2].split(/\s\.\s|\. /)[0] ?? "")
        .split(/,\s*/)
        .map((pair) => pair.trim().replace(/^([^:\s]+):(\S+)$/, "$2 in $1"))
        .filter(Boolean)
        .join(", ");
      return {
        kind: "dependency",
        title: "A library your projects use has a serious security hole",
        summary: `${where ? `Affected: ${where}. ` : ""}Updating the library closes it.`,
        actionLabel: "Ask Loki to update it",
        prompt: `GitHub reported ${plural(Number(m[1]), "critical security alert", "critical security alerts")} for a dependency. Update the affected library, run the checks and open a pull request.\n\nThe server reported: ${line}`,
      };
    },
  },
  {
    test: /DISK GC could not free space — still (\d+)%/,
    build: (m, line) => ({
      kind: "disk",
      title: "The server's disk was nearly full",
      summary: `Loki's clean-up could not free enough space on its own (it was at ${m[1]}%). The disk reading under Server shows how full it is now.`,
      actionLabel: "Ask Loki to free space",
      prompt: `The server's disk reached ${m[1]}% and the automatic clean-up ran out of safe things to delete. Find what takes the space, remove what is safe to remove, and tell me whether the server needs a bigger disk.\n\nThe server reported: ${line}`,
    }),
  },
  {
    test: /REBOOT PENDING for (\d+) days?/,
    build: (m, line) => ({
      kind: "reboot",
      title: "The server needs a restart",
      summary: `A security update has waited ${plural(Number(m[1]), "day", "days")} for a restart. The apps come back on their own afterwards.`,
      actionLabel: "Ask Loki to restart it",
      prompt: `The server has a security update waiting for a reboot. Pick a quiet moment, restart it, and check that every app came back.\n\nThe server reported: ${line}`,
    }),
  },
  {
    test: /^(\S+): DEAD API KEY \S* ?(?:\([^)]*\))? ?in:? ([^.]*)\./,
    build: (m, line) => {
      const provider = providerName(m[1]);
      const apps = m[2].trim();
      return {
        kind: `key:${m[1].toLowerCase()}`,
        title: `The ${provider} key stopped working`,
        summary: `${apps || "Some apps"} can no longer use ${provider}. It needs a new key.`,
        actionLabel: "Ask Loki to replace the key",
        prompt: `The ${provider} API key is refused in: ${apps}. Help me replace it in each of those apps and restart them.\n\nThe server reported: ${line}`,
      };
    },
  },
];

/**
 * The box line as it arrived (title, then ": " and the description when there
 * was one) — what an agent needs, and what "Details" shows.
 */
function rawLine({ title, description }: BoxAlertInput): string {
  const body = description?.trim();
  return body ? `${title.trim()}: ${body}` : title.trim();
}

export function plainBoxAlert(alert: BoxAlertInput): PlainBoxAlert {
  const raw = rawLine(alert);
  const line = stripLeadingEmoji(raw);
  for (const rule of RULES) {
    const m = line.match(rule.test);
    if (!m) continue;
    const { summary, prompt, ...rest } = rule.build(m, line);
    return { ...rest, description: `${summary}\n\n${line}`, actionUrl: askLokiHref(prompt) };
  }
  // An unknown kind keeps its words, without the emoji (the dot shows severity).
  const title = stripLeadingEmoji(alert.title) || alert.title;
  return {
    kind: `other:${title.replace(/\d+(\.\d+)?%?/g, "#")}`,
    title,
    description: alert.description?.trim() ?? "",
    actionLabel: "Ask Loki about this",
    actionUrl: askLokiHref(
      `The server raised this alarm. Explain what it means in plain words and fix it if it needs fixing.\n\nThe server reported: ${line}`,
    ),
  };
}

/**
 * One row per thing to fix: alarms arrive newest first, so the first of each
 * kind wins. Two disk alarms ("still 93%", "still 91%") and the same branches
 * reported for two worktrees of one repository were two rows each.
 */
export function collapseByKind<T extends { plain: PlainBoxAlert }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.plain.kind)) return false;
    seen.add(row.plain.kind);
    return true;
  });
}

/** What the list needs of a stored alert, plus where it came from. */
type StoredAlert = {
  id: string;
  severity: string;
  title: string;
  description: string | null;
  actionUrl: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Box lines in the owner's words, one row per thing to fix. An intrusion
 * (urgent) keeps its own words and its button to the evidence; everything
 * that did not come from the box is drawn as it was stored.
 */
export function plainSystemAlerts<T extends StoredAlert>(
  rows: readonly T[],
): (Omit<T, "metadata"> & { actionLabel?: string })[] {
  const box = rows
    .filter((a) => a.metadata?.source === "box" && a.severity !== ALERT_SEVERITY.URGENT)
    .map((a) => ({ alert: a, plain: plainBoxAlert(a) }));
  const keep = new Set(collapseByKind(box).map((b) => b.alert.id));
  const plain = new Map(box.map((b) => [b.alert.id, b.plain]));
  return rows
    .filter((a) => !plain.has(a.id) || keep.has(a.id))
    .map((row) => {
      const { metadata: _metadata, ...a } = row;
      const p = plain.get(a.id);
      return p
        ? {
            ...a,
            title: p.title,
            description: p.description,
            actionUrl: p.actionUrl,
            actionLabel: p.actionLabel,
          }
        : a;
    });
}
