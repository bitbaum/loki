"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, MessageSquareWarning } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { AccountMenu as SharedAccountMenu, type AccountGroup } from "@bitbaum/accountkit";
import { ACCOUNT_NAV_ITEMS } from "@/config/navigation";
import { ROUTES } from "@/config/auth";
import { usePrivateZone } from "@/hooks/use-private-zone";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

/**
 * The account menu — identity and the actions that belong to it.
 *
 * The menu itself is @bitbaum/accountkit, the one account menu every product
 * shares. This file only adapts Loki to it: who is signed in (NextAuth), the
 * places that belong under "you" (ACCOUNT_NAV_ITEMS), the private-zone lock,
 * and the Appearance switch. Behaviour — 44px target, Escape from anywhere,
 * arrow keys, a photo with a fallback, a sign-out that says when it FAILED —
 * lives in the package and is fixed there, for every product at once.
 *
 * One rule changed by adopting it: Loki used to fall back to the email
 * local-part as the display name. The package never builds a name from an
 * email (OrangeCat's rule — it is how a pseudonymous account ended up
 * displaying a reconstructed real name), so a nameless account now reads as
 * "Account", with its email on the line below.
 *
 * ── The rule this menu keeps ────────────────────────────────────────────────
 * The sidebar is for NAVIGATION — places in the product. This menu is for
 * IDENTITY — who you are and what you can do about it. Nothing appears in
 * both. That split is what stopped the sidebar footer from slowly becoming a
 * second, worse settings page.
 */
type LokiWidgetApi = { report?: () => void };

/**
 * Open Loki's own feedback widget. On a phone its floating button is hidden
 * (the bottom nav carries data-fc-place="hidden": a fourth floating thing over
 * the page was clutter), so reporting a problem lives here instead — the
 * widget's API still opens its panel without a launcher. /support is the way
 * in when the widget is not loaded (no token on this instance).
 */
function reportProblem(fallback: () => void) {
  const api = (window as Window & { Loki?: LokiWidgetApi }).Loki;
  if (typeof api?.report === "function") api.report();
  else fallback();
}

export function AccountMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const { configured, unlocked, lock } = usePrivateZone();
  const user = session?.user;

  const groups: AccountGroup[] = [
    {
      id: "places",
      items: ACCOUNT_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return {
          id: item.id,
          label: item.label,
          href: item.href,
          icon: <Icon className="h-4 w-4" aria-hidden="true" />,
        };
      }),
    },
    {
      id: "privacy",
      items:
        configured && unlocked
          ? [
              {
                id: "lock",
                label: "Lock private zone",
                icon: <Lock className="h-4 w-4" aria-hidden="true" />,
                onSelect: () => lock(),
              },
            ]
          : [],
    },
    {
      id: "help",
      items: [
        {
          id: "report",
          label: "Report a problem",
          icon: <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />,
          onSelect: () => reportProblem(() => router.push("/support")),
        },
      ],
    },
  ];

  return (
    <SharedAccountMenu
      user={{ name: user?.name, email: user?.email, image: user?.image }}
      groups={groups}
      extra={
        <div className="flex min-h-11 items-center gap-3">
          <span>Appearance</span>
          <ThemeToggle showLabel className="ml-auto" />
        </div>
      }
      renderLink={(props) => <Link {...props} />}
      onSignOut={() => signOut({ callbackUrl: ROUTES.SIGN_IN })}
    />
  );
}
