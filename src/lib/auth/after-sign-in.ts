/**
 * Go where sign-in was asked to lead. A page goes through the router; an API
 * route — the site widget's /api/widget/owner, which redirects back to the
 * person's own site — needs a real navigation, because the router would fetch
 * it as a page and never follow the redirect off Loki.
 */
export function goAfterSignIn(push: (href: string) => void, href: string): void {
  if (href.startsWith("/api/")) window.location.assign(href);
  else push(href);
}
