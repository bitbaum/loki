/**
 * Boot-time environment sanity check.
 *
 * The recurring failure mode in this app is SILENT config rot: a secret goes
 * missing or picks up a trailing "\n" (which once broke ALL email + the
 * private-zone PIN), or one half of a provider's key pair is set so the
 * provider quietly disappears (how the X OAuth saga started). None of these
 * crash anything — they just make auth/email stop working, discovered days
 * later by a user. This module converts that class of failure into a loud,
 * immediate signal: logged at boot (see instrumentation.ts) and surfaced in
 * /api/health so the post-deploy assertion can fail the deploy.
 *
 * It deliberately does NOT throw / refuse to boot — a crash-loop is its own
 * outage and is harder to diagnose remotely. The signal is "health says
 * degraded + debug_logs says why", which the deploy gate turns red on.
 */

import { envAlias } from "./brand-env";

export type EnvIssue = { level: "fatal" | "error" | "warn"; key: string; msg: string };

const SECRETS = [
  "AUTH_SECRET",
  "RESEND_API_KEY",
  "CRON_SECRET",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "X1_CONSUMER_SECRET",
  "DATABASE_URL",
] as const;

const PROVIDER_PAIRS: Array<[string, string, string]> = [
  ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GitHub login"],
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "Google login"],
  ["X1_CONSUMER_KEY", "X1_CONSUMER_SECRET", "X (OAuth 1.0a) login"],
  ["TELEGRAM_NOTIFY_BOT_TOKEN", "TELEGRAM_NOTIFY_BOT_USERNAME", "Telegram for every account"],
];

export function checkEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const isProd = process.env.NODE_ENV === "production";
  const val = (k: string) => process.env[k];
  const present = (k: string) => Boolean(val(k)?.trim());
  // For keys the app resolves through envAlias. Resolution must match the
  // CONSUMER, per key — a checker reading a different variable than the code
  // it guards can be wrong in both directions at once.
  const presentAliased = (k: string) => Boolean(envAlias(k)?.trim());

  // 1. Whitespace corruption — the literal "\n in a secret" incident. A value
  //    that differs from its trimmed form will silently mismatch downstream.
  for (const k of SECRETS) {
    const v = val(k);
    if (v != null && v !== v.trim()) {
      issues.push({
        level: "error",
        key: k,
        msg: "has leading/trailing whitespace (likely \\n corruption) — will silently mismatch",
      });
    }
  }

  // 2. Catastrophic: no AUTH_SECRET means sessions AND X login tickets cannot
  //    be signed/verified securely.
  if (!present("AUTH_SECRET")) {
    issues.push({
      level: "fatal",
      key: "AUTH_SECRET",
      msg: "missing — sessions and X login tickets cannot be secured",
    });
  }

  // 3. Half-set provider pairs: one without the other = provider silently
  //    disabled (or mounted broken). This is exactly the X-saga shape.
  for (const [a, b, label] of PROVIDER_PAIRS) {
    if (present(a) !== present(b)) {
      const missing = present(a) ? b : a;
      issues.push({
        level: "error",
        key: `${a}/${b}`,
        msg: `${label}: only one key set (missing ${missing}) — provider silently disabled`,
      });
    }
  }

  // 4. Production-only: email + URL correctness. These don't break the build,
  //    they break password reset / verification links in users' inboxes.
  if (isProd) {
    if (!present("RESEND_API_KEY")) {
      issues.push({
        level: "error",
        key: "RESEND_API_KEY",
        msg: "missing in prod — all transactional email (verify, reset) silently no-ops",
      });
    }
    const url = val("NEXTAUTH_URL")?.trim();
    if (!url || !url.startsWith("https://")) {
      issues.push({
        level: "error",
        key: "NEXTAUTH_URL",
        msg: "missing or not https — email links + OAuth callbacks resolve to the wrong host",
      });
    }
    if (!present("RESEND_FROM")) {
      issues.push({
        level: "warn",
        key: "RESEND_FROM",
        msg: "unset — falls back to the fleet-conventional sender (mail-kit conventionalFrom)",
      });
    }
  }

  // 5. Non-fatal capability gaps: the app runs fine without these, but the
  //    feature goes silently dark (extract-proposal returns null, digest cron
  //    no-ops) and the operator has no signal for WHY nothing is produced.
  if (!present("GROQ_API_KEY")) {
    issues.push({
      level: "warn",
      key: "GROQ_API_KEY",
      msg: "unset — chat action-producer and digest generation are disabled",
    });
  }

  // Telegram is the same half-configured-provider shape as PROVIDER_PAIRS
  // above, and it was simply never listed. Observed in prod 2026-08-24:
  // TELEGRAM_BOT_TOKEN set, TELEGRAM_CHAT_ID absent — so selfTelegramTarget()
  // returned null and EVERY outbound message silently vanished. With zero push
  // subscriptions registered, that left the product with no delivery channel
  // at all while its code paths reported success. Feedback-arrival pushes and
  // run-close announcements were both writing to nowhere.
  //
  // warn, not error: a missing chat id must not 503 a healthy app or block the
  // deploy pipeline — the operator is usually asleep when this trips, and an
  // outage is a worse answer than a loud signal.
  // presentAliased, not present: the app reads this key through envAlias, which
  // only ever looks at APP_/LOKI_/COCKPIT_ prefixed names and NEVER the
  // bare one. Checking the bare name was wrong in both directions:
  //
  //   - false alarm  — prod has APP_TELEGRAM_CHAT_ID set and delivery works,
  //     yet this warned at every boot. 48 of last week's 231 warnings were
  //     this one line, on a surface where six real errors were sitting.
  //   - false quiet  — and worse: the fix the message implies is "set
  //     TELEGRAM_CHAT_ID", which silences the warning while selfTelegramTarget()
  //     still returns null and every notification still vanishes.
  //
  // A checker that resolves a variable differently from the code that consumes
  // it is not checking that code.
  if (present("TELEGRAM_BOT_TOKEN") && !presentAliased("TELEGRAM_CHAT_ID")) {
    issues.push({
      level: "warn",
      key: "TELEGRAM_CHAT_ID",
      msg: "unset while TELEGRAM_BOT_TOKEN is set — every Telegram notification (run-close, feedback arrival) is discarded silently. Set APP_TELEGRAM_CHAT_ID (or LOKI_/COCKPIT_): the bare name is NOT read by the app",
    });
  }

  return issues;
}

/** True when no fatal/error issues — used by /api/health and the deploy gate. */
export function envHealthy(issues: EnvIssue[]): boolean {
  return !issues.some((i) => i.level === "fatal" || i.level === "error");
}
