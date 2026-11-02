/**
 * The self-only Telegram allowlist, enforced at the send boundary.
 *
 * WHAT THIS PINS
 *
 * `isAllowedTelegramTarget` existed with NO caller, while
 * `sendTelegramMessage`'s own docblock said "the caller is responsible for the
 * self-only allowlist check BEFORE calling this". Eight call sites, zero
 * checks. Nothing leaked — but only by accident: every caller happened to pass
 * `selfTelegramTarget()`, so the blast radius was bounded by coincidence
 * rather than by the guard written to bound it. The first flow that let a
 * recipient be requested would have inherited an unguarded send to an
 * arbitrary chat. A rule that lives in a docblock is a rule nobody runs.
 *
 * The check now sits inside the send, so a wrong recipient is refused by
 * construction.
 *
 * HOW IT RUNS. The module reads TELEGRAM_CHAT_ID through @/lib/constants at
 * IMPORT time, so the two configurations (self target set / unset) cannot be
 * exercised in one process. Each runs in a child with its own env — the same
 * shape as activity-time-zone-stable.ts, and for the same reason: a static
 * import, because tsx transforms this to CJS and cannot `await import`
 * (ERR_REQUIRE_ASYNC_MODULE).
 *
 * No network. TELEGRAM_BOT_TOKEN is deliberately unset in the children, so a
 * send that REACHES the transport fails on the missing token — which is what
 * distinguishes "refused by the allowlist" from "attempted".
 *
 * Run: npx tsx scripts/test/telegram-allowlist.ts
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAllowedTelegramTarget,
  selfTelegramTarget,
  sendTelegramMessage,
} from "../../src/lib/actions/telegram-send";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const SELF_FILE = fileURLToPath(import.meta.url);

const SELF = "424242";
const OTHER = "999999";

// ── Child mode: report what this configuration does ──────────────────────────
if (process.env.__TG_PROBE === "1") {
  const BUTTON = { text: "Open", url: "https://loki.orangecat.ch/" };
  const run = async () => {
    const out = {
      self: selfTelegramTarget(),
      allowSelf: isAllowedTelegramTarget(SELF),
      allowEmpty: isAllowedTelegramTarget(""),
      allowPadded: isAllowedTelegramTarget(`  ${SELF}  `),
      allowOther: isAllowedTelegramTarget(OTHER),
      allowChannel: isAllowedTelegramTarget("@somechannel"),
      sendOther: (await sendTelegramMessage(OTHER, "x")).error ?? "",
      sendChannel: (await sendTelegramMessage("@somechannel", "x")).error ?? "",
      sendSelf: (await sendTelegramMessage(SELF, "x", { buttons: [[BUTTON]] })).error ?? "",
      sendSelfNoButton: (await sendTelegramMessage(SELF, "x")).error ?? "",
    };
    console.log(JSON.stringify(out));
  };
  void run().then(() => process.exit(0));
} else {
  let pass = 0;
  let fail = 0;
  function ok(cond: boolean, label: string) {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  ✗ ${label}`);
    }
  }

  function probe(env: Record<string, string | undefined>) {
    const childEnv: Record<string, string> = { __TG_PROBE: "1" };
    for (const [k, v] of Object.entries({ ...process.env, ...env })) {
      if (v !== undefined) childEnv[k] = v;
    }
    // Deleting has to happen after the spread, or the parent's value returns.
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k];

    const res = spawnSync(join(repoRoot, "node_modules/.bin/tsx"), [SELF_FILE], {
      env: childEnv,
      encoding: "utf8",
      cwd: repoRoot,
    });
    if (res.status !== 0) {
      console.error(`  ✗ probe failed: ${(res.stderr || "").slice(0, 400)}`);
      process.exit(1);
    }
    return JSON.parse(res.stdout.trim().split("\n").pop() ?? "{}");
  }

  // The constant is envAlias("TELEGRAM_CHAT_ID"), which reads APP_ /
  // LOKI_ / COCKPIT_ prefixed names and NEVER the bare one. Setting
  // TELEGRAM_CHAT_ID here would configure nothing and the "configured" probe
  // would silently test the unconfigured path — which is exactly what the
  // first version of this test did.
  const CHAT_KEYS = ["APP_TELEGRAM_CHAT_ID", "LOKI_TELEGRAM_CHAT_ID", "COCKPIT_TELEGRAM_CHAT_ID"];
  const cleared = Object.fromEntries(CHAT_KEYS.map((k) => [k, undefined]));

  // ── Configured: the operator has a chat id ─────────────────────────────────
  const on = probe({ ...cleared, APP_TELEGRAM_CHAT_ID: SELF, TELEGRAM_BOT_TOKEN: undefined });

  ok(on.self === SELF, "self target comes from the APP_TELEGRAM_CHAT_ID alias");
  ok(on.allowSelf === true, "the operator's own chat is allowed");
  ok(on.allowEmpty === true, "empty means default-to-self, which is allowed");
  ok(on.allowPadded === true, "whitespace around the self id still matches");
  ok(on.allowOther === false, "someone else's chat id is refused");
  ok(on.allowChannel === false, "a channel handle is refused");

  // The boundary. Without the guard these fall through to the transport and
  // report the missing token, so the ERROR TEXT is what proves where it stopped.
  ok(
    /allowlist/i.test(on.sendOther),
    `a send to another chat names the allowlist (${on.sendOther})`,
  );
  ok(/allowlist/i.test(on.sendChannel), `a channel send names the allowlist (${on.sendChannel})`);
  ok(
    /TELEGRAM_BOT_TOKEN/.test(on.sendSelf),
    `an ALLOWED recipient gets past the guard to the transport (${on.sendSelf})`,
  );
  ok(
    /not actionable/.test(on.sendSelfNoButton),
    `a message with no button is refused before the transport (${on.sendSelfNoButton})`,
  );

  // ── Unconfigured: fail closed, never guess a destination ───────────────────
  const off = probe({ ...cleared, TELEGRAM_BOT_TOKEN: undefined });

  ok(off.self === null, "no TELEGRAM_CHAT_ID means no self target");
  ok(off.allowEmpty === false, "with no target configured, even empty is refused");
  ok(off.allowSelf === false, "…and so is the id that used to be self");
  ok(/allowlist/i.test(off.sendSelf), "fail-closed: every send is refused, not guessed");

  // ── The obligation must not drift back into prose ──────────────────────────
  const src = readFileSync(join(repoRoot, "src/lib/actions/telegram-send.ts"), "utf8");
  const sendBody = src.slice(src.indexOf("export async function sendTelegramMessage"));
  ok(
    /isAllowedTelegramTarget\(/.test(sendBody),
    "sendTelegramMessage calls the guard itself — not a docblock asking callers to",
  );
  ok(
    !/caller is responsible for the self-only allowlist/i.test(src),
    "the old caller-obligation wording is gone, so nobody re-learns the wrong contract",
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
