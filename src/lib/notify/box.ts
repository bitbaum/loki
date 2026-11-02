/**
 * What the box says, turned into a notice (lib/notify/policy.ts).
 *
 * The box's alerting (lib-alert.sh) posts every line it would once have sent
 * to Telegram here instead. Almost none of them have a one-tap answer: a
 * failed unit already has a fix agent on it, a recovery needs nothing, a
 * deploy edited its own files. Those are recorded on /system — one row per
 * kind of line, its count rising — and never reach the phone. Only a sign
 * that someone may be IN the box is worth a sound, and its button opens the
 * evidence.
 */
import type { NoticeRequest } from "@/lib/notify/policy";

/** Lines that mean "someone may be in the box". Everything else is the list's. */
const INTRUSION = [/SSH PASSWORD LOGIN/, /^☠️/, /^🔓 SSHD/, /^🧱 FIREWALL/, /^👤 NEW PRIVILEGED/];

export function isIntrusion(text: string): boolean {
  return INTRUSION.some((re) => re.test(text.trim()));
}

/**
 * The list key: the line's kind, before its first colon ("⚙️ STILL FAILING",
 * "🧩 reparaturbonus-zh"), so a line repeated with new details is ONE row
 * whose count rises, not a new row every five minutes.
 */
export function boxKey(text: string): string {
  const t = text.trim();
  const head = t.split(":")[0]?.trim() || t;
  return `box:${head.slice(0, 80)}`;
}

/** A rescale window on Hetzner opens rarely and closes fast: the owner asked to hear it. */
const RESCALE = /^🟢 Hetzner:/;
export const HETZNER_CONSOLE_URL = "https://console.hetzner.cloud/";

export function boxNotice(text: string, appUrl: string): NoticeRequest {
  const t = text.trim().replace(/\s+/g, " ");
  if (RESCALE.test(t)) {
    return {
      source: "box",
      title: "A bigger server is available for bitbaum right now",
      body: t.replace(RESCALE, "").trim().slice(0, 600),
      actions: [{ label: "Open Hetzner Console", url: HETZNER_CONSOLE_URL }],
      urgency: "today",
      key: "box:hetzner-rescale",
    };
  }
  const [head, ...rest] = t.split(": ");
  const title = (rest.length ? head : t).slice(0, 140);
  const body = rest.length ? rest.join(": ").slice(0, 600) : undefined;
  if (isIntrusion(t)) {
    return {
      source: "box",
      title,
      body,
      actions: [{ label: "See what happened", url: `${appUrl}/system` }],
      urgency: "now",
      key: boxKey(t),
    };
  }
  return { source: "box", title, body, actions: [], urgency: "today", key: boxKey(t) };
}
