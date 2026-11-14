import { createAuthMailer, spacedCode } from "@bitbaum/accountkit/auth/mail";
import { createTranslator } from "next-intl";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { withFallback } from "@/i18n/request";
import { defaultLocale, toLocale, type Locale } from "@/i18n/routing";
import { SITE } from "@/lib/site";

/**
 * The account mails: confirm an address, sign in by link, reset a password.
 * Sent through @bitbaum/mail-kit (one provider, one env contract). Never
 * throws, and never logs who it was for or what it carried — a sign-in link in
 * a log is a credential anyone with log access can use.
 */
export type AuthMail = "verify" | "magicLink" | "reset";

type Messages = typeof en;
const MESSAGES: Record<Locale, Messages> = {
  en,
  de: withFallback(en, de) as Messages,
  fr: withFallback(en, fr) as Messages,
};

/**
 * The language a mail is written in, read from the page the person will land
 * on. better-auth's links carry a `callbackURL`; ours always start with the
 * locale (`/de/account`), so the mail speaks the language they were reading.
 */
export function localeOfLink(url: string): Locale {
  try {
    const parsed = new URL(url);
    const callback = parsed.searchParams.get("callbackURL") ?? parsed.pathname;
    const first = callback.replace(/^https?:\/\/[^/]+/, "").split("/")[1] ?? "";
    return toLocale(first);
  } catch {
    return defaultLocale;
  }
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export function renderAuthMail(kind: AuthMail, url: string, locale: Locale, code?: string) {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "Mail" });
  const values = { site: SITE.title };
  const subject = t(`${kind}.subject`, values);
  const lead = t(`${kind}.lead`, values);
  const action = t(`${kind}.action`);
  const ignore = t("ignore");
  const codeLine = code ? t("code", { code: spacedCode(code) }) : null;
  const href = escapeHtml(url);
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${escapeHtml(lead)}</p>
<p><a href="${href}">${escapeHtml(action)}</a></p>
${codeLine ? `<p>${escapeHtml(codeLine)}</p>\n` : ""}<p style="color:#555">${escapeHtml(ignore)}</p>
</body></html>`;
  const textBody = `${lead}\n\n${action}: ${url}\n\n${codeLine ? `${codeLine}\n\n` : ""}${ignore}\n`;
  return { subject, html, text: textBody };
}

/**
 * Sent by AccountKit's shared mailer (@bitbaum/mail-kit underneath): it
 * checks the link's origin, skips addresses that cannot receive mail and puts
 * the sign-in code in the link's email, which this template prints.
 */
export const authMail = createAuthMailer({
  site: SITE,
  codes: true,
  render: (kind, url, extra) => renderAuthMail(kind, url, localeOfLink(url), extra.code),
});

export const mailConfigured = (): boolean => authMail.configured;

export const sendAuthMail: typeof authMail.send = (kind, to, url, extra) =>
  authMail.send(kind, to, url, extra);
