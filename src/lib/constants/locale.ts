import { envAlias } from "@/lib/brand-env";

/**
 * Locale used for date/time formatting throughout the app. English-Swiss: the
 * UI is entirely English, so de-CH rendered jarring German dates ("Freitag,
 * 19. Juni 2026") under an English greeting. en-CH anglicises the weekday and
 * month names while preserving Swiss numeric + currency conventions
 * (apostrophe thousands, "CHF 1’234.50"), so only the dates change. Override
 * with the LOCALE env var.
 *
 * Its own file, free of Node modules, so a client component can import it:
 * src/lib/constants.ts imports `os` and `path`, which a browser bundle cannot
 * resolve. A bundle with no `process` at all gets the default.
 */
export const APP_LOCALE =
  builtLocale() || (typeof process === "undefined" ? "en-CH" : envAlias("LOCALE", "en-CH"));

/**
 * The same setting as the browser sees it. APP_LOCALE is a server variable, so
 * a client component formatting a date got the default while the server used
 * the configured one: with APP_LOCALE=de-CH the server drew "Sa., 14. Nov."
 * and the browser "Sat, 14 Nov", and React threw the server markup away on
 * /approvals and anywhere else a client component prints a date.
 *
 * next.config.ts copies the setting into NEXT_PUBLIC_APP_LOCALE, and Next
 * replaces this exact expression with that string when it builds, for the
 * server and the browser alike. A bundle Next did not build has no `process`
 * to read: it lands in the catch and takes the default below, as before.
 */
function builtLocale(): string {
  try {
    return process.env.NEXT_PUBLIC_APP_LOCALE || "";
  } catch {
    return "";
  }
}
