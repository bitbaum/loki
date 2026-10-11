import { defineRouting } from "next-intl/routing";

/**
 * The languages this product speaks — the one list every other file reads.
 *
 * English is the source every translation is made from. German follows Swiss
 * spelling (ss, never ß); the parity test enforces it.
 */
export const locales = ["en", "de", "fr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** A route's `[locale]` segment as a Locale — English for anything unknown. */
export function toLocale(value: string): Locale {
  return (locales as readonly string[]).includes(value) ? (value as Locale) : defaultLocale;
}

/** Each language named in itself, as the switcher shows it. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  // "always", not "as-needed". With an unprefixed default language, next-intl
  // serves `/account` by REWRITING it to `/en/account`, and a standalone Next
  // server behind the box's HTTPS proxy performs that rewrite as a request to
  // https://localhost:<port> — every English page answered 500 in production
  // while /de and /fr worked (causius, 2026-10-11). A prefix on every language
  // means no rewrite exists to go wrong; `/` is a redirect.
  localePrefix: "always",
  localeDetection: true,
});
