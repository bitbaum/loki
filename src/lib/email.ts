import { conventionalFrom, fromAddress, isMailConfigured, sendMail } from "@bitbaum/mail-kit";
import { ROUTES } from "@/config/auth";
import { APP_NAME, APP_TAGLINE, LOCAL_DEV_URL } from "@/config/brand";
import { EMAIL_THEME, mailSubject } from "@/config/comms";
import { escapeHtml, escapeHtmlWithBreaks } from "@/lib/escape-html";

// Record every send outcome to debug_logs so "did the reset/verify email
// actually go out?" is answerable. No body/PII logged — just recipient,
// subject, the Resend id, and any error. Fire-and-forget (never blocks send).
//
// The debug-logs import is deferred rather than top-level: it opens a DB
// client at module load, which every *template* in this file would otherwise
// inherit. Templates are pure string builders with no business touching a
// database, and a static import made them unloadable (and so untestable)
// without DATABASE_URL set. Sending still logs exactly as before.
function logSend(to: string, subject: string, id: string | null, error: string | null): void {
  void import("@/db/queries/debug-logs")
    .then(({ logDebug }) =>
      logDebug({
        source: "email",
        level: error ? "error" : "info",
        message: `${error ? "failed" : "sent"}: ${subject}`,
        meta: { to, subject, id, error },
      }),
    )
    .catch(() => {});
}

// Sender SSOT: RESEND_FROM (fleet env contract, read by mail-kit). Fallback is
// the fleet-conventional sender on the one Resend-verified domain.
function senderFrom(): string {
  return fromAddress() ?? conventionalFrom(APP_NAME);
}

export function appUrl(): string {
  return process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? LOCAL_DEV_URL;
}

// Fire-and-forget — callers don't await
export function sendEmailFire(to: string, subject: string, html: string, text: string): void {
  if (!isMailConfigured()) {
    // NEVER log `text`/`html` here — reset-password and verify-email bodies carry
    // a live one-time token URL; stdout is not a safe place for a credential.
    // The recipient + subject are captured structurally by logSend (debug_logs).
    console.log(`[email] mail not configured — skipping send: "${subject}" → ${to}`);
    logSend(to, subject, null, "mail not configured — skipped");
    return;
  }
  // sendMail never throws — failures come back as { sent: false }.
  void sendMail({ from: senderFrom(), to, subject, html, text }).then((res) => {
    if (!res.sent) console.error("[email] send error:", res.error);
    logSend(to, subject, res.sent ? res.id : null, res.sent ? null : res.error);
  });
}

// Awaitable version for flows that need to know the email was accepted
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  options?: { idempotencyKey?: string },
): Promise<void> {
  if (!isMailConfigured()) {
    console.log("[email] mail not configured — skipping send");
    return;
  }
  const res = await sendMail({ from: senderFrom(), to, subject, html, text }, options);
  logSend(to, subject, res.sent ? res.id : null, res.sent ? null : res.error);
  if (!res.sent) throw new Error(`Resend error: ${res.error}`);
}

// ─── Shared HTML shell ────────────────────────────────────────────────────────

function emailShell(content: string): string {
  const url = appUrl();
  const t = EMAIL_THEME;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:${t.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${t.page};padding:40px 16px;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
        <tr><td style="background:${t.header};padding:20px 32px;border-radius:8px 8px 0 0;text-align:center;">
          <span style="color:${t.headerInk};font-size:17px;font-weight:700;letter-spacing:-0.3px;">${APP_NAME}</span>
        </td></tr>
        <tr><td style="background:${t.card};padding:40px 32px;border-radius:0 0 8px 8px;color:${t.ink};">
          ${content}
        </td></tr>
      </table>
      <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;margin-top:20px;">
        <tr><td style="text-align:center;color:${t.muted};font-size:12px;line-height:1.6;">
          ${APP_NAME} &mdash; ${APP_TAGLINE}<br>
          <a href="${url}" style="color:${t.muted};text-decoration:underline;">${url.replace(/^https?:\/\//, "")}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  const t = EMAIL_THEME;
  return `<a href="${href}" style="display:inline-block;background:${t.button};color:${t.buttonInk};font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;margin:24px 0;">${label}</a>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${EMAIL_THEME.body};">${text}</p>`;
}

function small(text: string): string {
  return `<p style="margin:24px 0 0 0;font-size:12px;line-height:1.6;color:${EMAIL_THEME.muted};">${text}</p>`;
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function verifyEmailTemplate(verifyUrl: string, name: string) {
  const subject = mailSubject("verify");
  const html = emailShell(`
    <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">Verify your email</h2>
    ${p(`Hi ${name}, welcome to ${APP_NAME}. Verifying your email is optional but helps with account recovery and password reset.`)}
    <div style="text-align:center;">${btn(verifyUrl, "Verify email →")}</div>
    ${small(`Or paste this link in your browser:<br><a href="${verifyUrl}" style="color:${EMAIL_THEME.muted};word-break:break-all;">${verifyUrl}</a>`)}
    ${small(`This link expires in 24 hours. If you didn't create a ${APP_NAME} account, you can safely ignore this email.`)}
  `);
  const text = `Hi ${name}, verify your ${APP_NAME} email:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`;
  return { subject, html, text };
}

export function welcomeEmailTemplate(name: string) {
  const url = appUrl();
  const subject = mailSubject("welcome");
  const html = emailShell(`
    <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">You're in, ${name}</h2>
    ${p(`${APP_NAME} is your command center — projects, goals, and the agents that work on them.`)}
    ${p("Start with a project. Loki will take it from there.")}
    <div style="text-align:center;">${btn(url + ROUTES.APP_HOME, `Open ${APP_NAME} →`)}</div>
  `);
  const text = `Welcome to ${APP_NAME}, ${name}!\n\nOpen your dashboard: ${url}${ROUTES.APP_HOME}`;
  return { subject, html, text };
}

export function resetPasswordEmailTemplate(resetUrl: string) {
  const subject = mailSubject("reset");
  const html = emailShell(`
    <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">Reset your password</h2>
    ${p(`Someone requested a password reset for your ${APP_NAME} account. Click the button below to set a new password.`)}
    <div style="text-align:center;">${btn(resetUrl, "Reset password →")}</div>
    ${small(`Or paste this link in your browser:<br><a href="${resetUrl}" style="color:${EMAIL_THEME.muted};word-break:break-all;">${resetUrl}</a>`)}
    ${small("This link expires in 2 hours. If you didn't request this, you can safely ignore this email — your password won't change.")}
  `);
  const text = `Reset your ${APP_NAME} password:\n\n${resetUrl}\n\nThis link expires in 2 hours. If you didn't request this, ignore it.`;
  return { subject, html, text };
}

export function feedbackShippedTemplate(input: {
  site: string;
  excerpt: string;
  page?: string | null;
}) {
  const subject = mailSubject("feedback_shipped", input.site);
  const where = input.page ? ` on ${input.page}` : "";
  // `excerpt` and `page` are visitor-authored: excerpt is the raw suggestion
  // body from the widget, page is location.pathname off the customer's site.
  // Both land in an email we send from our own domain to an address the same
  // visitor chose, so unescaped they are an injection path into our mail.
  const safeExcerpt = escapeHtml(input.excerpt);
  const safeWhere = input.page ? ` on ${escapeHtml(input.page)}` : "";
  const html = emailShell(`
    <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">Your feedback shipped</h2>
    ${p(`You reported: “${safeExcerpt}”`)}
    ${p(`A fix just went live${safeWhere}. Thanks for pointing it out.`)}
  `);
  // The text/plain alternative is not markup, so it keeps the raw values.
  const text = `You reported: "${input.excerpt}"\n\nA fix just went live${where}. Thanks for pointing it out.`;
  return { subject, html, text };
}

/**
 * An invitation into one project. The project and inviter names are
 * user-authored, so they are escaped exactly like the feedback template's.
 */
export function projectInviteTemplate(input: {
  projectName: string;
  inviterName: string | null;
  role: "editor" | "viewer";
  inviteUrl: string;
  expiresDays: number;
}) {
  const subject = mailSubject("project_invite", input.projectName);
  const who = input.inviterName?.trim() || "A project owner";
  const can =
    input.role === "editor"
      ? "work on it with them: run agents, edit notes and settings"
      : "follow it: see its runs, feedback and what shipped";
  const html = emailShell(`
    <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">You're invited to ${escapeHtml(input.projectName)}</h2>
    ${p(`${escapeHtml(who)} invited you to ${escapeHtml(input.projectName)} on ${APP_NAME}, so you can ${can}.`)}
    ${p(`You sign in with your OrangeCat account. If you don't have one yet, you create it on the way. There is no separate ${APP_NAME} password.`)}
    ${btn(input.inviteUrl, "Accept the invitation")}
    ${p(`The link works for this email address only, and expires in ${input.expiresDays} days.`)}
  `);
  const text = `${who} invited you to ${input.projectName} on ${APP_NAME}, so you can ${can}.\n\nAccept: ${input.inviteUrl}\n\nYou sign in with your OrangeCat account (create one on the way if needed). The link works for this email address only and expires in ${input.expiresDays} days.`;
  return { subject, html, text };
}

/** Operator-approved outbound mail — same chrome as every other Loki email. */
export function operatorMailTemplate(input: { subject: string; body: string }) {
  const subject = mailSubject("operator", input.subject);
  const escaped = escapeHtmlWithBreaks(input.body);
  const html = emailShell(`
    <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">${subject}</h2>
    <div style="font-size:15px;line-height:1.6;color:${EMAIL_THEME.body};">${escaped}</div>
  `);
  return { subject, html, text: input.body };
}

// ─── Activity digest ────────────────────────────────────────────────────────

// Render the Groq-produced digest markdown into the shared email shell.
// Same paragraphs/bullets/headings/bold subset MarkdownText renders in the UI
// so the email and the on-screen report stay visually consistent.
function renderDigestMarkdown(markdown: string): string {
  const blocks: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      blocks.push("</ul>");
      listOpen = false;
    }
  };
  const inline = (text: string) =>
    text.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${EMAIL_THEME.ink};">$1</strong>`);
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!listOpen) {
        blocks.push(
          `<ul style="margin:0 0 16px 0;padding-left:20px;color:${EMAIL_THEME.body};font-size:15px;line-height:1.7;">`,
        );
        listOpen = true;
      }
      blocks.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (/^#{1,3} /.test(line)) {
      closeList();
      blocks.push(
        `<h3 style="margin:20px 0 8px 0;font-size:16px;font-weight:600;color:${EMAIL_THEME.ink};">${inline(line.replace(/^#+\s+/, ""))}</h3>`,
      );
    } else {
      closeList();
      blocks.push(
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:${EMAIL_THEME.body};">${inline(line)}</p>`,
      );
    }
  }
  closeList();
  return blocks.join("\n");
}

/** One stat in the digest's header strip. Colour is always paired with the
 *  label beside it — never the sole carrier of meaning. */
function digestStat(value: number, label: string, color: string): string {
  return `<td style="padding:0 14px 0 0;white-space:nowrap;">
      <span style="font-size:22px;font-weight:700;color:${color};">${value}</span>
      <span style="font-size:13px;color:${EMAIL_THEME.muted};padding-left:5px;">${label}</span>
    </td>`;
}

/**
 * The digest email.
 *
 * It used to be the report markdown under a generic "Daily digest" heading,
 * with the subject line "Loki daily digest" — identical every single day.
 * An inbox shows you a subject and maybe a preview line, so a recurring email
 * whose subject never changes teaches you to archive it unread, no matter how
 * good the body is.
 *
 * Now the subject carries the actual state ("1 needs you · 3 shipped"), and the
 * body opens with the same numbers as a stat strip so the answer survives the
 * two seconds someone gives an email on a phone. The report follows, for the
 * ones who read on.
 */
export function digestEmailTemplate({
  markdown,
  cadenceLabel,
  windowLabel,
  activityUrl,
  stats,
}: {
  markdown: string;
  cadenceLabel: string; // "daily" | "weekly" | "monthly"
  windowLabel: string; // "the last 24 hours" / "the last 7 days" / "the last 30 days"
  activityUrl: string;
  /** Headline counts. Omitted for callers that only have markdown — the email
   *  then degrades to its previous shape rather than inventing numbers. */
  stats?: { attention: number; shipped: number; running: number; agentLabel: string | null };
}) {
  // A subject that changes with reality. Ordered worst-first, same as the page.
  const subjectFacts: string[] = [];
  if (stats) {
    if (stats.attention > 0) subjectFacts.push(`${stats.attention} needs you`);
    if (stats.shipped > 0) subjectFacts.push(`${stats.shipped} shipped`);
    if (subjectFacts.length === 0 && stats.running > 0)
      subjectFacts.push(`${stats.running} running`);
  }
  const subject = mailSubject(
    "digest",
    subjectFacts.length > 0 ? subjectFacts.join(" · ") : `${cadenceLabel} digest`,
  );

  const statStrip = stats
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;"><tr>
        ${stats.attention > 0 ? digestStat(stats.attention, "needs you", EMAIL_THEME.alert) : ""}
        ${stats.shipped > 0 ? digestStat(stats.shipped, "shipped", EMAIL_THEME.good) : ""}
        ${stats.running > 0 ? digestStat(stats.running, "running", EMAIL_THEME.ink) : ""}
      </tr></table>`
    : "";

  const agentLine = stats?.agentLabel
    ? p(
        `Your agents worked <strong style="color:${EMAIL_THEME.ink};">${stats.agentLabel}</strong> in ${windowLabel}.`,
      )
    : p(`What your fleet did in ${windowLabel}.`);

  const html = emailShell(`
    <h2 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:${EMAIL_THEME.ink};">${cadenceLabel.charAt(0).toUpperCase() + cadenceLabel.slice(1)} report</h2>
    ${agentLine}
    ${statStrip}
    ${renderDigestMarkdown(markdown)}
    <div style="text-align:center;">${btn(activityUrl, "Open Activity →")}</div>
    ${small(`You're receiving this because you opted in to ${cadenceLabel} digests in your ${APP_NAME} notification preferences.`)}
  `);

  const textStats = subjectFacts.length > 0 ? `${subjectFacts.join(" · ")}\n\n` : "";
  const text = `${APP_NAME} ${cadenceLabel} report — ${windowLabel}.\n\n${textStats}${markdown}\n\nOpen Activity: ${activityUrl}`;
  return { subject, html, text };
}
