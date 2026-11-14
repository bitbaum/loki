/**
 * Every app on this server, every AI vendor, one picture.
 *
 * The owner's words, 2026-11-13: "I never know what is used up, what isn't,
 * what it was used up for, and when, and what is available to me. […] Is it
 * just one app, or is it all the apps? I want clarity." Two days earlier about
 * $567 had gone to Google and nobody could say which app spent it.
 *
 * `@bitbaum/ai-kit` writes one line per model call under AI_USAGE_DIR (the
 * app, the vendor, the model, what came of it; never content). This turns a
 * day of those lines into what a person can read: per vendor, is its key on
 * this server, did it answer today, when did it last refuse and why, and which
 * apps used it; per app, which vendors answered it.
 *
 * The rules the settings page already keeps (quota-view.ts):
 *  - "Could not look" is never "nothing happened". `events === null` is drawn
 *    as not readable, and a vendor with a key but no line today is "not called
 *    today", not "available" and not "empty".
 *  - A number says what it means for the next request, in a sentence.
 *
 * Pure: no I/O, no clock beyond `now`.
 */
import { summariseUsage, type UsageEvent, type UsageTally } from "@bitbaum/ai-kit";

/** A vendor this server may hold a platform key for. */
export interface FleetVendor {
  id: string;
  label: string;
  keyEnv: string;
  /** Bills per call. Shown so a paid vendor is never mistaken for a free one. */
  paid: boolean;
  /** Where the owner checks the bill or the limit at the vendor itself. */
  consoleUrl: string;
}

export const FLEET_VENDORS: readonly FleetVendor[] = [
  {
    id: "groq",
    label: "Groq",
    keyEnv: "GROQ_API_KEY",
    paid: false,
    consoleUrl: "https://console.groq.com/settings/limits",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    paid: false,
    consoleUrl: "https://openrouter.ai/activity",
  },
  {
    id: "google",
    label: "Google Gemini",
    keyEnv: "GEMINI_API_KEY",
    paid: true,
    consoleUrl: "https://console.cloud.google.com/billing",
  },
  {
    id: "xai",
    label: "xAI Grok",
    keyEnv: "XAI_API_KEY",
    paid: true,
    consoleUrl: "https://console.x.ai",
  },
];

export type VendorState = "answering" | "refusing" | "not-called" | "no-key";

export interface FleetAppRow {
  app: string;
  /** "12 answered · 3 refused" */
  line: string;
  answered: number;
}

export interface FleetVendorView {
  id: string;
  label: string;
  paid: boolean;
  keySet: boolean;
  state: VendorState;
  /** One word for the state, for the row's right edge. */
  stateLabel: string;
  /** What today looked like at this vendor. */
  line: string;
  /** The most recent trouble, in words; null when there was none. */
  problem: string | null;
  /** What that means for the next request, or what to do. */
  consequence: string;
  apps: FleetAppRow[];
  models: { model: string; line: string }[];
  consoleUrl: string;
}

export interface FleetAppView {
  app: string;
  line: string;
  vendors: { label: string; paid: boolean; line: string }[];
}

export interface FleetUsageView {
  /** False when the log could not be read at all. */
  readable: boolean;
  /** The one sentence at the top. */
  headline: string;
  /** What the picture covers and does not, stated once. */
  coverage: string;
  vendors: FleetVendorView[];
  apps: FleetAppView[];
  /** Calls made on people's own keys today; never counted against the server's vendors. */
  ownKeyLine: string | null;
}

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, word: string) => `${n(v)} ${word}${v === 1 ? "" : "s"}`;

/** "ORANGECAT" → "OrangeCat"-ish without a name table: lower-case, underscores to spaces. */
export function appLabel(id: string): string {
  const s = id.trim().toLowerCase().replace(/_/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unnamed app";
}

function ago(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Why a link did not answer, without a status code or a flag. */
export function problemWords(p: NonNullable<UsageTally["lastProblem"]>): string {
  if (p.outcome === "refused") {
    switch (p.reason) {
      case "paid-disabled":
      case "paid-not-opted-in":
        return "not called: it bills per call and paid AI is switched off for that app";
      case "app-cap":
        return "not called: that app's daily paid allowance is used up";
      case "fleet-cap":
        return "not called: the server's daily paid allowance is used up";
      case "xai-cap":
        return "not called: the daily xAI allowance is used up";
      case "free-cap":
        return "not called: that app made an unusual number of free calls today and was stopped";
      default:
        return "not called: a spending rule stopped it";
    }
  }
  if (p.kind === "daily") return "the vendor said today's free allowance is used up";
  if (p.kind === "rate" || p.status === 429) return "the vendor said too many requests at once";
  if (p.kind === "size") return "the request was too large for that model";
  if (p.status === 401 || p.status === 403) return "the vendor rejected the key";
  if (p.status === 404) return "the model no longer exists at the vendor";
  if (p.status !== undefined && p.status >= 500) return "the vendor had an error on its side";
  return "the call failed";
}

function tallyLine(t: UsageTally): string {
  const parts: string[] = [];
  if (t.served) parts.push(`${n(t.served)} answered`);
  if (t.failed) parts.push(`${n(t.failed)} failed`);
  if (t.refused) parts.push(`${n(t.refused)} not called`);
  return parts.length ? parts.join(" · ") : "no calls";
}

export function fleetUsageView(input: {
  /** Today's events (UTC day); null when the log could not be read. */
  events: readonly UsageEvent[] | null;
  /** Names of env keys that are set on this server (never values). */
  keysSet: ReadonlySet<string>;
  now: number;
}): FleetUsageView {
  const { events, keysSet, now } = input;
  const readable = events !== null;
  const summary = summariseUsage(events ?? []);
  const byId = new Map(summary.providers.map((p) => [p.provider, p]));

  const known = new Set(FLEET_VENDORS.map((v) => v.id));
  const extra: FleetVendor[] = summary.providers
    .filter((p) => !known.has(p.provider))
    .map((p) => ({ id: p.provider, label: p.provider, keyEnv: "", paid: p.paid, consoleUrl: "" }));

  const vendors: FleetVendorView[] = [...FLEET_VENDORS, ...extra]
    .map((v): FleetVendorView | null => {
      const used = byId.get(v.id);
      const keySet = v.keyEnv ? keysSet.has(v.keyEnv) : true;
      // A vendor with no key and no calls is not part of this server's picture.
      if (!keySet && !used) return null;
      const paid = v.paid || Boolean(used?.paid);

      const lastProblem = used?.lastProblem ?? null;
      const servedSince =
        !!used &&
        used.lastServedAt !== null &&
        (!lastProblem || used.lastServedAt > lastProblem.at);
      const state: VendorState = !used
        ? keySet
          ? "not-called"
          : "no-key"
        : servedSince
          ? "answering"
          : lastProblem
            ? "refusing"
            : "not-called";

      const problem = lastProblem
        ? `${problemWords(lastProblem)} (${ago(lastProblem.at, now)})`
        : null;

      let consequence: string;
      if (!keySet && used) {
        consequence =
          "Apps called it today, but this server no longer holds its key, so the next call will not be made.";
      } else if (paid && used && used.served > 0) {
        consequence = `This vendor bills per call. ${plural(used.served, "call")} were answered today; check the bill at the vendor.`;
      } else if (state === "refusing") {
        consequence = paid
          ? "Nothing is being spent here. Apps move on to the next vendor in their chain."
          : "Until it answers again, apps move on to the next vendor in their chain.";
      } else if (state === "not-called") {
        consequence = readable
          ? "No app has called it today, so there is no reading of what it has left."
          : "The log could not be read, so this says nothing about what it has left.";
      } else {
        consequence =
          "Answering. A free vendor does not publish what is left; the first refusal will show here.";
      }

      return {
        id: v.id,
        label: v.label,
        paid,
        keySet,
        state,
        stateLabel:
          state === "answering"
            ? "answering"
            : state === "refusing"
              ? "not answering"
              : state === "no-key"
                ? "no key"
                : "not called today",
        line: used ? tallyLine(used) : readable ? "No calls today" : "Not readable",
        problem,
        consequence,
        apps: (used?.apps ?? []).map((a) => ({
          app: appLabel(a.app),
          line: tallyLine(a),
          answered: a.served,
        })),
        models: (used?.models ?? [])
          .slice(0, 6)
          .map((m) => ({ model: m.model, line: tallyLine(m) })),
        consoleUrl: v.consoleUrl,
      };
    })
    .filter((v): v is FleetVendorView => v !== null);

  const labelOf = (id: string) => vendors.find((v) => v.id === id)?.label ?? id;
  const apps: FleetAppView[] = summary.apps.map((a) => ({
    app: appLabel(a.app),
    line: tallyLine(a),
    vendors: a.providers.map((p) => ({
      label: labelOf(p.provider),
      paid: p.paid,
      line: tallyLine(p),
    })),
  }));

  const paidAnswered = summary.providers
    .filter((p) => p.paid)
    .reduce((sum, p) => sum + p.served, 0);
  const refusing = vendors.filter((v) => v.state === "refusing" && !v.paid).map((v) => v.label);
  const answering = vendors.filter((v) => v.state === "answering").map((v) => v.label);

  let headline: string;
  if (!readable) {
    headline = "The usage log could not be read just now. This says nothing about what was used.";
  } else if (summary.total.served + summary.total.failed + summary.total.refused === 0) {
    headline = "No app has made an AI call through the shared package today.";
  } else {
    const who = `${plural(summary.apps.length, "app")} made ${plural(summary.total.served, "answered call")} today`;
    const paidPart =
      paidAnswered > 0
        ? ` ${plural(paidAnswered, "call")} went to a vendor that bills.`
        : " None went to a vendor that bills.";
    const state = refusing.length
      ? ` ${refusing.join(" and ")} ${refusing.length === 1 ? "is" : "are"} not answering right now${answering.length ? `; ${answering.join(" and ")} ${answering.length === 1 ? "is" : "are"}` : ""}.`
      : "";
    headline = `${who}.${paidPart}${state}`;
  }

  return {
    readable,
    headline,
    coverage:
      "Counted from each app's own calls since midnight UTC, on this server. An app shows up once it runs the shared AI package that writes this log; until then its calls are missing here, not zero.",
    vendors,
    apps,
    ownKeyLine: summary.ownKeyCalls
      ? `${plural(summary.ownKeyCalls, "call")} today used a person's own key. Those are billed to that person by their vendor and are not counted above.`
      : null,
  };
}
