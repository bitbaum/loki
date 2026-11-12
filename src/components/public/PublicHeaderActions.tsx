import Link from "next/link";
import { auth } from "@/auth";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { PublicNavTrigger } from "@/components/public/PublicNav";
import { AccountMenu } from "@/components/shell/AccountMenu";

// Right-side nav content for marketing pages. Adapts to session — when signed
// in, surface a clear "Open {APP_NAME}" entry into the app (uses brand SSOT);
// when out, the usual sign-in / get-started pair. Theme cycle is the same
// THEME_OPTIONS SSOT as the app shell (Light / Dark / Auto). Server-rendered
// shell so it cannot be pulled into client bundles with the DB layer.
//
// It also mounts the phone nav drawer, because it is the one public header
// piece that can read the session: PublicSurface is imported by AuthShell,
// which client pages import, so the shell itself is bundled for the browser
// and cannot call auth().
export async function PublicHeaderActions({
  /** Auth pages pass false — the marketing drawer would crowd sign-in. */
  showMenu = true,
}: {
  showMenu?: boolean;
} = {}) {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* From 1120px the header has room for all of it (measured: the six
          entries, the theme control, "Sign in" and the button come to about
          1040px with the gutters). The switch was `xl` (1280px), so a laptop
          window between the two got a menu button beside 700px of empty bar
          and "Sign in" two presses away. */}
      {/* Theme cycle and "Sign in" move into the drawer below that width. Four
          controls (brand, menu, theme, CTA) do not fit a 390px header: the CTA
          was the one that lost, wrapping to two lines and clipping off the
          right edge. */}
      {/* Signed in, the theme moves into the account menu — the same place it
          lives inside the app — so the public header and the app header show
          one control for identity instead of two different answers. */}
      {!signedIn && (
        <span className="hidden min-[1120px]:block">
          <ThemeToggle />
        </span>
      )}
      {signedIn ? (
        <>
          {/* Desktop only. A phone header fits three controls (brand, one
              action, the drawer), and signed in the one action is now the
              avatar — who you are and how to sign out. "Open app" is not lost
              on a phone: the drawer below already leads with it. */}
          <span className="hidden min-[1120px]:block">
            <Link href={ROUTES.APP_HOME} className="ui-public-primary-action-compact">
              Open {APP_NAME} →
            </Link>
          </span>
          {/* The avatar menu the app already renders (AppTopBar), reused —
              not a second one. Signed in on a public page there was no way to
              see who you were or to sign out; both lived only inside the app. */}
          <AccountMenu />
        </>
      ) : (
        <>
          <Link
            href={ROUTES.SIGN_IN}
            className="ui-public-nav-link hidden min-[1120px]:inline-flex"
          >
            Sign in
          </Link>
          {/* "Start a project" everywhere it leads to sign-up: the hero, the
              rows and the menu said it four different ways on one page. */}
          <Link href={ROUTES.SIGN_UP} className="ui-public-primary-action-compact">
            Start a project
          </Link>
        </>
      )}
      {showMenu && <PublicNavTrigger signedIn={signedIn} />}
    </div>
  );
}
