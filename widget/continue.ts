/**
 * "Continue in Loki": carrying the panel's conversation into Loki itself.
 *
 * The panel is where a site's owner first says what they want — on their
 * phone, on the live page, in a 372px card. It is the wrong place to develop
 * the idea: no project context, no files, no run to watch. On 2026-10-09 the
 * owner wrote "Read the conversation and switch to Loki so I can develop it
 * there with either chat or terminal interface" and the widget answered with
 * the same advice a third time, because nothing in it knew what Loki was.
 *
 * Two pure pieces: the thread as one message Loki's chat can start from, and
 * the link that takes the person there. The link goes through Loki's server
 * (src/app/api/widget/continue/route.ts), which signs them in if needed,
 * checks they may work on this widget's project, resolves the project, and
 * lands them in /loki with this text in the composer — or in /terminal on the
 * project. The widget never learns the project's name; it only holds a token.
 */
import type { ThreadItem } from "./thread";

/** The composer in /loki takes 4000; the address bar should stay well under it. */
export const HANDOFF_MAX = 1800;
const LOKI_TURN_MAX = 280;

export type ContinueView = "chat" | "terminal";

function line(item: ThreadItem): string {
  const clip = (t: string) => (t.length > LOKI_TURN_MAX ? `${t.slice(0, LOKI_TURN_MAX - 1)}…` : t);
  switch (item.kind) {
    case "you":
      return `Me: ${item.text}`;
    case "loki":
      return `Loki: ${clip(item.text)}`;
    case "noticed":
      return `Loki noticed: ${clip(item.text)}`;
    default:
      return `Sent to the builder: ${item.text}`;
  }
}

/**
 * The thread as one message, newest turns kept when it has to be cut: the
 * person's own words in full, Loki's answers clipped, receipts as one line.
 * The page it happened on leads, so the chat knows which site this is about
 * before reading a word of it.
 */
export function handoffText(
  thread: readonly ThreadItem[],
  page: { title: string; url: string },
  max = HANDOFF_MAX,
): string {
  const head = `From Loki on “${page.title.trim() || page.url}” (${page.url}):`;
  const lines = thread.map(line);
  // Drop the oldest first: what they said last is what they want to go on with.
  while (lines.length && [head, "", ...lines].join("\n").length > max) lines.shift();
  if (!lines.length) return head.slice(0, max);
  return [head, "", ...lines].join("\n");
}

/**
 * The link into Loki. A top-level navigation (Loki's session cookie is
 * first-party there), never a fetch. `here` is where the person was, so that
 * someone who turns out not to own the site can be sent back to it with a
 * word rather than left on an error page.
 */
export function continueUrl(opts: {
  apiBase: string;
  token: string;
  view: ContinueView;
  text: string;
  here: string;
}): string {
  const u = new URL("/api/widget/continue", opts.apiBase);
  u.searchParams.set("token", opts.token);
  u.searchParams.set("view", opts.view);
  if (opts.view === "chat" && opts.text.trim())
    u.searchParams.set("q", opts.text.slice(0, HANDOFF_MAX));
  u.searchParams.set("return", opts.here.split("#")[0]);
  return u.href;
}
