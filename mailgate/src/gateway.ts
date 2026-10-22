/**
 * The SMTP side: who may send mail to whom, the authenticity checks, and
 * turning a raw message into the typed InboundMail every app receives
 * (@bitbaum/mail-kit, inbound.ts).
 *
 * This is a RECEIVING server only. There is no AUTH and no relaying: a
 * recipient must be one of the register's app addresses or the transaction is
 * refused at RCPT, before any data is read.
 */
import { randomUUID } from "node:crypto";
import type { AuthVerdict, InboundMail, MailParty } from "@bitbaum/mail-kit";
import { authenticate } from "mailauth";
import { simpleParser, type AddressObject } from "mailparser";
import { SMTPServer, type SMTPServerOptions, type SMTPServerSession } from "smtp-server";
import { routeFor, type Register } from "./register.js";
import type { Spool } from "./spool.js";

/** Large enough for a photo or two; the gateway forwards text, not files. */
export const MAX_MESSAGE_BYTES = 15 * 1024 * 1024;

export interface GatewayOptions {
  register: () => Register;
  spool: Spool;
  /** This server's own name, for the banner and Authentication-Results. */
  hostname: string;
  /** Set to skip DNS lookups in tests. */
  authenticateImpl?: typeof authenticate;
  tls?: Pick<SMTPServerOptions, "key" | "cert">;
  onAccepted?: (ids: string[]) => void;
}

function verdict(result: string | undefined): AuthVerdict {
  return result === "pass"
    ? "pass"
    : result === "fail" || result === "softfail" || result === "permerror"
      ? "fail"
      : "none";
}

function parties(obj: AddressObject | AddressObject[] | undefined): MailParty[] {
  const list = Array.isArray(obj) ? obj : obj ? [obj] : [];
  return list
    .flatMap((o) => o.value)
    .flatMap((v) =>
      v.address ? [{ address: v.address.toLowerCase(), ...(v.name ? { name: v.name } : {}) }] : [],
    );
}

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

const bare = (id: string | undefined) => id?.replace(/^<|>$/g, "").trim() || undefined;

/** Raw message + SMTP session → one InboundMail per app recipient. */
export async function toInboundMail(
  raw: Buffer,
  session: Pick<SMTPServerSession, "remoteAddress" | "hostNameAppearsAs" | "envelope">,
  recipients: string[],
  {
    hostname,
    authenticateImpl = authenticate,
  }: Pick<GatewayOptions, "hostname" | "authenticateImpl">,
): Promise<InboundMail[]> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const mailFrom = session.envelope.mailFrom === false ? "" : session.envelope.mailFrom.address;
  let auth: InboundMail["auth"] = { spf: "none", dkim: "none", dmarc: "none" };
  try {
    const a = await authenticateImpl(raw, {
      ip: session.remoteAddress,
      helo: session.hostNameAppearsAs,
      sender: mailFrom,
      mta: hostname,
    });
    const dkim = a.dkim?.results?.some(
      (r: { status?: { result?: string } }) => r.status?.result === "pass",
    )
      ? "pass"
      : verdict(a.dkim?.results?.[0]?.status?.result);
    auth = {
      spf: verdict(a.spf ? a.spf.status?.result : undefined),
      dkim,
      dmarc: verdict(a.dmarc ? a.dmarc.status?.result : undefined),
    };
  } catch {
    // DNS trouble: deliver, marked "none", rather than drop a real customer's mail.
  }
  const from = parties(parsed.from)[0] ?? { address: mailFrom || "unknown@invalid" };
  const html = typeof parsed.html === "string" ? parsed.html : undefined;
  const text = (parsed.text?.trim() || (html ? stripTags(html) : "")).slice(0, 200_000);
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  const replyTo = parties(parsed.replyTo)[0];
  const cc = parties(parsed.cc);
  return recipients.map((to) => ({
    id: randomUUID(),
    ...(bare(parsed.messageId) ? { messageId: bare(parsed.messageId) } : {}),
    ...(bare(parsed.inReplyTo) ? { inReplyTo: bare(parsed.inReplyTo) } : {}),
    ...(references.length ? { references: references.map((r) => bare(r) ?? r) } : {}),
    receivedAt: new Date().toISOString(),
    to,
    from,
    ...(replyTo ? { replyTo } : {}),
    ...(cc.length ? { cc } : {}),
    subject: (parsed.subject ?? "").slice(0, 500),
    text,
    ...(html ? { html: html.slice(0, 500_000) } : {}),
    attachments: parsed.attachments.map((x) => ({
      filename: x.filename ?? "attachment",
      contentType: x.contentType,
      size: x.size,
    })),
    auth,
  }));
}

export function createGateway(options: GatewayOptions): SMTPServer {
  const { register, spool, hostname } = options;
  return new SMTPServer({
    name: hostname,
    banner: "mail for the apps on this host; no relaying",
    size: MAX_MESSAGE_BYTES,
    disabledCommands: ["AUTH"],
    authOptional: true,
    // Without a configured certificate smtp-server offers STARTTLS with its
    // built-in self-signed one: senders encrypt opportunistically either way.
    ...(options.tls ?? {}),
    maxClients: 50,
    socketTimeout: 60_000,
    onRcptTo(address, _session, callback) {
      if (routeFor(register(), address.address)) return callback();
      const err = Object.assign(new Error("No such mailbox here"), { responseCode: 550 });
      return callback(err);
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        if (stream.sizeExceeded) {
          return callback(Object.assign(new Error("Message too large"), { responseCode: 552 }));
        }
        const raw = Buffer.concat(chunks);
        const routes = session.envelope.rcptTo.flatMap((r) => {
          const route = routeFor(register(), r.address);
          return route ? [{ to: r.address.toLowerCase(), port: route.port }] : [];
        });
        toInboundMail(
          raw,
          session,
          routes.map((r) => r.to),
          options,
        )
          .then((mails) => {
            mails.forEach((mail, i) => {
              spool.saveRaw(mail.id, raw);
              spool.put({ mail, port: routes[i]!.port, attempts: 0, nextAt: 0 });
            });
            options.onAccepted?.(mails.map((m) => m.id));
            callback(null, `Queued as ${mails.map((m) => m.id).join(",")}`);
          })
          .catch((error: unknown) => {
            // 451: the sender keeps the message and tries again later.
            console.error(
              "[mailgate] could not accept:",
              error instanceof Error ? error.message : error,
            );
            callback(
              Object.assign(new Error("Temporary failure, try again later"), { responseCode: 451 }),
            );
          });
      });
    },
  });
}
