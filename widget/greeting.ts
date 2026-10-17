/**
 * What Loki says before anyone has said anything — one sentence per state,
 * and for the person who is not yet known as the owner, the door that makes
 * them one. That door used to live only behind "Watch" in the header, a
 * feature about watching, which is not where somebody who wants their site
 * changed goes looking. Found by the owner on 2026-10-09 only after three
 * answers written for a stranger.
 */
import { h } from "./dom";
import { ownerSignInUrl } from "./owner-pass";
import type { Assistant } from "./thread";
import { pressVerb } from "./press";

export function greetingFor(state: {
  assistant: Assistant;
  owner: boolean;
  watching: boolean;
}): string {
  if (state.owner) {
    return state.watching
      ? `I'm watching as you use your site. Use it as usual and tell me what you'd change — ${pressVerb().verb} Point to area to show me one thing, or Voice note to talk while you scroll.`
      : `Paused — nothing is recorded. Resume above, ${pressVerb().verb} Point to area to show me something, or just tell me what to change.`;
  }
  if (state.assistant === "none") {
    return "Tell us what should change — it goes straight to whoever builds this site.";
  }
  return "Ask about this site or tell me what you would change. Chat first, or save a note for its builder.";
}

/** The owner's door, under the greeting: a round trip through Loki's sign-in
 *  that lands back on this page with the pass and Watch on — and one line
 *  saying who it is for and what happens without an account, because
 *  "sign in" alone left the owner asking exactly that (2026-10-16). */
export function ownerDoor(apiBase: string, token: string): HTMLElement {
  const wrap = h("div", "door-wrap");
  const mine = h("a", "door", "I own or build this site — sign in with Loki →");
  mine.href = ownerSignInUrl(apiBase, token, location.href);
  mine.rel = "noopener";
  mine.title = "Then what you say here is built, and this conversation can continue in Loki";
  wrap.append(
    mine,
    h(
      "span",
      "door-sub",
      "For the owner and the Builders they invited: then what you ask for here is built right away, and you are brought back to this page. No account? You make one on the way.",
    ),
  );
  return wrap;
}
