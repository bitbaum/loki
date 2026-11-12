// Discover-and-run every pure unit test under scripts/test/*.ts in parallel.
//
// Why this exists: the ~30 test:* scripts were wired one-by-one into ci.yml /
// pre-push, so only ~12 ran automatically and a newly-added test:* was born
// dead (never run by CI). This runner globs the directory, so any new pure
// test is picked up for free. Infra-dependent tests are explicitly skipped
// (with a reason) — they run where their infra exists, not in this suite.
//
// Environment-independent by construction: every test listed here passes with
// NO DATABASE_URL and no running server (verified), so it behaves identically
// on a laptop and in CI. Run: npx tsx scripts/test-unit.ts
import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawn, spawnSync } from "child_process";
import { testEnv } from "./test/lib/test-env";

// A hook run from a linked worktree exports an absolute GIT_DIR (and its
// index and work tree). Every test inherits this environment, and an absolute
// GIT_DIR overrides `git -C <sandbox>`: a test's throwaway repository becomes
// the real one. It has happened twice (worktree-workspace.ts, then
// dispatch-launch-dir.ts on 2026-11-12: a test@test commit on the branch being
// pushed and `core.bare = true` in the real config). Cleared once, here, so a
// new test with a git fixture is safe without knowing this. A test that reads
// the real repository finds it from its working directory, as it always did.
for (const k of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
]) {
  delete process.env[k];
}

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_DIR = join(SCRIPTS_DIR, "test");
// Invoke the local tsx binary directly (not `npx tsx`): npx adds resolution
// overhead and a second esbuild service per child, which thrashes esbuild on a
// 2-core box. .bin/tsx is one process per test.
const TSX_BIN = join(SCRIPTS_DIR, "..", "node_modules", ".bin", "tsx");

// Files under scripts/test/ that are NOT part of the pure suite. Keep the
// reason — this list is the honest boundary between unit tests and the ones
// that need real infra (they stay wired where that infra is available).
const SKIP: Record<string, string> = {
  "print-session-token.ts": "helper — prints a token, not a test",
  "print-private-zone-cookie.ts": "helper — prints the private-zone unlock, not a test",
  "authenticated-smoke.ts": "needs a running server + LOKI_SESSION_TOKEN (pre-push/prod dogfood)",
  "loki-loop-e2e.ts":
    "end-to-end against a real deployment + LOKI_SESSION_TOKEN (pnpm run test:e2e:loki)",
  "rag-retrieval.ts": "needs EMBEDDINGS_BASE_URL (fastembed service)",
  "lane-and-reaper.ts":
    "needs a real Postgres it may write to (TEST_DATABASE_URL, or CI) — runs in CI as `pnpm run test:db` after the migrate step",
  "token-scope.ts":
    "needs a real Postgres it may write to (TEST_DATABASE_URL, or CI) — runs in CI as `pnpm run test:db` after the migrate step",
  // push-notifications.ts was here, excluded as "needs push/web-push env —
  // run manually". It never needed env: every check is a static file read. It
  // was failing because scripts/agent-hook-bridge.sh was deleted on 2026-06-11
  // (956ccf64), and the skip entry gave a reason that was never the real one —
  // so the failure looked accounted for and nobody looked for three months.
  // A wrong skip reason is worse than no skip: it answers the question that
  // would have found the bug.
  "inject-prompt.ts": "needs a live DB (only passes locally via .env.local)",
  "verify-project-brief.ts": "needs a live DB + Groq API (network + GROQ_API_KEY)",
};

/**
 * Tests that are skipped ONLY while their prerequisite is absent, rather than
 * skipped forever.
 *
 * The difference matters. An entry in SKIP above is a permanent exclusion, and
 * six of them had quietly become "this path is verified by nobody": the
 * entitlement suite — signature verification, actor lookup, grant writes,
 * dedupe, expiry — is the billing boundary, and it had never once run in CI.
 * It does not need a SEEDED database, only a migrated one, which CI can now
 * provide (see .github/workflows/ci.yml). So it runs wherever DATABASE_URL
 * exists and steps aside politely where it does not, instead of being
 * excluded on every machine forever because some machines lack a database.
 */
const SKIP_UNLESS_ENV: Record<string, string> = {
  "orangecat-entitlement-e2e.ts": "DATABASE_URL",
  "studio-portal-e2e.ts": "DATABASE_URL",
  "build-requests-e2e.ts": "DATABASE_URL",
  // A running Loki on AccountKit, pointed at on purpose (it creates people).
  "accountkit-screens-browser.ts": "LOKI_SCREENS_BASE_URL",
};

for (const [file, envVar] of Object.entries(SKIP_UNLESS_ENV)) {
  if (!process.env[envVar]) {
    SKIP[file] = `needs ${envVar} — runs in CI against the migrated service DB`;
  }
}

/**
 * The terminal tests (executor, sandbox-executor, plain-shell, …) drive a real
 * PTY through node-pty, whose native binary is built where `pnpm install` ran.
 * An agent sandbox that shares the box's node_modules but has an older glibc
 * cannot load it ("GLIBC_2.42 not found"), so on 2026-11-12 every push from
 * there failed five tests that no change could fix — and the only way out the
 * hook offers is --no-verify, which also skips everything that DID run.
 *
 * So, off CI only: when node-pty cannot load on this machine, a test that
 * fails with exactly that load error is reported as skipped, with the reason.
 * Any other failure in the same file still fails. CI loads node-pty and never
 * takes this path; its run is the gate.
 */
const PTY_LOAD_FAILURE = "Failed to load native module: pty.node";
const PTY_UNLOADABLE = process.env.CI ? null : nodePtyLoadError();

function nodePtyLoadError(): string | null {
  const root = join(SCRIPTS_DIR, "..");
  const probe = spawnSync(process.execPath, ["-e", 'require("node-pty")'], {
    cwd: root,
    encoding: "utf8",
  });
  // Only node-pty's own load failure counts. Anything else (a missing
  // package, a broken probe) leaves the PTY tests to run and fail loudly.
  if (probe.status === 0 || !probe.stderr.includes(PTY_LOAD_FAILURE)) return null;
  // The loader names only the LAST path it tried (a prebuild that does not
  // exist on Linux); dlopen the built binary to name the real cause.
  let cause = "node-pty's native binary does not load";
  try {
    const built = join(
      dirname(createRequire(join(root, "package.json")).resolve("node-pty")),
      "..",
      "build",
      "Release",
      "pty.node",
    );
    const open = spawnSync(
      process.execPath,
      [
        "-e",
        "try { process.dlopen({ exports: {} }, process.argv[1]) } catch (e) { console.log(e.message) }",
        built,
      ],
      { encoding: "utf8" },
    );
    const why = /version `GLIBC_[\d.]+' not found/.exec(open.stdout)?.[0] ?? open.stdout.trim();
    if (why) cause = why;
  } catch {
    // keep the general cause
  }
  return cause;
}

if (PTY_UNLOADABLE) {
  console.log(`↷ node-pty does not load on this machine: ${PTY_UNLOADABLE}`);
  console.log("    tests that fail only on that are reported as skipped; CI runs them\n");
}

const MAX_PARALLEL = Number(process.env.TEST_UNIT_PARALLEL ?? 2);

const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".ts") && !(f in SKIP))
  .sort();

const skipped = Object.entries(SKIP);
if (skipped.length) {
  console.log(`↷ skipping ${skipped.length} infra-dependent test(s):`);
  for (const [f, why] of skipped) console.log(`    ${f} — ${why}`);
}
console.log(`→ running ${files.length} unit tests (parallel ${MAX_PARALLEL})\n`);

const runner = existsSync(TSX_BIN) ? TSX_BIN : "npx";
const baseArgs = existsSync(TSX_BIN) ? [] : ["tsx"];

/**
 * A test that never exits must be a FAILURE, not a wait.
 *
 * Measured 2026-09-20: groq-chain-fallback.ts finished its assertions in two
 * seconds, printed its ✓, and then held the job open for FIFTY-SIX MINUTES.
 * Its last case drives the vendor-refusal path, which fire-and-forgets a quota
 * write; that lazily imports `@/db`, which opens a postgres pool nothing ever
 * closes. Locally there is no DATABASE_URL, so the import rejects and the
 * process exits — the hang appears only in CI, where a database exists.
 *
 * Without a cap, one such file sets the runtime of the whole suite, and it
 * reads as "CI is slow" rather than "a test is broken". A per-file deadline
 * turns fifty-six silent minutes into one named red line.
 *
 * The kill is SIGKILL after a SIGTERM grace: the wedged process is holding an
 * open socket, and a handler that politely waits for it would hang too.
 */
const FILE_TIMEOUT_MS = Number(process.env.UNIT_TEST_TIMEOUT_MS ?? 120_000);
/** How much of a failed file's output is shown: enough for an assertion and its stack. */
const FAIL_TAIL_LINES = 40;

type Result = { file: string; ok: boolean; tail: string; skipped?: string };

/** Every test runs with no pointer to a real repository (lib/test-env.ts). */
const CHILD_ENV = testEnv();

function run(file: string): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(runner, [...baseArgs, join(TEST_DIR, file)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: CHILD_ENV,
    });
    let out = "";
    let settled = false;
    const finish = (r: Result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish({
        file,
        ok: false,
        tail:
          `TIMED OUT after ${FILE_TIMEOUT_MS}ms — the process did not exit. ` +
          `Assertions may all have passed; something is holding the event loop open ` +
          `(an unclosed database pool from a fire-and-forget write is the usual cause). ` +
          `End the file with process.exit(0), as the other database-touching tests do.`,
      });
    }, FILE_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => finish({ file, ok: false, tail: `spawn error: ${err.message}` }));
    child.on("close", (code) => {
      // The end of what the file printed, not its last line. An uncaught
      // assertion ends in its stack and a closing brace, so one line was
      // "    }": CI named terminal-idle-browser as failed three times on
      // 2026-11-11 and never once said why.
      const tail = out.trim().split("\n").slice(-FAIL_TAIL_LINES).join("\n    ");
      if (code !== 0 && PTY_UNLOADABLE && out.includes(PTY_LOAD_FAILURE)) {
        finish({ file, ok: true, tail, skipped: "needs node-pty, which does not load here" });
        return;
      }
      finish({ file, ok: code === 0, tail });
    });
  });
}

// No top-level await: tsx transforms this file to CJS (no "type":"module"),
// which rejects top-level await. Orchestrate inside an async main() instead.
async function main(): Promise<number> {
  const results: Result[] = [];
  const queue = [...files];
  async function worker() {
    let f: string | undefined;
    while ((f = queue.shift())) {
      const r = await run(f);
      results.push(r);
      const name = r.file.replace(/\.ts$/, "");
      console.log(
        r.skipped
          ? `↷ ${name} — ${r.skipped}`
          : `${r.ok ? "✓" : "✗"} ${name}${r.ok ? "" : `\n    ${r.tail}`}`,
      );
    }
  }
  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
  const failed = results.filter((r) => !r.ok);
  const notRun = results.filter((r) => r.skipped);
  const ran = results.length - notRun.length;
  console.log(
    `\n${ran - failed.length}/${ran} unit test files passed` +
      (notRun.length ? `, ${notRun.length} skipped here (node-pty does not load)` : ""),
  );
  if (failed.length) console.error(`✗ failed: ${failed.map((r) => r.file).join(", ")}`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code));
