/**
 * The plain shell: who may reach it, what may name it, how it locks, and that
 * a real bash round-trips through the runner's owned PTY.
 * Run: npx tsx scripts/test/plain-shell.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHELL_IDLE_MS,
  SHELL_MAX_OPEN,
  SHELL_UNLOCK_MAX_MS,
  isShellTab,
  runnerOffersShell,
  shellCommandRefusal,
  shellTabFromHex,
  decideShellAccess,
} from "../../src/lib/shell-session";
import {
  checkShellUnlock,
  createShellUnlock,
  shellUnlockNeedsTouch,
  touchShellUnlock,
} from "../../src/lib/shell-unlock-token";
import { agentEnvironment } from "../../src/lib/agent-execution/agent-env";
import { validateCommand } from "../../desktop/src/main/command-validator";
import { enableTabMemory, rememberTab, restoreTabs } from "../../desktop/src/main/tab-memory";

process.env.AUTH_SECRET = "test-secret-for-shell-unlock";

// ── The tab's name ───────────────────────────────────────────────────────────
const tab = shellTabFromHex("a1b2c3d4");
assert.equal(tab, "loki-shell-a1b2c3d4");
assert.equal(isShellTab(tab), true);
for (const not of [
  "loki",
  "loki-shell-",
  "loki-shell-xyz12345",
  "loki-shell-a1b2c3d4~x",
  "shell-a1b2c3d4",
  "",
])
  assert.equal(isShellTab(not), false, `${not} is not a shell`);
assert.throws(() => shellTabFromHex("nothex!!"));

// ── Who may: the operator, with a PIN, unlocked. Anyone else gets 403. ───────
const ok = { isOperator: true, pinConfigured: true, unlock: "ok" as const };
assert.deepEqual(decideShellAccess(ok, true), { ok: true });
const notOperator = decideShellAccess({ ...ok, isOperator: false }, true);
assert.equal(notOperator.ok, false);
if (!notOperator.ok) {
  assert.equal(notOperator.status, 403, "a non-operator is refused with 403");
  assert.equal(notOperator.code, "not-operator");
}
// Not being the operator wins over everything else, even a valid unlock.
assert.equal(
  decideShellAccess({ isOperator: false, pinConfigured: false, unlock: "ok" }, false).ok,
  false,
);
const noPin = decideShellAccess({ ...ok, pinConfigured: false }, false);
assert.ok(!noPin.ok && noPin.code === "pin-required", "no PIN set means no shell, not an open one");
for (const state of ["idle", "expired", "invalid"] as const) {
  const locked = decideShellAccess({ ...ok, unlock: state }, true);
  assert.ok(!locked.ok && locked.code === "locked" && locked.status === 403, `${state} is locked`);
}
assert.equal(
  decideShellAccess({ ...ok, unlock: "idle" }, false).ok,
  true,
  "closing works while locked",
);

// ── The unlock: idle 10 minutes, 60 at most, bound to the account ────────────
const t0 = 1_000_000_000_000;
const token = createShellUnlock("user-1", t0);
assert.equal(checkShellUnlock(token, "user-1", t0 + 1000), "ok");
assert.equal(
  checkShellUnlock(token, "user-2", t0 + 1000),
  "invalid",
  "another account's cookie is nothing",
);
assert.equal(checkShellUnlock(token, "user-1", t0 + SHELL_IDLE_MS + 1), "idle");
assert.equal(
  checkShellUnlock(token.replace("user-1", "user-9"), "user-9", t0),
  "invalid",
  "re-labelled",
);
const [u, i, a, sig] = token.split(":");
assert.equal(
  checkShellUnlock(`${u}:${i}:${Number(a) + 5}:${sig}`, "user-1", t0 + 10),
  "invalid",
  "tampered",
);
assert.equal(checkShellUnlock("", "user-1"), "invalid");
// Typing keeps it open; it still ends at the cap.
let live = token;
for (let m = 1; m <= 9; m++) {
  const next = touchShellUnlock(live, "user-1", t0 + m * 9 * 60_000);
  if (m * 9 * 60_000 > SHELL_UNLOCK_MAX_MS) assert.equal(next, null);
  else assert.ok(next, `active at ${m * 9} minutes stays unlocked`);
  if (next) live = next;
}
assert.equal(checkShellUnlock(live, "user-1", t0 + SHELL_UNLOCK_MAX_MS + 60_000), "expired");
assert.equal(
  touchShellUnlock(token, "user-1", t0 + SHELL_IDLE_MS + 1),
  null,
  "an idle unlock cannot be revived",
);
assert.equal(shellUnlockNeedsTouch(token, t0 + 1000), false);
assert.equal(shellUnlockNeedsTouch(token, t0 + 61_000), true);
// A private-zone cookie (different payload, same secret) is not a shell unlock.
assert.equal(checkShellUnlock(`user-1:${t0 + 100000}:deadbeef`, "user-1", t0), "invalid");

// ── The queue and the runner refuse anything but open/close/peek on a shell ──
for (const type of [
  "inject",
  "dispatch",
  "switch_agent",
  "launch_agent",
  "auto_continue",
  "peek_tab",
])
  assert.match(
    shellCommandRefusal(type, { tab }) ?? "",
    /cannot target a shell tab/,
    `${type} is refused`,
  );
for (const type of ["open_shell", "close_tab", "peek_start", "peek_stop"])
  assert.equal(shellCommandRefusal(type, { tab }), null, `${type} is allowed`);
assert.ok(
  shellCommandRefusal("open_shell", { tab: "truthseeker" }),
  "open_shell must name a shell tab",
);
assert.equal(shellCommandRefusal("inject", { tab: "truthseeker" }), null, "projects are untouched");

assert.equal(validateCommand({ type: "open_shell", payload: { tab } }).ok, true);
assert.equal(validateCommand({ type: "open_shell", payload: { tab: "truthseeker" } }).ok, false);
assert.equal(validateCommand({ type: "close_tab", payload: { tab } }).ok, true);
const injected = validateCommand({ type: "inject", payload: { tab, prompt: "rm -rf /" } });
assert.ok(!injected.ok && /cannot target a shell tab/.test(injected.error));
const dispatched = validateCommand({
  type: "dispatch",
  payload: { tab, dir: "/", agent: "claude", prompt: "x" },
});
assert.equal(dispatched.ok, false);

// ── The runner's switches ────────────────────────────────────────────────────
assert.equal(runnerOffersShell({}), true);
assert.equal(runnerOffersShell({ LOKI_SHELL: "off" }), false, "the kill switch");
assert.equal(runnerOffersShell({ LOKI_EXECUTOR: "sandbox" }), false, "sealed builders offer none");
const unit = readFileSync("scripts/hetzner/loki-box-runner@.service", "utf8");
assert.match(unit, /Environment=LOKI_SHELL=off/, "a tenant's unit never offers a shell");

// ── The environment: a shell's, with no engine keys ──────────────────────────
const box = {
  LOKI_AGENT_ENV: "allowlist",
  PATH: "/usr/bin",
  HOME: "/home/ubuntu",
  DATABASE_URL: "postgres://secret",
  ANTHROPIC_API_KEY: "sk-ant",
  GITHUB_TOKEN: "ghp",
};
const shellEnv = agentEnvironment(box, undefined, { plainShell: true });
assert.equal(shellEnv.PATH, "/usr/bin");
for (const secret of ["DATABASE_URL", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"])
  assert.equal(shellEnv[secret], undefined, `${secret} never reaches a shell`);
assert.equal(agentEnvironment(box, undefined).ANTHROPIC_API_KEY, "sk-ant", "agents keep theirs");

// ── Restart: a remembered shell comes back as a shell ────────────────────────
const memory = join(mkdtempSync(join(tmpdir(), "shell-mem-")), "open-tabs.json");
enableTabMemory(memory);
rememberTab({ tab, dir: tmpdir(), agent: "shell" });
const relaunched: string[] = [];
async function main() {
  await restoreTabs({
    isLive: () => false,
    launch: async (t, _d, agent) => void relaunched.push(`${t}:${agent}`),
    sessionFor: async () => null,
  });
  assert.deepEqual(relaunched, [`${tab}:shell`]);

  // ── A real bash, through the runner's owned PTY ──────────────────────────────
  process.env.LOKI_RUNNER_PRESENCE_CHANNEL = "local";
  process.env.LOKI_SHELL_DIR = tmpdir();
  const { executor } = await import("../../src/lib/agent-execution");
  const { openShellPty, openShellCount } = await import("../../desktop/src/main/shell-runtime");
  const { writeRawKey, injectPty, terminatePty, runnerWorkspaceId } =
    await import("../../desktop/src/main/pty-runtime");
  const waitFor = async (id: string, needle: string, ms = 8000) => {
    let seen = "";
    const unsub = executor.subscribe(id, 0, (e) => {
      if (e.kind === "output" && e.data) seen += e.data;
    });
    const end = Date.now() + ms;
    while (!seen.includes(needle) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    unsub();
    return seen.includes(needle);
  };
  await openShellPty(tab);
  assert.equal(openShellCount(), 1);
  const id = runnerWorkspaceId(tab);
  writeRawKey(tab, "echo hi-$((40+2))\r");
  assert.ok(await waitFor(id, "hi-42"), "a command round-trips: echo hi-42 comes back");
  assert.throws(
    () => injectPty(tab, "echo nope"),
    /refusing to inject/,
    "prompts never reach a shell",
  );
  // Ctrl-C reaches the shell and the prompt is back.
  writeRawKey(tab, "sleep 30\r");
  await new Promise((r) => setTimeout(r, 300));
  writeRawKey(tab, "\x03");
  writeRawKey(tab, "echo back-$((1+1))\r");
  assert.ok(await waitFor(id, "back-2"), "Ctrl-C interrupts and the shell carries on");
  // The cap: SHELL_MAX_OPEN, then a refusal.
  for (let n = 1; n < SHELL_MAX_OPEN; n++) await openShellPty(shellTabFromHex(`0000000${n}`));
  assert.equal(openShellCount(), SHELL_MAX_OPEN);
  await assert.rejects(openShellPty(shellTabFromHex("00000099")), /shells are already open/);
  await assert.rejects(openShellPty("truthseeker"), /not a shell tab/);
  // Ctrl-D ends the shell; closing the rest cleans up.
  writeRawKey(tab, "\x04");
  for (const t of ["00000001", "00000002"]) await terminatePty(shellTabFromHex(t));
  await terminatePty(tab);
  assert.equal(openShellCount(), 0);

  console.log(
    "✓ plain-shell: operator-only, PIN-locked, queue-guarded, and a real bash round-trips",
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
