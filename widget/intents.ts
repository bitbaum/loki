/**
 * What the visitor wants Loki to DO with what they pointed at.
 *
 * The widget began as a bug form, and a bug form has one answer: fix it. But
 * the most common thing a person means when they point at a piece of someone
 * else's product is neither "this is broken" nor "build me a feature" — it is
 * "I don't like how this works for me", and that has two honest answers:
 *
 *   build — change it: an agent reshapes the experience and ships it.
 *   guide — show me the way: the product may already do what they want and
 *           they could not find it. The answer is the path, and making that
 *           path findable from where they were standing.
 *
 * Both run the same loop (report → inbox → Implement → shipped), so this is a
 * routing hint on one row, not a second pipeline. The ingest vocabulary is
 * FEEDBACK_INTENT_VALUES in src/lib/constants/statuses.ts; this file may not
 * import from src/ (scripts/test/widget-self-contained.ts), so the values are
 * repeated here and scripts/test/widget-intents.ts fails if the two drift.
 *
 * DOM-free so tests can import it without a browser.
 */
export const WIDGET_INTENTS = ["build", "guide"] as const;
export type WidgetIntent = (typeof WIDGET_INTENTS)[number];

export const WIDGET_INTENT_META: Record<
  WidgetIntent,
  { label: string; heading: string; placeholder: string }
> = {
  build: {
    label: "Change it for me",
    heading: "What should change?",
    placeholder: "Say how you want it to work — Loki builds it.",
  },
  guide: {
    label: "Show me how",
    heading: "Where are you trying to get?",
    placeholder: "Say what you want to do — Loki shows you the way there.",
  },
};

export function defaultWidgetIntent(): WidgetIntent {
  return "build";
}

export function isWidgetIntent(value: unknown): value is WidgetIntent {
  return typeof value === "string" && (WIDGET_INTENTS as readonly string[]).includes(value);
}
