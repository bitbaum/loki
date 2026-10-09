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
      ? "Your site. I'm watching as you use it and I'll say here when something doesn't work. Tell me what to change and I'll build it."
      : "Your site. I'm not watching right now — tap Watch again above. You can still tell me what to change and I'll build it.";
  }
  if (state.assistant === "none") {
    return "Tell us what should change — it goes straight to whoever builds this site.";
  }
  return "Hi, I'm Loki. Ask me anything about this site, or tell me what should change — it goes straight to whoever builds it.";
}

/** The owner's door, under the greeting: a round trip through Loki's sign-in
 *  that lands back on this page with the pass and Watch on. */
export function ownerDoor(apiBase: string, token: string): HTMLAnchorElement {
  const mine = h("a", "door", "This is my site — sign in with Loki →");
  mine.href = ownerSignInUrl(apiBase, token, location.href);
  mine.rel = "noopener";
  mine.title = "Then what you say here is built, and this conversation can continue in Loki";
  return mine;
}
