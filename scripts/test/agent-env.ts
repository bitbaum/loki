/**
 * An agent on the box gets a shell's environment and its own engine key —
 * never the runner's database password or the org GitHub token. Off the box
 * (no LOKI_AGENT_ENV) nothing changes: the laptop runner keeps inheriting.
 * Run: npx tsx scripts/test/agent-env.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentEnvironment, agentEnvAllowlisted } from "../../src/lib/agent-execution/agent-env";

const box = {
  LOKI_AGENT_ENV: "allowlist",
  PATH: "/home/lk-a/.local/bin:/usr/bin",
  HOME: "/home/lk-a",
  USER: "lk-a",
  SHELL: "/bin/bash",
  TERM: "xterm-color",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  DATABASE_URL: "postgres://loki:secret@localhost/loki",
  DATABASE_POOL_URL: "postgres://loki:secret@localhost/loki",
  GITHUB_TOKEN: "ghp_org",
  LOKI_WEB_URL: "https://loki.orangecat.ch",
  LOKI_RUNNER_PRESENCE_CHANNEL: "cloud",
  ANTHROPIC_API_KEY: "sk-ant-tenant",
  EMBEDDINGS_BASE_URL: "http://localhost:11434",
};

assert.equal(agentEnvAllowlisted(box), true);
const env = agentEnvironment(box, { GH_TOKEN: "ghs_run", GITHUB_TOKEN: "ghs_run" });
for (const secret of ["DATABASE_URL", "DATABASE_POOL_URL", "LOKI_WEB_URL", "EMBEDDINGS_BASE_URL"])
  assert.equal(env[secret], undefined, `${secret} never reaches an agent`);
assert.equal(env.GITHUB_TOKEN, "ghs_run", "the run's own repository token, not the org's");
assert.equal(env.GH_TOKEN, "ghs_run");
assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-tenant", "the tenant's own engine key travels");
for (const name of ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL"])
  assert.equal(env[name], box[name as keyof typeof box], `${name} is what a shell needs`);
assert.equal(
  agentEnvironment(
    {
      ...box,
      LOKI_AGENT_ENV_EXTRA: "PLAYWRIGHT_BROWSERS_PATH, HTTPS_PROXY",
      PLAYWRIGHT_BROWSERS_PATH: "/opt/pw",
    },
    undefined,
  ).PLAYWRIGHT_BROWSERS_PATH,
  "/opt/pw",
  "a box may name extras",
);

// Off the box: today's behaviour, untouched.
const laptop = {
  PATH: "/usr/bin",
  HOME: "/home/g",
  SSH_AUTH_SOCK: "/tmp/agent",
  DATABASE_URL: "x",
};
assert.equal(agentEnvAllowlisted(laptop), false);
assert.deepEqual(agentEnvironment(laptop, { A: "1" }), { ...laptop, A: "1" });

// The box units switch it on; the executor reads it.
assert.match(
  readFileSync("scripts/hetzner/install-box-runner.sh", "utf8"),
  /^Environment=LOKI_AGENT_ENV=allowlist$/m,
  "the box-runner unit allowlists the agent environment",
);
assert.match(
  readFileSync("src/lib/agent-execution/local-pty.ts", "utf8"),
  /env: agentEnvironment\(process\.env, spec\.env, \{ plainShell: spec\.plainShell \}\)/,
  "the one place a PTY is born reads it",
);

console.log("✓ agent-env: a shell, the tenant's engine, the run's token — nothing else");
