// Pure: no fetch, no database — the suggestion ranker's tests import it.

/**
 * Can an agent build what this need asks for?
 *
 * The feed is OrangeCat's public wishlists, and on 2026-10-17 all of it was
 * gifts — "My Birthday Wishlist", "Art Supplies Wishlist" — ranked on Loki's
 * suggestion row as "Someone needs: My Birthday Wishlist", a thing to build.
 * A wishlist is something to buy for a person unless it asks for software.
 * Other kinds of need pass: they were posted as work.
 */
const SOFTWARE_WORDS =
  /\b(app|apps|website|web ?site|site|web page|landing page|tool|software|code|bot|plugin|script|api|dashboard|automation|integration)\b/i;

export function isBuildableNeed(need: { title: string; text: string; url: string }): boolean {
  const path = need.url.replace(/^https?:\/\/[^/]+/, "");
  if (!/^\/?wishlists\//.test(path)) return true;
  return SOFTWARE_WORDS.test(`${need.title} ${need.text}`);
}
