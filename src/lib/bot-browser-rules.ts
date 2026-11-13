/**
 * The rules of a bot's own browser, as pure functions: what an action may be,
 * what a bot is never allowed to type into, and which session gives way when
 * the box is full. The browser itself is lib/bot-browser; this file has no
 * browser in it, so the rules are tested without one.
 *
 * Cat Bot's computer use (OrangeCat docs/PARITY.md, plan step 2).
 */
import { z } from "zod";

/** A browser is a few hundred megabytes on the app box: few at once, closed when idle. */
export const BOT_BROWSER_MAX_SESSIONS = 2;
export const BOT_BROWSER_IDLE_MS = 3 * 60_000;
export const BOT_BROWSER_MAX_LIFE_MS = 20 * 60_000;
/** A session used this recently is somebody mid-task; it is not closed for another. */
export const BOT_BROWSER_BUSY_MS = 30_000;
export const BOT_BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;
/** What a model reads of the page: enough to act on, short enough for any model. */
export const BOT_BROWSER_TEXT_MAX = 2_000;
export const BOT_BROWSER_ELEMENTS_MAX = 40;

const KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "ArrowDown",
  "ArrowUp",
  "PageDown",
  "PageUp",
] as const;

/** One step a bot takes in its browser. `n` is an element's number from the last look. */
export const BotBrowserAction = z.discriminatedUnion("do", [
  z.object({ do: z.literal("open"), url: z.string().trim().min(1).max(2000) }).strict(),
  z
    .object({
      do: z.literal("click"),
      n: z.number().int().min(1).max(500).optional(),
      label: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal("type"),
      text: z.string().max(2000),
      n: z.number().int().min(1).max(500).optional(),
      submit: z.boolean().optional(),
    })
    .strict(),
  z.object({ do: z.literal("press"), key: z.enum(KEYS) }).strict(),
  z.object({ do: z.literal("scroll"), by: z.enum(["down", "up"]) }).strict(),
  z.object({ do: z.literal("back") }).strict(),
  z.object({ do: z.literal("look") }).strict(),
  z.object({ do: z.literal("close") }).strict(),
]);
export type BotBrowserAction = z.infer<typeof BotBrowserAction>;

/** A web address a bot may open, or why not. */
export function openableUrl(raw: string): { ok: true; url: string } | { ok: false; why: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, why: `"${raw.trim().slice(0, 80)}" is not a full address (https://…).` };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, why: "Only web pages can be opened." };
  }
  return { ok: true, url: u.toString() };
}

/** What the browser knows about the field a bot is about to type into. */
export type FieldFacts = { type: string; autocomplete: string; name: string };

/**
 * A bot never types a password or a card on its own: the step stops and the
 * owner is asked. Returns the sentence to say, or null when typing is fine.
 */
export function refusalForField(field: FieldFacts | null): string | null {
  if (!field) return null;
  const type = field.type.toLowerCase();
  const auto = field.autocomplete.toLowerCase();
  const name = field.name.toLowerCase();
  if (type === "password" || auto.includes("password") || auto === "one-time-code") {
    return "This field takes a password or a sign-in code. A bot does not type those: the owner signs in themselves. Stopped here; nothing was typed.";
  }
  if (auto.startsWith("cc-") || /card.?number|cvc|cvv|iban/.test(name)) {
    return "This field takes payment details. A bot does not type those: the owner pays themselves. Stopped here; nothing was typed.";
  }
  return null;
}

export type SessionAge = { key: string; lastUsedAt: number; openedAt: number };

/**
 * Which sessions are over: idle too long, or open too long. And, when a new
 * one is wanted and the box is full, which one gives way — the least recently
 * used that nobody is in the middle of — or none (the caller says "busy").
 */
export function sessionsToClose(sessions: readonly SessionAge[], now: number): string[] {
  return sessions
    .filter(
      (s) =>
        now - s.lastUsedAt >= BOT_BROWSER_IDLE_MS || now - s.openedAt >= BOT_BROWSER_MAX_LIFE_MS,
    )
    .map((s) => s.key);
}

export function sessionToEvict(sessions: readonly SessionAge[], now: number): string | null {
  if (sessions.length < BOT_BROWSER_MAX_SESSIONS) return null;
  const idle = sessions
    .filter((s) => now - s.lastUsedAt >= BOT_BROWSER_BUSY_MS)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  return idle[0]?.key ?? null;
}
