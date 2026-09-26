"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronDown, ChevronRight, Menu, X, ExternalLink } from "lucide-react";
import { PUBLIC_NAV, ROUTES, type PublicNavEntry } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import { BrandMark } from "@/components/shell/BrandMark";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

/**
 * Public marketing nav, in two exported halves so the phone header can order
 * its own row.
 *
 *   PublicNav        Desktop (md+) only — each PUBLIC_NAV entry, where a
 *                    "menu" becomes a hover/click mega-menu and a "link"
 *                    becomes a single nav link.
 *   PublicNavTrigger Below md — one menu button, rightmost in the header, and
 *                    the full-screen drawer it opens.
 *
 * PUBLIC_NAV is the SSOT — the architectural boundary that per-user content
 * (e.g. Thoughts) does not live here is enforced by editing that constant
 * alone.
 */
export function PublicNav() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="hidden items-center gap-1 xl:flex">
      {PUBLIC_NAV.map((entry) => {
        if (entry.kind === "menu") {
          return (
            <PublicNavDropdown
              key={entry.label}
              entry={entry}
              open={openMenu === entry.label}
              onOpen={() => setOpenMenu(entry.label)}
              onClose={() => setOpenMenu(null)}
            />
          );
        }
        if (entry.kind === "external") {
          return (
            <a
              key={entry.label}
              href={entry.href}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-public-nav-link inline-flex items-center gap-1"
              title={entry.description}
            >
              {entry.label}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          );
        }
        return (
          <Link key={entry.label} href={entry.href} className="ui-public-nav-link">
            {entry.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Phone/tablet menu button + drawer. Hidden from `md` up, where PublicNav's
 *  mega-menu is the navigation. */
export function PublicNavTrigger({ signedIn = false }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="ui-public-nav-toggle xl:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" />
      </button>
      {open && <PublicNavDrawer signedIn={signedIn} onClose={() => setOpen(false)} />}
    </>
  );
}

function PublicNavDropdown({
  entry,
  open,
  onOpen,
  onClose,
}: {
  entry: Extract<PublicNavEntry, { kind: "menu" }>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  return (
    <div ref={containerRef} className="relative" onMouseEnter={onOpen}>
      <button
        type="button"
        className="ui-public-nav-trigger"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <span>{entry.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="ui-public-nav-panel-wrap">
          <div className="ui-public-nav-panel" role="menu">
            {entry.sections.map((section) => (
              <section key={section.title} className="ui-public-nav-panel-section">
                <div className="ui-public-nav-panel-section-label">{section.title}</div>
                <div className="grid gap-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="ui-public-nav-panel-item"
                      role="menuitem"
                      onClick={onClose}
                    >
                      <span className="ui-public-nav-panel-item-label">{item.label}</span>
                      <span className="ui-public-nav-panel-item-desc">{item.description}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One drawer row. Chevron on internal links, external glyph on off-site ones —
 *  so a tap that leaves the site announces itself before it happens. */
function DrawerRow({
  label,
  description,
  href,
  external,
  onClose,
}: {
  label: string;
  description?: string;
  href: string;
  external?: boolean;
  onClose: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span className="ui-public-nav-panel-item-label">{label}</span>
        {description && <span className="ui-public-nav-panel-item-desc">{description}</span>}
      </span>
      {external ? (
        <ExternalLink className="ui-public-drawer-item-icon" aria-hidden />
      ) : (
        <ChevronRight className="ui-public-drawer-item-icon" aria-hidden />
      )}
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
        className="ui-public-drawer-item"
      >
        {body}
      </a>
    );
  }
  return (
    <Link href={href} onClick={onClose} className="ui-public-drawer-item">
      {body}
    </Link>
  );
}

function PublicNavDrawer({ signedIn, onClose }: { signedIn: boolean; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="ui-public-drawer" role="dialog" aria-modal="true" aria-label="Site navigation">
      <div className="ui-public-drawer-bar">
        <Link href="/" onClick={onClose} className="min-w-0 rounded-xl">
          <BrandMark responsive />
        </Link>
        <button
          type="button"
          className="ui-public-nav-toggle"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="ui-public-drawer-body">
        {/* Conversion first. Someone who opened this menu to sign up should not
            have to scroll past four sections of documentation links to do it. */}
        <div className="ui-public-drawer-actions">
          {signedIn ? (
            <Link href={ROUTES.APP_HOME} onClick={onClose} className="ui-public-cta w-full">
              Open {APP_NAME}
            </Link>
          ) : (
            <>
              <Link href={ROUTES.SIGN_UP} onClick={onClose} className="ui-public-cta w-full">
                Get started — free
              </Link>
              <Link href={ROUTES.SIGN_IN} onClick={onClose} className="ui-public-cta-ghost w-full">
                Sign in
              </Link>
            </>
          )}
        </div>

        {PUBLIC_NAV.filter((e) => e.kind === "menu").map((entry) => (
          <section key={entry.label} className="ui-public-drawer-section">
            <div className="ui-public-drawer-section-label">{entry.label}</div>
            {entry.sections.map((section) => (
              <div key={section.title}>
                <div className="ui-public-drawer-subsection-label">{section.title}</div>
                {section.items.map((item) => (
                  <DrawerRow
                    key={item.href}
                    label={item.label}
                    description={item.description}
                    href={item.href}
                    onClose={onClose}
                  />
                ))}
              </div>
            ))}
          </section>
        ))}

        {/* Every top-level entry in ONE section. Rendered one-per-section they
            each inherited the 32px inter-section gap, so four single links
            spread over a screen and a half of mostly empty drawer. */}
        <section className="ui-public-drawer-section">
          <div className="ui-public-drawer-section-label">More</div>
          {PUBLIC_NAV.filter((e) => e.kind !== "menu").map((entry) => (
            <DrawerRow
              key={entry.label}
              label={entry.label}
              description={entry.kind === "external" ? entry.description : undefined}
              href={entry.href}
              external={entry.kind === "external"}
              onClose={onClose}
            />
          ))}
        </section>
      </div>

      {/* Appearance lives here rather than in the header: on a phone the theme
          cycle was competing for the same 40px the primary CTA needed. */}
      <div className="ui-public-drawer-footer">
        <span className="ui-public-meta">Appearance</span>
        <ThemeToggle />
      </div>
    </div>,
    document.body,
  );
}
