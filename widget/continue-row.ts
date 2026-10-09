/**
 * The row under the composer that leads out of the card and into Loki.
 *
 * The panel is for saying what you want; developing it — with the project,
 * its files and a run to watch — is Loki's chat or terminal. The owner asked
 * for exactly this ("switch to Loki so I can develop it there with either
 * chat or terminal") and the widget had no answer. Now the thread travels
 * with them. Someone without a pass gets one link, because the same trip
 * signs them in and finds out whether the site is theirs.
 */
import { h } from "./dom";
import { continueUrl, handoffText } from "./continue";
import type { ThreadItem } from "./thread";

export function createContinueRow(opts: {
  apiBase: string;
  token: string;
  thread: () => readonly ThreadItem[];
  owner: () => boolean;
}) {
  const el = h("div", "continue");
  const label = h("span", "continue-label", "Continue in Loki");
  const chat = h("a", "continue-link", "Chat →");
  const term = h("a", "continue-link", "Terminal →");
  const mine = h("a", "continue-link", "This is my site — continue in Loki →");
  for (const a of [chat, term, mine]) {
    a.target = "_blank";
    a.rel = "noopener";
  }
  chat.title = "Loki's chat on this project, with this conversation in the message box";
  term.title = "The project's terminal in Loki";
  mine.title = "Sign in with Loki; this conversation goes with you";
  el.append(label, chat, term, mine);

  /** Re-aim the links at the thread as it is now, and show the right ones. */
  function sync() {
    const thread = opts.thread();
    const text = handoffText(thread, { title: document.title, url: location.href });
    for (const [a, view] of [
      [chat, "chat"],
      [term, "terminal"],
      [mine, "chat"],
    ] as const) {
      a.href = continueUrl({
        apiBase: opts.apiBase,
        token: opts.token,
        view,
        text,
        here: location.href,
      });
    }
    // The owner always has both doors. A visitor sees the one link once they
    // have said something worth taking along — on an empty thread it would
    // only be a second sign-in button.
    const owner = opts.owner();
    const said = thread.some((i) => i.kind === "you");
    label.style.display = owner ? "" : "none";
    chat.style.display = owner ? "" : "none";
    term.style.display = owner ? "" : "none";
    mine.style.display = !owner && said ? "" : "none";
    el.style.display = owner || said ? "" : "none";
  }

  return { el, sync };
}
