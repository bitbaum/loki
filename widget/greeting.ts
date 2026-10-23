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

export function greetingFor(state: {
  assistant: Assistant;
  owner: boolean;
  watching: boolean;
}): string {
  if (state.owner) {
    return state.watching
      ? "I'm watching while you use your site. Tell me what you'd change."
      : "Paused — nothing is recorded. Resume above, or just tell me what to change.";
  }
  if (state.assistant === "none") {
    return "Tell us what should change — it goes straight to whoever builds this site.";
  }
  return "Ask about this site, or tell me what you'd change for whoever builds it.";
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
      "Then what you ask for here gets built, and you come back to this page. No account? You make one on the way.",
    ),
  );
  return wrap;
}
