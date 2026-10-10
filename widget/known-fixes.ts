/**
 * What Loki already did about a finding — the memory Watch lacked.
 *
 * A remark used to be forgotten the moment the tab closed: the next visit
 * noticed the same thing, offered "Fix this" again, and the owner who pressed
 * it commissioned the same work twice (2026-10-10). Now a remark carries its
 * signature as a key; "Fix this" files the key with the note; and the owner's
 * changes route answers, for every keyed row, where that fix is. This module
 * is the pure half: reading that answer, and deciding what a remark whose key
 * is known should do.
 *
 *   in flight (building, in line, on its way, needs you)  → say nothing;
 *                      Your changes already shows it, and a second card would
 *                      be the second commissioning this exists to prevent
 *   live               → say it only if it is back, and say that it is back
 *   closed             → say nothing; the owner decided
 *   unknown            → say it, with Fix this
 */
export type KnownFix = {
  key: string;
  id: string;
  at: string;
  label: string;
  tone: "neutral" | "accent" | "warning" | "positive";
  detail: string;
  live: boolean;
  settled: boolean;
  href: string | null;
};

/** The server's cap on a key (api/feedback FeedbackBody.noticeKey). */
export const NOTICE_KEY_MAX = 300;

export function parseKnown(body: unknown): KnownFix[] {
  const raw = (body as { known?: unknown })?.known;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((k) => (k ?? {}) as Partial<KnownFix>)
    .filter(
      (k) => typeof k.key === "string" && typeof k.id === "string" && typeof k.label === "string",
    )
    .map((k) => ({
      key: String(k.key).slice(0, NOTICE_KEY_MAX),
      id: k.id as string,
      at: typeof k.at === "string" ? k.at : "",
      label: String(k.label).slice(0, 40),
      tone: (["neutral", "accent", "warning", "positive"] as const).includes(
        k.tone as KnownFix["tone"],
      )
        ? (k.tone as KnownFix["tone"])
        : "neutral",
      detail: typeof k.detail === "string" ? k.detail.slice(0, 300) : "",
      live: k.live === true,
      settled: k.settled === true,
      href: typeof k.href === "string" && /^https?:\/\//.test(k.href) ? k.href : null,
    }));
}

/**
 * The row that answers for a key. Several can (a finding fixed, back, fixed
 * again): the OPEN one wins, else the newest — an old closed row must not
 * silence a finding whose later fix is live.
 */
export function knownFor(list: readonly KnownFix[], key: string): KnownFix | null {
  const matches = list.filter((k) => k.key === key);
  if (!matches.length) return null;
  return (
    matches.find((k) => !k.settled) ??
    [...matches].sort((a, b) => b.at.localeCompare(a.at))[0] ??
    null
  );
}

export type RemarkVerdict = "say" | "silent" | "again";

/** What a remark whose key is `known` should do — see the module note. */
export function remarkVerdict(known: KnownFix | null): RemarkVerdict {
  if (!known) return "say";
  if (!known.settled) return "silent";
  return known.live ? "again" : "silent";
}

/** "Fixed 3 Oct" / "Being fixed" — the status chip on a noticed card. */
export function knownLabel(k: KnownFix): string {
  if (k.live) return `Fixed${k.at ? ` ${shortDate(k.at)}` : ""}`;
  if (k.settled) return "Closed";
  return k.tone === "warning" ? "Needs you" : `Being fixed · ${k.label}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
