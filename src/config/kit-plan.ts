/**
 * Which fleet package a new site should be BUILT FROM, by what its brief asks
 * for — the one table the kickoff's "Built from" plan reads
 * (src/lib/kit-plan/plan.ts).
 *
 * WHY: a kickoff agent briefed only on the project writes every feature from
 * scratch — a search box, a booking picker, a mail sender — although the fleet
 * already ships each one as a package. The fleet brief lists the packages; this
 * table says WHICH of them a given site needs, so the first build wires them
 * instead of re-deriving them: fewer tokens, the same feature everywhere, and
 * updates that reach every site at once.
 *
 * KEYED BY THE CATALOGUE'S PACKAGE NAME (bitbaum/fleet registers/packages.json).
 * The plan only ever offers a package the live catalogue still lists, so a
 * package fleet retires drops out on its own; a package fleet adds is one entry
 * here. scripts/test/kit-plan.ts fails on a key the catalogue snapshot does not
 * know, so a typo cannot silently plan nothing.
 *
 * Triggers are plain words and short phrases, lowercase, with no accents (the
 * brief is folded the same way before matching). They match whole words, an
 * optional plural "s" included, and a trigger just after "no", "without" or
 * "not" does not count ("no payments" plans no payments). Prefer a phrase to a
 * bare word that also means something else: "user accounts", never "account"
 * ("take into account").
 *
 * `plain` is what the person reads on the kickoff screen, so it is a word they
 * would use, never the package name. `use` and `avoid` are what the agent reads.
 */

export type KitFeature = {
  /** The feature in the owner's words — "search", "payments". */
  plain: string;
  /** What the agent wires the package into. */
  use: string;
  /** Completes "Do not write your own …". */
  avoid: string;
  /** Words or phrases in the brief that call for it. */
  triggers: readonly string[];
};

/** Order is the order the plan lists them in, prompt and screen alike. */
export const KIT_FEATURES: Readonly<Record<string, KitFeature>> = {
  "@bitbaum/accountkit": {
    plain: "sign-in",
    use: "the account menu (who is signed in, sign out) on top of the starter's own sign-in",
    avoid: "account menu or sign-in flow",
    triggers: [
      "sign in",
      "sign-in",
      "signin",
      "log in",
      "login",
      "user account",
      "customer account",
      "member account",
      "my account",
      "create an account",
      "member area",
      "members only",
      "member profile",
      "anmelden",
      "konto",
    ],
  },
  "@bitbaum/searchkit": {
    plain: "search",
    use: "the search box and its results (typos, prefixes, spellings without umlauts)",
    avoid: "search or fuzzy matching",
    triggers: ["search", "searchable", "look up", "lookup", "suche", "suchen", "recherche"],
  },
  listkit: {
    plain: "browsable lists",
    use: "every list people browse: filters, sort order and paging, kept in the URL",
    avoid: "filter, sort or paging logic",
    triggers: [
      "catalogue",
      "catalog",
      "listing",
      "directory",
      "filter",
      "sort by",
      "browse",
      "product",
      "inventory",
      "online shop",
      "shop",
    ],
  },
  "@bitbaum/paykit": {
    plain: "payments",
    use: "getting paid without holding the money (Bitcoin, Twint, a code the visitor pays in their own app)",
    avoid: "payment handling",
    triggers: [
      "pay",
      "payment",
      "checkout",
      "buy online",
      "order online",
      "online order",
      "sell online",
      "ticket",
      "twint",
      "bitcoin",
      "lightning",
      "deposit",
    ],
  },
  "@bitbaum/whenkit": {
    plain: "date picking",
    use: "every date and time a person picks: bookings, appointments, pick-up times",
    avoid: "date or time inputs",
    triggers: [
      "book a",
      "book an",
      "book online",
      "booking",
      "appointment",
      "reservation",
      "reserve",
      "schedule",
      "calendar",
      "opening hours",
      "event",
      "pick-up",
      "pickup",
      "delivery date",
      "termin",
      "buchung",
    ],
  },
  "@bitbaum/mail-kit": {
    plain: "email",
    use: "every email the site sends: confirmations, the contact form, sign-in links",
    avoid: "email sending",
    triggers: [
      "email",
      "e-mail",
      "mail",
      "newsletter",
      "confirmation",
      "contact form",
      "notify",
      "notification",
      "receipt",
    ],
  },
  "@bitbaum/chatkit": {
    plain: "chat",
    use: "the chat screen: composer with a microphone, the thread, copy and retry, streamed replies",
    avoid: "chat screen",
    triggers: ["chat", "live chat", "chatbot", "ai assistant", "virtual assistant"],
  },
  threadkit: {
    plain: "discussions",
    use: "threads between people: who may read them, unread per person",
    avoid: "message threads or their permissions",
    triggers: [
      "forum",
      "discussion",
      "thread",
      "message board",
      "messaging",
      "direct message",
      "private message",
      "group chat",
      "comment",
    ],
  },
  "@bitbaum/ai-kit": {
    plain: "AI answers",
    use: "every model call (the starter already routes /api/ai through it)",
    avoid: "model call — no vendor AI SDK and no hand-rolled model fetch",
    triggers: [
      "ai",
      "artificial intelligence",
      "chatbot",
      "ai assistant",
      "virtual assistant",
      "generate",
      "summarise",
      "summarize",
      "summary",
      "recommendation",
      "llm",
      "gpt",
      "translate",
    ],
  },
  "ai-forms": {
    plain: "smart forms",
    use: "every form: filled from a sentence, then changed by talking to it",
    avoid: "AI form filling",
    triggers: [
      "form",
      "questionnaire",
      "survey",
      "intake",
      "enquiry",
      "inquiry",
      "request a quote",
      "quote request",
    ],
  },
  limitkit: {
    plain: "spam protection",
    use: "rate limits on every public form and every route that sends mail or calls a model",
    avoid: "rate limiter",
    triggers: ["rate limit", "spam", "abuse", "bots", "contact form", "sign up", "sign-up"],
  },
  "@bitbaum/geo-kit": {
    plain: "maps",
    use: "regions and boundaries on a map, versioned and sourced",
    avoid: "copy of a geography database",
    triggers: [
      "map",
      "region",
      "canton",
      "municipality",
      "boundaries",
      "geography",
      "service area",
      "delivery area",
      "near me",
      "nearby",
    ],
  },
  "bip-kit": {
    plain: "news pages",
    use: "blog, roadmap and changelog pages written in markdown",
    avoid: "markdown blog renderer",
    triggers: ["blog", "news", "journal", "article", "changelog", "roadmap", "building in public"],
  },
  "@bitbaum/speechkit": {
    plain: "speaking feedback",
    use: "measuring how somebody spoke: pauses, rate, where they searched for a word",
    avoid: "speech analysis",
    triggers: ["pronunciation", "speaking practice", "fluency", "spoken", "speech"],
  },
};

/** The plan reaches a prompt in at most this many characters. */
export const KIT_PLAN_BLOCK_MAX_CHARS = 1_800;

/**
 * How long after the kickoff run closes before a read of the repository counts
 * as "what the first build installed". The fleet sweep merges a green pull
 * request within minutes; an hour lets the first build land on main before the
 * observation is frozen into the run's record.
 */
export const FIRST_BUILD_SETTLE_MS = 60 * 60_000;
