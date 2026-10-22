import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { INBOUND_SIGNATURE_HEADER, verifyInbound, type InboundMail } from "@bitbaum/mail-kit";
import nodemailer from "nodemailer";
import type { SMTPServer } from "smtp-server";
import { BACKOFF_MINUTES, deliverDue, nextAttemptAt } from "../src/deliver.js";
import { createGateway } from "../src/gateway.js";
import { parseRegister, routeFor } from "../src/register.js";
import { loadRegister } from "../src/register.js";
import { Spool } from "../src/spool.js";

const SECRET = "test-secret";

describe("register", () => {
  const reg = parseRegister(
    [
      "# comment",
      "skif|4030|skif.orangecat.ch|/x|.|skif|bitbaum|product|live|-|-|-",
      "vitareba|4011|vita.orangecat.ch,vitareba.orangecat.ch|/x|.|v|clinic|client-app|live|favour|0|-",
      "gone|4099|gone.orangecat.ch|/x|.|g|bitbaum|product|archived|-|-|-",
    ].join("\n"),
  );

  it("maps every live host to its app's port, and drops archived sites", () => {
    assert.equal(reg.get("skif.orangecat.ch"), 4030);
    assert.equal(reg.get("vitareba.orangecat.ch"), 4011);
    assert.equal(reg.has("gone.orangecat.ch"), false);
  });

  it("routes hello@, postmaster@ and abuse@ of a registered host, and nothing else", () => {
    assert.deepEqual(routeFor(reg, "Hello@Skif.orangecat.ch"), {
      host: "skif.orangecat.ch",
      port: 4030,
    });
    assert.ok(routeFor(reg, "postmaster@vita.orangecat.ch"));
    assert.equal(routeFor(reg, "ceo@skif.orangecat.ch"), undefined);
    assert.equal(routeFor(reg, "hello@gmail.com"), undefined);
    assert.equal(routeFor(reg, "hello@gone.orangecat.ch"), undefined);
  });
});

describe("delivery backoff", () => {
  it("waits longer after each failure, and keeps the last interval", () => {
    assert.equal(nextAttemptAt(1, 0), BACKOFF_MINUTES[0]! * 60_000);
    assert.equal(nextAttemptAt(99, 0), BACKOFF_MINUTES.at(-1)! * 60_000);
  });
});

describe("gateway, end to end", () => {
  let smtp: SMTPServer;
  let smtpPort: number;
  let app: Server;
  let appPort: number;
  let spool: Spool;
  let appStatus = 200;
  const received: InboundMail[] = [];
  const refused: string[] = [];

  before(async () => {
    app = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const check = verifyInbound(body, req.headers[INBOUND_SIGNATURE_HEADER] as string, SECRET);
        if (!check.ok) {
          refused.push(check.error);
          res.writeHead(401).end();
          return;
        }
        if (appStatus === 200) received.push(check.mail);
        res.writeHead(appStatus).end();
      });
    });
    await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
    appPort = (app.address() as AddressInfo).port;
    const register = parseRegister(
      `skif|${appPort}|skif.orangecat.ch|/x|.|skif|bitbaum|product|live|-|-|-`,
    );
    spool = new Spool(mkdtempSync(join(tmpdir(), "mailgate-")));
    smtp = createGateway({
      register: () => register,
      spool,
      hostname: "mx.test",
      authenticateImpl: (async () => ({
        spf: { status: { result: "pass" } },
        dkim: { results: [{ status: { result: "pass" } }] },
        dmarc: { status: { result: "pass" } },
      })) as never,
    });
    await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
    smtpPort = (smtp.server.address() as AddressInfo).port;
  });

  after(() => {
    smtp.close();
    app.close();
  });

  const transport = () =>
    nodemailer.createTransport({
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
      ignoreTLS: true,
      tls: { rejectUnauthorized: false },
    });

  it("refuses a recipient that is not an app address, before reading any data", async () => {
    await assert.rejects(
      transport().sendMail({
        from: "a@example.org",
        to: "someone@gmail.com",
        subject: "relay?",
        text: "x",
      }),
      (e: { responseCode?: number }) => e.responseCode === 550,
    );
    assert.equal(spool.pending().length, 0);
  });

  it("accepts mail for hello@<app>, spools it, and delivers it signed to the app", async () => {
    await transport().sendMail({
      from: '"Anna" <anna@example.org>',
      to: "hello@skif.orangecat.ch",
      subject: "Walk home on Saturday?",
      html: "<p>Hi,<br>can someone walk me home from <b>Langstrasse</b>?</p>",
      attachments: [{ filename: "map.txt", content: "Langstrasse 10" }],
    });
    assert.equal(spool.pending().length, 1, "spooled before delivery");
    const result = await deliverDue(spool, { secret: SECRET });
    assert.deepEqual(result, { delivered: 1, failed: 0 });
    const mail = received[0]!;
    assert.equal(mail.to, "hello@skif.orangecat.ch");
    assert.deepEqual(mail.from, { address: "anna@example.org", name: "Anna" });
    assert.equal(mail.subject, "Walk home on Saturday?");
    assert.match(mail.text, /walk me home from Langstrasse/);
    assert.deepEqual(
      mail.attachments.map((a) => a.filename),
      ["map.txt"],
    );
    assert.deepEqual(mail.auth, { spf: "pass", dkim: "pass", dmarc: "pass" });
    assert.equal(spool.pending().length, 0, "moved to done");
  });

  it("keeps mail the app could not take, and retries it later", async () => {
    appStatus = 404;
    await transport().sendMail({
      from: "b@example.org",
      to: "hello@skif.orangecat.ch",
      subject: "second",
      text: "hello",
    });
    const now = Date.now();
    assert.deepEqual(await deliverDue(spool, { secret: SECRET }, now), { delivered: 0, failed: 1 });
    const [waiting] = spool.pending();
    assert.equal(waiting?.attempts, 1);
    assert.equal(waiting?.lastError, "HTTP 404");
    assert.deepEqual(
      await deliverDue(spool, { secret: SECRET }, now),
      { delivered: 0, failed: 0 },
      "not before its time",
    );
    appStatus = 200;
    assert.deepEqual(await deliverDue(spool, { secret: SECRET }, now + 2 * 60_000), {
      delivered: 1,
      failed: 0,
    });
    assert.equal(received.at(-1)?.subject, "second");
    assert.deepEqual(refused, [], "every delivery verified");
  });
});

it("prune drops delivered mail and its raw copy after the window, never undelivered mail", () => {
  const dir = mkdtempSync(join(tmpdir(), "spool-"));
  const spool = new Spool(dir);
  const entry = (id: string) => ({ mail: { id } as InboundMail, port: 1, attempts: 0, nextAt: 0 });
  for (const id of ["old-done", "old-pending", "new-done"]) {
    spool.saveRaw(id, Buffer.from("raw"));
    spool.put(entry(id));
  }
  spool.done("old-done");
  spool.done("new-done");
  const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  for (const f of [
    "done/old-done.json",
    "raw/old-done.eml",
    "raw/old-pending.eml",
    "pending/old-pending.json",
  ])
    utimesSync(join(dir, f), old, old);
  assert.equal(spool.prune(14), 2);
  assert.equal(existsSync(join(dir, "done/old-done.json")), false);
  assert.equal(existsSync(join(dir, "raw/old-done.eml")), false);
  assert.equal(existsSync(join(dir, "raw/old-pending.eml")), true);
  assert.equal(existsSync(join(dir, "pending/old-pending.json")), true);
  assert.equal(existsSync(join(dir, "done/new-done.json")), true);
});

it("reads every register that exists, so a site added on the box gets mail after the next deploy", () => {
  const dir = mkdtempSync(join(tmpdir(), "reg-"));
  writeFileSync(join(dir, "live.conf"), "skif|3999|skif.orangecat.ch|-|-|-|bitbaum|app|live\n");
  writeFileSync(
    join(dir, "installed.conf"),
    "heidi|3010|heidi.orangecat.ch|-|-|-|bitbaum|app|live\n",
  );
  const reg = loadRegister(
    `${join(dir, "missing.conf")}:${join(dir, "live.conf")}:${join(dir, "installed.conf")}`,
  );
  assert.equal(reg.get("skif.orangecat.ch"), 3999);
  assert.equal(reg.get("heidi.orangecat.ch"), 3010);
  assert.throws(() => loadRegister(join(dir, "missing.conf")), /no register found/);
});
