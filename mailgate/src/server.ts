/**
 * loki-mailgate: receive mail for every app host on the box and deliver it to
 * the app. See ../README.md and the fleet's docs/engineering/email.md.
 *
 * Env:
 *   MAILGATE_PORT        SMTP port to listen on (default 25)
 *   MAILGATE_HOST        bind address (default 0.0.0.0)
 *   MAILGATE_HOSTNAME    this server's name (default mx.orangecat.ch)
 *   MAILGATE_REGISTER    app registers, colon-separated; every one that exists is read
 *                        (default: Loki's live copy, then the one installed beside the gateway)
 *   MAILGATE_EXTRA_HOSTS more rows in register format, for services not in it
 *   MAILGATE_SPOOL       spool directory (default /opt/mailgate/spool)
 *   MAILGATE_TLS_KEY / MAILGATE_TLS_CERT   PEM paths for STARTTLS (optional)
 *   MAILGATE_KEEP_DAYS   days the gateway keeps delivered mail (default 14)
 *   MAIL_INBOUND_SECRET  signs deliveries (a fleet key, /opt/fleet/env)
 */
import { readFileSync } from "node:fs";
import { deliverDue } from "./deliver.js";
import { createGateway } from "./gateway.js";
import { loadRegister, type Register } from "./register.js";
import { Spool } from "./spool.js";

const env = process.env;
const secret = env.MAIL_INBOUND_SECRET ?? "";
if (!secret) {
  console.error(
    "[mailgate] MAIL_INBOUND_SECRET is not set; refusing to start (apps could not verify deliveries)",
  );
  process.exit(1);
}
const registerPath =
  env.MAILGATE_REGISTER ?? "/opt/loki/app/scripts/hetzner/apps.conf:/opt/mailgate/apps.conf";
const extra = (env.MAILGATE_EXTRA_HOSTS ?? "").replace(/;/g, "\n");
let register: Register = loadRegister(registerPath, extra);
// The register changes when a site is added; re-read it every minute.
setInterval(() => {
  try {
    register = loadRegister(registerPath, extra);
  } catch (error) {
    console.error(
      "[mailgate] register unreadable, keeping the last one:",
      error instanceof Error ? error.message : error,
    );
  }
}, 60_000).unref();

const spool = new Spool(env.MAILGATE_SPOOL ?? "/opt/mailgate/spool");
const tls =
  env.MAILGATE_TLS_KEY && env.MAILGATE_TLS_CERT
    ? { key: readFileSync(env.MAILGATE_TLS_KEY), cert: readFileSync(env.MAILGATE_TLS_CERT) }
    : undefined;

let delivering = false;
async function pass(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    const { delivered, failed } = await deliverDue(spool, { secret });
    if (delivered || failed) console.log(`[mailgate] delivered ${delivered}, will retry ${failed}`);
  } finally {
    delivering = false;
  }
}

const server = createGateway({
  register: () => register,
  spool,
  hostname: env.MAILGATE_HOSTNAME ?? "mx.orangecat.ch",
  ...(tls ? { tls } : {}),
  onAccepted: () => void pass(),
});
server.on("error", (error) => console.error("[mailgate] smtp error:", error.message));
const port = Number(env.MAILGATE_PORT ?? 25);
server.listen(port, env.MAILGATE_HOST ?? "0.0.0.0", () => {
  console.log(`[mailgate] receiving for ${register.size} hosts on :${port}`);
});
setInterval(() => void pass(), 30_000).unref();
void pass();

// Delivered mail belongs to the app now; the gateway's copy goes after a while.
const keepDays = Number(env.MAILGATE_KEEP_DAYS ?? 14);
const prune = () => {
  try {
    const removed = spool.prune(keepDays);
    if (removed)
      console.log(`[mailgate] pruned ${removed} delivered files older than ${keepDays} days`);
  } catch (error) {
    console.error("[mailgate] prune failed:", error instanceof Error ? error.message : error);
  }
};
setInterval(prune, 60 * 60_000).unref();
prune();

for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, () => server.close(() => process.exit(0)));
