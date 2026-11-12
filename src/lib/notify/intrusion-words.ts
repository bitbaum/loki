/**
 * An intrusion sign from the box, said the way the owner would say it.
 *
 * The box writes one shell line per sign ("☠️ SUSPICIOUS PROCESS: pid 951241
 * running /tmp/…/esbuild. Kill it: sudo kill -9 951241") and boxNotice
 * (lib/notify/box.ts) turned it into "bitbaum: ☠️ SUSPICIOUS PROCESS" with
 * the rest as the body — process ids, shell commands and addresses as the
 * bell's titles, which the owner cannot read or act on (audit, 2026-11-12).
 *
 * Pure (no Node), so the bell can read rows recorded before this file existed
 * the same way boxNotice now records new ones. The raw line is kept after a
 * blank line: the technical record, shown only behind "Details".
 */

/** Who to name: the box's own name, so two machines can never read alike. */
export const BOX_NAME = "bitbaum";

const KINDS: { test: RegExp; title: string }[] = [
  { test: /SSH PASSWORD LOGIN/, title: `Someone signed in to ${BOX_NAME} with a password` },
  { test: /SSH LOGIN/, title: `Someone signed in to ${BOX_NAME}` },
  { test: /^☠️|SUSPICIOUS PROCESS/, title: `An unexpected program ran on ${BOX_NAME}` },
  { test: /SSHD/, title: `${cap(BOX_NAME)}'s sign-in settings changed` },
  { test: /FIREWALL/, title: `${cap(BOX_NAME)}'s firewall changed` },
  { test: /NEW PRIVILEGED/, title: `A new admin account appeared on ${BOX_NAME}` },
  { test: /SENSITIVE FILE/, title: `A protected file on ${BOX_NAME} changed` },
];

/** What the person can do about it, in one sentence. */
export const INTRUSION_SUMMARY =
  "If this was not you or one of your agents, ask Loki to look into it.";

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The plain title for an intrusion line, or null for a line that is not one we know. */
export function intrusionTitle(line: string): string | null {
  const t = line.trim();
  return KINDS.find((k) => k.test.test(t))?.title ?? null;
}

/** The notice body: the sentence, a blank line, then the raw line (Details). */
export function intrusionBody(line: string): string {
  return `${INTRUSION_SUMMARY}\n\n${line.trim()}`;
}

/** The prefix boxNotice put on intrusion titles before this file. */
const LEGACY_PREFIX = `${BOX_NAME}: `;

/**
 * How the bell names a row. A row boxNotice recorded the old way ("bitbaum:
 * ☠️ SUSPICIOUS PROCESS" + the rest of the line) reads like a new one;
 * every other row is returned as it was stored.
 */
export function bellWords(alert: { title: string; description: string | null }): {
  title: string;
  /** The description, unchanged unless this was a legacy intrusion row. */
  description: string | null;
} {
  if (!alert.title.startsWith(LEGACY_PREFIX)) return alert;
  const head = alert.title.slice(LEGACY_PREFIX.length);
  const line = alert.description ? `${head}: ${alert.description}` : head;
  const title = intrusionTitle(line);
  if (!title) return alert;
  return { title, description: intrusionBody(line) };
}
