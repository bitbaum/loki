import { isMailConfigured, sendMail } from "@bitbaum/mail-kit";
import { createTranslator } from "next-intl";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { withFallback } from "@/i18n/request";
import { defaultLocale, toLocale, type Locale } from "@/i18n/routing";
import { isDeliverable } from "@/lib/auth/methods";
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

export function mailConfigured(): boolean {
  return isMailConfigured();
}

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

export function renderAuthMail(kind: AuthMail, url: string, locale: Locale) {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "Mail" });
  const values = { site: SITE.title };
  const subject = t(`${kind}.subject`, values);
  const lead = t(`${kind}.lead`, values);
  const action = t(`${kind}.action`);
  const ignore = t("ignore");
  const href = escapeHtml(url);
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,sans-serif;line-height:1.5">
<p>${escapeHtml(lead)}</p>
<p><a href="${href}">${escapeHtml(action)}</a></p>
<p style="color:#555">${escapeHtml(ignore)}</p>
</body></html>`;
  const textBody = `${lead}\n\n${action}: ${url}\n\n${ignore}\n`;
  return { subject, html, text: textBody };
}

export async function sendAuthMail(kind: AuthMail, to: string, url: string): Promise<void> {
  if (!isDeliverable(to)) return;
  if (!isMailConfigured()) {
    // Development only: there is no inbox, so the link goes to the console of
    // the person running the server. Production never reaches this line with
    // a link, because the methods that need mail are hidden without it.
    if (process.env.NODE_ENV === "development")
      console.warn(`[mail] not configured — ${kind}: ${url}`);
    return;
  }
  const { subject, html, text } = renderAuthMail(kind, url, localeOfLink(url));
  const result = await sendMail({ to, subject, html, text });
  if (!result.sent) {
    console.error(
      `[mail] ${kind} not sent (status ${result.status ?? "none"}, retryable ${result.retryable})`,
    );
  }
}
