import { COMMS_COPY } from "@/config/comms";

/**
 * What the "notifications on this phone" card says and offers, for every state
 * the browser can be in. Pure: the card renders it, the test pins it, and a
 * state with no way forward is a failing assertion rather than a screenshot
 * someone has to notice.
 *
 * It exists because the push channel had a backend, VAPID keys and a service
 * worker — and no screen anywhere that asked a phone to subscribe. On
 * 2026-10-15 production held ZERO subscribed devices, so every "new feedback"
 * ping went to nobody and said so only in a log line.
 */
export type PushStatus =
  "unsupported" | "denied" | "default" | "granted" | "subscribed" | "registering" | "error";

export type PushCardAction = "subscribe" | "test" | "unsubscribe";

export type PushCardView = {
  /** on = working; off = not yet; blocked = the browser says no; info = cannot work here. */
  tone: "on" | "off" | "blocked" | "info";
  headline: string;
  body: string;
  primary: { label: string; action: PushCardAction } | null;
  secondary: { label: string; action: PushCardAction } | null;
};

export function pushCardView(input: {
  status: PushStatus;
  /** The server has no VAPID key to hand out: nothing can subscribe. */
  keyMissing: boolean;
  /** iPhone/iPad Safari only does push for a site added to the Home Screen. */
  isIos: boolean;
  error: string | null;
}): PushCardView {
  const c = COMMS_COPY.phonePush;
  if (input.keyMissing) {
    return {
      tone: "info",
      headline: c.keyMissingHeadline,
      body: c.keyMissingBody,
      primary: null,
      secondary: null,
    };
  }
  switch (input.status) {
    case "subscribed":
      return {
        tone: "on",
        headline: c.onHeadline,
        body: c.onBody,
        primary: { label: c.testLabel, action: "test" },
        secondary: { label: c.offLabel, action: "unsubscribe" },
      };
    case "registering":
      return {
        tone: "off",
        headline: c.workingHeadline,
        body: c.workingBody,
        primary: null,
        secondary: null,
      };
    case "denied":
      return {
        tone: "blocked",
        headline: c.deniedHeadline,
        body: c.deniedBody,
        primary: null,
        secondary: null,
      };
    case "unsupported":
      return {
        tone: "info",
        headline: c.unsupportedHeadline,
        body: input.isIos ? c.unsupportedIosBody : c.unsupportedBody,
        primary: null,
        secondary: null,
      };
    case "error":
      return {
        tone: "off",
        headline: c.errorHeadline,
        body: input.error ? `${c.errorBody} (${input.error})` : c.errorBody,
        primary: { label: c.retryLabel, action: "subscribe" },
        secondary: null,
      };
    default:
      // default | granted: permission not asked yet, or granted without a subscription.
      return {
        tone: "off",
        headline: c.offHeadline,
        body: c.offBody,
        primary: { label: c.onLabel, action: "subscribe" },
        secondary: null,
      };
  }
}
