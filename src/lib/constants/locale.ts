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
export const APP_LOCALE = typeof process === "undefined" ? "en-CH" : envAlias("LOCALE", "en-CH");
