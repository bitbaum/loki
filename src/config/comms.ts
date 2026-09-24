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
  "operator",
  "project_invite",
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
    case "operator":
      return extra?.trim() || `${APP_NAME}`;
    case "project_invite":
      return extra ? `You're invited to ${extra} on ${APP_NAME}` : `You're invited to ${APP_NAME}`;
  }
}

export const COMMS_COPY = {
  verifyBanner: "Verify your email for account recovery (optional).",
  verifySent: "Verification link sent — check your inbox.",
  digestSettingsTitle: "Activity digest emails",
  digestSettingsBody: "What ran, what broke, what moved. This is the mail Loki sends.",
} as const;
