/**
 * Communication SSOT — every outbound mail kind, cadence label, and the
 * email chrome tokens. Pages, crons, and templates import from here.
 * Transport stays in lib/email.ts.
 */
import { APP_NAME } from "@/config/brand";
import { PALETTE } from "@/lib/palette";
import { type DigestCadence } from "@/db/schema/notification-preferences";

export const MAIL_KINDS = [
  "verify",
  "welcome",
  "reset",
  "digest",
  "feedback_shipped",
  "feedback_received",
  "operator",
  "project_invite",
  "studio_link",
  "studio_update",
  "build_request",
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** Cadence presentation — schema owns the values, this owns the words. */
export const DIGEST_CADENCE_COPY: Record<
  DigestCadence,
  { label: string; description: string; windowLabel: string }
> = {
  none: {
    label: "Off",
    description: "Don't send digest emails.",
    windowLabel: "",
  },
  daily: {
    label: "Daily",
    description: "What ran, what broke, what moved — last 24 hours.",
    windowLabel: "the last 24 hours",
  },
  weekly: {
    label: "Weekly",
    description: "What ran, what broke, what moved — last 7 days.",
    windowLabel: "the last 7 days",
  },
  monthly: {
    label: "Monthly",
    description: "What ran, what broke, what moved — last 30 days.",
    windowLabel: "the last 30 days",
  },
};

/** Email HTML cannot read CSS vars. These map 1:1 to globals.css tokens. */
export const EMAIL_THEME = {
  page: PALETTE.light.surfacePage,
  header: PALETTE.dark.surfacePage,
  headerInk: PALETTE.dark.textPrimary,
  card: PALETTE.white,
  ink: PALETTE.dark.surfacePage,
  body: PALETTE.dark.surfacePage,
  muted: PALETTE.dark.textTertiary,
  button: PALETTE.dark.surfacePage,
  buttonInk: PALETTE.dark.textPrimary,
  /** Digest stat strip. Email is a light surface, so these are the light-mode
   *  status tokens. Both ship beside a WORD ("needs you" / "shipped") — colour
   *  alone would be unreadable to a red-green colourblind reader, and email
   *  clients strip the CSS a page would use to compensate. */
  alert: PALETTE.light.statusNegative,
  good: PALETTE.light.statusPositive,
} as const;

export function mailSubject(kind: MailKind, extra?: string): string {
  switch (kind) {
    case "verify":
      return `Verify your ${APP_NAME} email`;
    case "welcome":
      return `Welcome to ${APP_NAME}`;
    case "reset":
      return `Reset your ${APP_NAME} password`;
    case "digest":
      return `${APP_NAME} ${extra ?? "digest"}`;
    case "feedback_shipped":
      return extra ? `Your feedback on ${extra} shipped` : "Your feedback shipped";
    case "feedback_received":
      return extra ? `We got your note about ${extra}` : "We got your note";
    case "operator":
      return extra?.trim() || `${APP_NAME}`;
    case "project_invite":
      return extra ? `You're invited to ${extra} on ${APP_NAME}` : `You're invited to ${APP_NAME}`;
    case "studio_link":
      return extra === "fresh"
        ? "Your new private link to the bitbaum studio"
        : "Your private link to the bitbaum studio";
    case "studio_update":
      return extra === "partner"
        ? "The bitbaum studio answered your builder application"
        : "The bitbaum studio answered your request";
    case "build_request":
      return extra === "building"
        ? "Your new version is being built"
        : `About your request on ${APP_NAME}`;
  }
}

export const COMMS_COPY = {
  verifyBanner: "Verify your email for account recovery (optional).",
  /** The phone line: the same promise in the width a phone has. */
  verifyBannerShort: "Verify your email (optional).",
  verifySent: "Verification link sent — check your inbox.",
  digestSettingsTitle: "Activity digest emails",
  digestSettingsBody: "What ran, what broke, what moved. This is the mail Loki sends.",
  /** The "notifications on this phone" card (Settings → Notifications). */
  phonePush: {
    title: "On this phone",
    onHeadline: "Notifications are on for this phone",
    onBody:
      "A new report on one of your sites, a fix that went live and a run that needs you arrive here, even with Loki closed.",
    offHeadline: "Get a ping on this phone",
    offBody:
      "When someone leaves feedback on your site, or a fix needs you, this phone buzzes. Nothing else, and you can turn it off here.",
    onLabel: "Turn on notifications",
    offLabel: "Turn off",
    testLabel: "Send a test",
    retryLabel: "Try again",
    workingHeadline: "Turning on…",
    workingBody: "Your browser may ask permission. Say yes.",
    deniedHeadline: "This browser is blocking notifications",
    deniedBody:
      "Allow notifications for this site in the browser's site settings, then come back and turn them on.",
    unsupportedHeadline: "This browser can't show notifications",
    unsupportedBody:
      "Open Loki in a current Chrome, Firefox or Edge, or install it as an app, and turn them on there.",
    unsupportedIosBody:
      "On iPhone, share this page and choose Add to Home Screen, open Loki from the new icon, then turn them on here.",
    errorHeadline: "Couldn't turn them on",
    errorBody: "Nothing was changed.",
    keyMissingHeadline: "Notifications aren't set up on this server",
    keyMissingBody: "The server has no push key. Telegram and email still work.",
    testSent: (n: number) => `Sent to ${n} device${n === 1 ? "" : "s"}. It should buzz now.`,
    testNone: "No device is subscribed yet, so nothing was sent.",
    testFailed: "The test could not be sent.",
  },
  /** The OpenClaw gateway carries WhatsApp and the Telegram chat; when it is down, nothing sent there is read. */
  gateway: {
    downTitle: "WhatsApp and the Telegram chat are not being read",
    downBody: (detail: string) =>
      `The OpenClaw gateway is not answering (${detail}). Messages you send Loki on WhatsApp or Telegram wait unread. Restart it: run the "OpenClaw gateway up" workflow in GitHub Actions.`,
    downTelegram: (detail: string) =>
      `🔌 Loki: the gateway behind WhatsApp and the Telegram chat is down (${detail}). Messages to Loki there are not being read. Restart it: run "OpenClaw gateway up" in GitHub Actions.`,
    upTelegram:
      "✅ Loki: the gateway is back. WhatsApp and the Telegram chat are being read again.",
  },
} as const;
