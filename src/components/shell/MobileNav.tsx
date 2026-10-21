"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { MOBILE_NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { MobileNavSheet } from "@/components/shell/MobileNavSheet";
import { useKeyboardOpen } from "@/hooks/use-keyboard-inset";

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
  const keyboardOpen = useKeyboardOpen();
  useEffect(() => {
    document.body.classList.toggle(KEYBOARD_OPEN_CLASS, keyboardOpen);
    return () => document.body.classList.remove(KEYBOARD_OPEN_CLASS);
  }, [keyboardOpen]);

  return (
    <>
      {/* data-fc-place="tab": the FALLBACK shape of the feedback launcher on a
          phone. On app pages the top bar draws the launcher itself
          (FeedbackLauncher, data-fc-place="host", which outranks this), so
          nothing floats over the content; when a page hides the top bar but
          keeps this bar, the slim edge tab comes back. It is never "hidden":
          this bar once carried that, and it took the launcher off every page.
          An open dialog still wins (widget/placement.ts). */}
      <nav className="ui-mobile-nav" aria-label="Primary" data-fc-place="tab">
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
          aria-label="More: everything else"
        >
          <Ellipsis className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      {sheetOpen && <MobileNavSheet pathname={pathname} onClose={() => setSheetOpen(false)} />}
    </>
  );
}
