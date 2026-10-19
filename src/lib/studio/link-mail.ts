import { COMMISSION } from "@/config/commission";
import { sendEmailFire, studioLinkTemplate, studioUpdateTemplate } from "@/lib/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The portal link the studio site builds: id and key in the fragment, never a query string. */
export function studioPortalUrl(id: string, accessKey: string): string {
  return `${COMMISSION.studioOrigin}/portal/#id=${id}&key=${accessKey}`;
}

/**
 * Mail a visitor their private portal link.
 *
 * The link is the only credential a studio request has — no account, nothing
 * to reset — so a visitor who closes the tab without saving it has lost the
 * request. This is the way back: the moment an address is known (at intake,
 * or added later through the portal) the link goes to it, and the recovery
 * door mails a fresh one. Fire-and-forget; the key is never logged (email.ts
 * records recipient and subject only).
 */
export function mailStudioLink(input: {
  to: string | null | undefined;
  id: string;
  accessKey: string;
  kind: "website" | "partner";
  fresh?: boolean;
}): boolean {
  const to = input.to?.trim();
  if (!to || !EMAIL_RE.test(to)) return false;
  const mail = studioLinkTemplate({
    url: studioPortalUrl(input.id, input.accessKey),
    kind: input.kind,
    fresh: input.fresh ?? false,
  });
  sendEmailFire(to, mail.subject, mail.html, mail.text);
  return true;
}

/**
 * Tell a visitor the studio answered, at the address they gave. Silent when
 * they gave none: the portal is still where everything is.
 */
export function mailStudioUpdate(input: {
  to: string | null | undefined;
  kind: "website" | "partner";
  note: string;
}): boolean {
  const to = input.to?.trim();
  if (!to || !EMAIL_RE.test(to) || !input.note.trim()) return false;
  const mail = studioUpdateTemplate({
    kind: input.kind,
    note: input.note.trim(),
    portalUrl: `${COMMISSION.studioOrigin}/portal/`,
  });
  sendEmailFire(to, mail.subject, mail.html, mail.text);
  return true;
}
