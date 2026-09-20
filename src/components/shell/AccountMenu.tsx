"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { LogOut, Lock, User } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { ACCOUNT_NAV_ITEMS } from "@/config/navigation";
import { ROUTES } from "@/config/auth";
import { usePrivateZone } from "@/hooks/use-private-zone";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

/**
 * The account menu — identity and the actions that belong to it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Before this component there was no way to sign out from the header, and no
 * indication anywhere in the top bar of *who was signed in*. Sign out, the
 * private-zone lock and Settings all lived in the SIDEBAR FOOTER — which is
 * `hidden md:flex`, so on a phone the only route to any of them was the Menu
 * sheet, three taps from most pages. A grep for "avatar", "UserMenu" or
 * "ProfileMenu" across `components/shell/` returned nothing at all.
 *
 * Meanwhile the loudest control in the top bar was the theme toggle: it is the
 * only member of `ui-app-topbar-right` drawn with a border and a filled
 * background (`ui-theme-cycle-btn`) while everything beside it is a bare ghost
 * circle (`ui-topbar-btn`). A preference nobody changes twice a year outranked
 * every piece of live state on the page. It now lives inside this menu, which
 * is where a preference belongs.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The sidebar is for NAVIGATION — places in the product. This menu is for
 * IDENTITY — who you are and what you can do about it. Nothing appears in
 * both. That split is what stopped the sidebar footer from slowly becoming a
 * second, worse settings page.
 */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();
  const { configured, unlocked, lock } = usePrivateZone();

  const close = useCallback(() => setOpen(false), []);
  useEscapeToClose(close, !open);

  const user = session?.user;
  const name = user?.name?.trim() || user?.email?.split("@")[0] || "Account";
  const email = user?.email ?? null;

  // Initials from the display name; never from the email local-part alone,
  // which turns "butaeff" into "B" and tells the user nothing they didn't know.
  const initials =
    user?.name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        title={name}
      >
        {initials ? (
          <span aria-hidden="true">{initials}</span>
        ) : (
          <User className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {open && (
        <>
          {/* Same scrim shape NotificationsPill uses, so the two header
              dropdowns dismiss identically. */}
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div className="ui-account-panel" role="menu" aria-label="Account">
            <div className="ui-account-identity">
              <p className="ui-account-name">{name}</p>
              {email && <p className="ui-account-email">{email}</p>}
            </div>

            <div className="ui-account-group">
              {ACCOUNT_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={close}
                    className="ui-account-row"
                    role="menuitem"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="ui-account-group">
              <div className="ui-account-row-static">
                <span>Appearance</span>
                <ThemeToggle showLabel className="ml-auto" />
              </div>
            </div>

            <div className="ui-account-group">
              {configured && unlocked && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void lock();
                  }}
                  className="ui-account-row"
                  role="menuitem"
                >
                  <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Lock private zone</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  close();
                  void signOut({ callbackUrl: ROUTES.SIGN_IN });
                }}
                className="ui-account-row"
                role="menuitem"
              >
                <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
