import { ROUTES } from "@/config/auth";
import { clearFirstWords, firstWordsHref, readFirstWords } from "@/lib/first-words";

/**
 * Go where sign-in was asked to lead. A page goes through the router; an API
 * route — the site widget's /api/widget/owner, which redirects back to the
 * person's own site — needs a real navigation, because the router would fetch
 * it as a page and never follow the redirect off Loki.
 */
export function goAfterSignIn(push: (href: string) => void, href: string): void {
  if (href.startsWith("/api/")) {
    window.location.assign(href);
    return;
  }
  // Someone with an account who said what they want on the homepage and then
  // signed in: their sentence is waiting in the new-project form, not lost
  // behind the default screen. A new account is on its way to onboarding,
  // which hands the sentence over at its own end.
  if (href === ROUTES.APP_HOME) {
    const words = readFirstWords();
    if (words) {
      clearFirstWords();
      push(firstWordsHref(words));
      return;
    }
  }
  push(href);
}
