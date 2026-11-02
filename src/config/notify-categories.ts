/**
 * The kinds of message Loki may send a person on Telegram — SSOT for the
 * gateway (lib/notify/deliver.ts) and for Settings → Notifications, where each
 * person turns each kind on or off for themselves.
 *
 * Every kind here is actionable by contract (lib/notify/policy.ts: no button,
 * no message). A kind exists so a person can say "not these", never so a
 * sender can say something without a button.
 */
export const NOTIFY_CATEGORIES = {
  decisions: {
    label: "Decisions waiting for you",
    note: "Approve or reject what Loki is about to do: a booking, tonight's plan, a build.",
    defaultOn: true,
    operatorOnly: false,
  },
  people: {
    label: "Messages from people",
    note: "A visitor's feedback on your site, a studio request, someone joining your list.",
    defaultOn: true,
    operatorOnly: false,
  },
  results: {
    label: "When work needs you",
    note: "A fix that failed to ship, a run that could not finish, a goal that stopped.",
    defaultOn: true,
    operatorOnly: false,
  },
  plans: {
    label: "Your day plan and summaries",
    note: "One morning plan, and the summaries you asked for. Each line has its link.",
    defaultOn: true,
    operatorOnly: false,
  },
  bots: {
    label: "Your other assistants",
    note: "Your Cat on OrangeCat, when it has something for you to do.",
    defaultOn: true,
    operatorOnly: false,
  },
  servers: {
    label: "When your servers need you",
    note: "Only what you can fix with one tap, or a sign someone is in your server.",
    defaultOn: true,
    operatorOnly: true,
  },
} as const;

export type NotifyCategory = keyof typeof NOTIFY_CATEGORIES;
export const NOTIFY_CATEGORY_IDS = Object.keys(NOTIFY_CATEGORIES) as [
  NotifyCategory,
  ...NotifyCategory[],
];

/** A person's choices: category → on/off. A missing key means the category's default. */
export type NotifyChoices = Partial<Record<NotifyCategory, boolean>>;

export function isCategoryOn(
  choices: NotifyChoices | null | undefined,
  c: NotifyCategory,
): boolean {
  return choices?.[c] ?? NOTIFY_CATEGORIES[c].defaultOn;
}

/** The categories a person is shown in Settings. */
export function categoriesFor(operator: boolean): NotifyCategory[] {
  return NOTIFY_CATEGORY_IDS.filter((c) => operator || !NOTIFY_CATEGORIES[c].operatorOnly);
}
