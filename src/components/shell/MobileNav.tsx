"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { MOBILE_NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { MobileNavSheet } from "@/components/shell/MobileNavSheet";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";

const KEYBOARD_OPEN_CLASS = "fc-keyboard-open";

export function MobileNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const onPrimaryTab = MOBILE_NAV_ITEMS.some((item) => isCurrentPath(pathname, item.href));
  const isMoreActive = !sheetOpen && !onPrimaryTab;

  // The tab bar steps aside while the soft keyboard is up. It is fixed to the
  // bottom of the layout viewport, which does not shrink for the keyboard, so
  // it used to float over whatever sat on top of the keys — on /terminal it
  // covered the Prompt box being typed into. Nobody navigates mid-sentence.
  const keyboardOpen = useKeyboardInset() > 0;
  useEffect(() => {
    document.body.classList.toggle(KEYBOARD_OPEN_CLASS, keyboardOpen);
    return () => document.body.classList.remove(KEYBOARD_OPEN_CLASS);
  }, [keyboardOpen]);

  return (
    <>
      {/* data-fc-place="hidden": while this bar is on screen (phones), Loki's
          own feedback launcher stays out of the way — reporting lives in the
          account menu. See AccountMenu's reportProblem. */}
      <nav className="ui-mobile-nav" aria-label="Primary" data-fc-place="hidden">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive = isCurrentPath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "ui-mobile-nav-item",
                isActive ? "ui-mobile-nav-item-active" : "ui-mobile-nav-item-idle",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            "ui-mobile-nav-item",
            isMoreActive || sheetOpen ? "ui-mobile-nav-item-active" : "ui-mobile-nav-item-idle",
          )}
          aria-expanded={sheetOpen}
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </nav>

      {sheetOpen && <MobileNavSheet pathname={pathname} onClose={() => setSheetOpen(false)} />}
    </>
  );
}
