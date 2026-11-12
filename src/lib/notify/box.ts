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
import { createHash } from "node:crypto";
import type { NoticeRequest } from "@/lib/notify/policy";

/**
 * Lines that mean "someone may be in the box". Everything else is the list's.
 * Kept in step with `_alert_intrusion` in lib-alert.sh (install-host-alerts.sh),
 * which uses the same list when Loki itself cannot be reached;
 * scripts/test/notify-box.ts checks both.
 */
export const INTRUSION = [
  /SSH PASSWORD LOGIN/,
  /^🔑 SSH LOGIN/,
  /^☠️/,
  /^🔓 SSHD/,
  /^🧱 FIREWALL/,
  /^👤 NEW PRIVILEGED/,
  /SENSITIVE FILE.*(authorized_keys|sudoers|\/shadow|pam\.d|ld\.so\.preload)/,
];

export function isIntrusion(text: string): boolean {
  return INTRUSION.some((re) => re.test(text.trim()));
}

/**
 * The list key: the line's kind, before its first colon ("⚙️ STILL FAILING",
 * "🧩 reparaturbonus-zh"), so a line repeated with new details is ONE row
 * whose count rises, not a new row every five minutes. Numbers are not the
 * kind: "DISK GC could not free space — still 93%" and "… still 91%" (no
 * colon, so the whole line was the head) were two rows on /system
 * (2026-11-12), both disagreeing with the live disk reading below them.
 */
export function boxKey(text: string): string {
  const t = text.trim();
  const head = t.split(":")[0]?.trim() || t;
  return `box:${head.replace(/\d+(?:\.\d+)?%?/g, "#").slice(0, 80)}`;
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
    // Keyed on the whole line: a second login from another address, or a
    // second suspicious process, is a new sign, not a reminder of the first.
    const id = createHash("sha256").update(t).digest("hex").slice(0, 16);
    return {
      source: "box",
      title: `bitbaum: ${title}`.slice(0, 140),
      body,
      // The notice is an operator row, so it is listed on /today.
      actions: [{ label: "See what happened", url: `${appUrl}/today` }],
      urgency: "now",
      key: `box:intrusion:${id}`,
    };
  }
  return { source: "box", title, body, actions: [], urgency: "today", key: boxKey(t) };
}
