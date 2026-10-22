import os from "node:os";
import path from "node:path";
import {
  assertSandboxCwdAllowed,
  buildDockerRunArgs,
  resolveSandboxConfig,
  sandboxContainerName,
  sealedGitEnv,
  SandboxExecutor,
  type SandboxExecutorConfig,
} from "../../src/lib/agent-execution/sandbox";
import type { AgentEvent } from "../../src/lib/agent-execution/types";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures += 1;
}

const root = path.join(os.tmpdir(), "fc-sandbox-root");
const cwd = path.join(root, "tenant-a", "repo");

const config: SandboxExecutorConfig = {
  runtime: "docker",
  image: "ubuntu:24.04",
  workspaceRoot: root,
  network: "none",
  cpus: "1",
  memory: "512m",
  pidsLimit: "128",
  user: "current",
  mountMode: "rw",
  extraRunArgs: [],
  ociRuntime: null,
  home: path.join(root, "tenant-a"),
};

function hasPair(args: string[], key: string, value: string): boolean {
  return args.some((arg, i) => arg === key && args[i + 1] === value);
}

async function optionalDockerSmoke() {
  if (process.env.LOKI_TEST_DOCKER_SANDBOX !== "true") return;
  const fs = await import("node:fs");
  fs.mkdirSync(cwd, { recursive: true });
  const executor = new SandboxExecutor({
    ...config,
    image: process.env.LOKI_TEST_DOCKER_IMAGE || "ubuntu:24.04",
  });
  const events: AgentEvent[] = [];
  const id = "test:sandbox-smoke";
  await executor.provision({
    id,
    cwd,
    command: "bash",
    args: ["-lc", "echo SANDBOX_OK; sleep 0.2"],
  });
  executor.subscribe(id, 0, (e) => events.push(e));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !events.some((e) => e.kind === "exit")) {
    await new Promise((r) => setTimeout(r, 100));
  }
  check(
    "optional docker smoke emits command output",
    events.some((e) => e.kind === "output" && e.data?.includes("SANDBOX_OK")),
  );
  check(
    "optional docker smoke exits",
    events.some((e) => e.kind === "exit"),
  );
  await executor.terminate(id);
}

async function main() {
  const name = sandboxContainerName("user:Project With Spaces");
  check(
    "container names are deterministic",
    name === sandboxContainerName("user:Project With Spaces"),
  );
  check("container names are docker-safe", /^fc-ws-[a-f0-9]{24}$/.test(name));

  check(
    "cwd inside workspace root is accepted",
    assertSandboxCwdAllowed(cwd, root) === path.resolve(cwd),
  );
  try {
    assertSandboxCwdAllowed(path.join(os.tmpdir(), "elsewhere"), root);
    check("cwd outside workspace root is rejected", false);
  } catch {
    check("cwd outside workspace root is rejected", true);
  }

  const args = buildDockerRunArgs(
    {
      id: "user:repo",
      cwd,
      command: "bash",
      args: ["-lc", "pwd"],
      env: { FOO: "bar" },
    },
    config,
    "fc-test",
  );

  check("docker run uses --rm", args.includes("--rm"));
  check("docker run keeps stdin interactive", args.includes("-i"));
  check("docker run applies network policy", hasPair(args, "--network", "none"));
  check("docker run applies cpu limit", hasPair(args, "--cpus", "1"));
  check("docker run applies memory limit", hasPair(args, "--memory", "512m"));
  check("docker run applies pids limit", hasPair(args, "--pids-limit", "128"));
  check("docker run drops capabilities", hasPair(args, "--cap-drop", "ALL"));
  check(
    "docker run blocks privilege escalation",
    hasPair(args, "--security-opt", "no-new-privileges"),
  );
  check(
    "docker run binds cwd at /workspace",
    args.includes(`type=bind,src=${path.resolve(cwd)},dst=/workspace:rw`),
  );
  check("docker run passes explicit env only", hasPair(args, "--env", "FOO=bar"));
  check("docker run ends with requested command", args.slice(-3).join(" ") === "bash -lc pwd");

  // A private builder's sealed build: rootless podman as the tenant, its home
  // at the same path, network on, runsc when asked, the unit's own cgroup.
  const sealed = buildDockerRunArgs(
    { id: "user:repo", cwd, command: "bash", args: ["-lic", "claude"], env: { GH_TOKEN: "t" } },
    {
      ...config,
      runtime: "podman",
      network: "bridge",
      ociRuntime: "runsc",
      image: "loki-agent:latest",
    },
    "fc-sealed",
  );
  check("sealed build runs as the tenant", sealed.includes("--userns=keep-id"));
  check(
    "gVisor build never asks for NoCgroups (runsc refuses it)",
    !sealed.includes("--cgroups=disabled"),
  );
  check(
    "gVisor build tells runsc to ignore cgroups",
    hasPair(sealed, "--runtime-flag", "ignore-cgroups"),
  );
  const sealedCrun = buildDockerRunArgs(
    { id: "user:repo", cwd, command: "bash" },
    {
      ...config,
      runtime: "podman",
      network: "bridge",
      ociRuntime: "crun",
      image: "loki-agent:latest",
    },
    "fc-sealed-crun",
  );
  check(
    "sealed build uses slirp4netns for rootless networking",
    hasPair(sealed, "--network", "slirp4netns"),
  );
  check("crun build stays in the unit's cgroup", sealedCrun.includes("--cgroups=disabled"));
  check("sealed build asks for gVisor when the box has it", hasPair(sealed, "--runtime", "runsc"));
  check(
    "sealed build binds the home at the same path",
    sealed.includes(`type=bind,src=${config.home},dst=${config.home}`),
  );
  check(
    "sealed build works in the project's real path",
    hasPair(sealed, "--workdir", path.resolve(cwd)),
  );
  check("sealed build keeps HOME real", hasPair(sealed, "--env", `HOME=${config.home}`));
  check("sealed build has the network the agent needs", !sealed.includes("none"));
  check("sealed build drops capabilities too", hasPair(sealed, "--cap-drop", "ALL"));
  check("sealed build passes the run's token", hasPair(sealed, "--env", "GH_TOKEN=t"));
  check("sealed build never mounts /workspace", !sealed.some((a) => a.includes("dst=/workspace")));
  const unsealed = buildDockerRunArgs(
    { id: "user:repo", cwd, command: "bash" },
    { ...config, runtime: "podman", ociRuntime: null },
    "fc-plain",
  );
  check("without runsc no runtime is asked for", !unsealed.includes("--runtime"));
  // git commit in the sealed container, 2026-10-21: "unable to auto-detect email".
  check(
    "sealed build sets a git author",
    sealed.some((a) => a.startsWith("GIT_AUTHOR_EMAIL=")),
  );
  check(
    "sealed build pushes with the run token via an env-only helper",
    sealed.some((a) => a.startsWith("GIT_CONFIG_VALUE_0=") && a.includes("GH_TOKEN")),
  );
  const git = sealedGitEnv(() => null);
  check(
    "git identity falls back when the host has none",
    git.GIT_COMMITTER_NAME === "Loki builder",
  );
  // Antigravity in runsc, 2026-10-21: no TTY + no key = gemini exits, "never accepted the prompt".
  check(
    "sealed build takes its name back from a dead container (--replace)",
    sealed.includes("--replace"),
  );
  check("sealed build gives the agent a TTY (-t)", sealed.includes("-t") && sealed.includes("-i"));
  check("sealed build keeps the host's hostname", hasPair(sealed, "--hostname", os.hostname()));
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "secret-gemini-key";
  const keyed = buildDockerRunArgs(
    { id: "user:repo", cwd, command: "gemini" },
    { ...config, runtime: "podman", network: "bridge", ociRuntime: "runsc" },
    "fc-keyed",
  );
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedKey;
  check(
    "sealed build forwards the runner's GEMINI_API_KEY by name",
    hasPair(keyed, "--env", "GEMINI_API_KEY"),
  );
  check(
    "the key value never lands on the command line",
    !keyed.some((a) => a.includes("secret-gemini-key")),
  );
  check(
    "only present credentials are forwarded",
    !keyed.includes("OPENROUTER_API_KEY") || Boolean(process.env.OPENROUTER_API_KEY),
  );

  const envConfig = resolveSandboxConfig();
  check("default sandbox config has a workspace root", envConfig.workspaceRoot.length > 1);
  check("default sandbox network is deny-by-default", envConfig.network === "none");

  await optionalDockerSmoke();

  console.log(
    failures === 0
      ? "\nALL SANDBOX EXECUTOR TESTS PASSED"
      : `\n${failures} SANDBOX EXECUTOR TEST(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
