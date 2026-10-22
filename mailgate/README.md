# mailgate

The receiving half of the fleet's email standard. Every app has one public
address on its own host, **`hello@<app host>`** (`hello@skif.orangecat.ch`).
Mail sent there reaches the app as a typed, signed HTTP request. No app runs a
mail server, holds a mailbox password or pays per address.

```
sender ──SMTP:25──▶ mailgate (the box) ──POST, signed──▶ http://127.0.0.1:<port>/api/mail/inbound
                    │ hello@ / postmaster@ / abuse@ only
                    │ SPF · DKIM · DMARC checked, failures marked, not dropped
                    └ spooled to disk BEFORE "250 accepted"
```

## What it does

- **Routes by the register.** A host is served when a row in `apps.conf` lists
  it and the row is not `archived` or `retired`; its port is that row's port.
  The gateway reads Loki's live copy (`/opt/loki/app/scripts/hetzner/apps.conf`,
  refreshed by every Loki deploy) and the copy installed beside it. A site
  added to the register therefore receives mail after the next deploy, with no
  step here.
- **Refuses at SMTP time** anything it would not deliver: an unknown host, or a
  mailbox other than `hello`, `postmaster` and `abuse` (RFC 2142). There are no
  bounces, so it cannot be used for backscatter. It is receive-only: no AUTH,
  no relaying, and it never sends mail.
- **Never loses an accepted message.** The parsed message is written to
  `spool/pending/` before the sender hears `250`. Delivery is retried with
  backoff (1, 5, 15, 60, 180, then every 360 minutes) until the app answers
  2xx. A 404 is retried too, so an app gets its mail the day it adopts the route.
- **Keeps nothing it does not need.** Delivered mail and its raw source are
  deleted after `MAILGATE_KEEP_DAYS` (14). The app's own retention governs its
  copy; Skif's, for example, deletes after 90 days. Undelivered mail is never
  pruned.

## Adopting it in an app

```ts
// app/api/mail/inbound/route.ts
import { inboundHandler } from "@bitbaum/mail-kit";
export const POST = inboundHandler({ onMail: (mail) => store(mail) });
```

`inboundHandler` (mail-kit ≥ 0.2) verifies the `x-mail-signature` HMAC with
`MAIL_INBOUND_SECRET`. That secret is a fleet key in `/opt/fleet/env` which
every app on the box already reads, so there is nothing to configure per app.
The handler refuses anything unsigned, stale (over 5 minutes) or over 2 MB.
Then:

- `triageMail(mail, complete)` sorts a message by kind and urgency with the
  app's own model chain. It falls back to rules when no model answers.
- `sendMail({ …, replyTo: appAddressFromEnv() })` answers it, and the reply
  comes back to the same inbox.
- Use the delivery `id` as the primary key: a retry must not make a second row.

Skif is the reference adopter: `src/server/mail.ts` and `/ops/mail/[id]`.

## Running it

- **Install or update:** Actions → *Mailgate* → Run workflow. It runs the tests,
  bundles `src/server.ts` into one file (`dist/mailgate.mjs`) and runs
  `scripts/hetzner/install-mailgate.sh` on the box. The installer creates
  `MAIL_INBOUND_SECRET` once, makes its own STARTTLS key, opens 25/tcp and
  restarts `loki-mailgate.service`.
- **Logs:** `journalctl -u loki-mailgate`.
- **Local:** `MAILGATE_PORT=2525 MAILGATE_REGISTER=./apps.conf MAILGATE_SPOOL=/tmp/spool MAIL_INBOUND_SECRET=x node dist/mailgate.mjs`

## What only DNS can do

Mail for `<app>.orangecat.ch` already reaches the box: those hosts have an A
record and no MX, so senders fall back to the A record (RFC 5321 §5.1).
To make that explicit, add once at Infomaniak:

- `*.orangecat.ch MX 10 mx.orangecat.ch` and `mx.orangecat.ch A 167.233.22.31`.

An app on its own domain needs `MX 10 mx.orangecat.ch` there.

Sending stays on mail-kit's shared sender for now, with Reply-To
`hello@<app host>`. Sending from `hello@` itself needs outbound port 25, which
Hetzner unblocks on request, plus a DKIM key in DNS.
