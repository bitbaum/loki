/**
 * SandboxExecutor — Docker-backed implementation of the Executor interface.
 *
 * This is Stage 3 of the execution-substrate migration: the control plane still
 * talks to `Executor`, but the process is now born inside an isolated container
 * with explicit resource limits and workspace-root enforcement. It is not a
 * public-hosted-execution entitlement by itself; product gates still decide who
 * may use hosted execution. This class is the substrate those gates can safely
 * point at.
 */
import { spawn, type IPty } from "node-pty";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceId, WorkspaceSpec } from "./types";
import { PtyExecutor, type PtyWorkspaceState } from "./pty-executor";

export type SandboxNetwork = "none" | "bridge";
export type SandboxUser = "current" | "root";
export type SandboxMountMode = "rw" | "ro";
/**
 * Two ways to be born in a container:
 * - "docker": the original hosted-sandbox shape — the project bound at
 *   /workspace, HOME=/tmp, network off, the docker CLI (root's).
 * - "podman": a PRIVATE BUILDER's sealed build (docs/master-plan-2026-10.md
 *   4.2). Rootless, as the tenant's own user (`--userns=keep-id`), with the
 *   tenant's HOME bound at the same path so the agent CLI finds its sign-in,
 *   its trust and its transcripts exactly where the runner looks for them;
 *   the project is under that home. Network on (the agent needs its vendor
 *   and GitHub); gVisor's runsc as the OCI runtime when the box has it
 *   (`ociRuntime`), so a tricked agent meets a user-space kernel, not the
 *   host's. `--cgroups=disabled` keeps the processes in the unit's cgroup,
 *   where the deploy's drain counts them.
 */
export type SandboxRuntime = "docker" | "podman";

export interface SandboxExecutorConfig {
  runtime: SandboxRuntime;
  image: string;
  workspaceRoot: string;
  network: SandboxNetwork;
  cpus: string;
  memory: string;
  pidsLimit: string;
  user: SandboxUser;
  mountMode: SandboxMountMode;
  extraRunArgs: string[];
  /** podman only: the OCI runtime to ask for (runsc), or null for the default. */
  ociRuntime: string | null;
  /** podman only: the home bound into the container at the same path. */
  home: string;
}

/** All this backend remembers beyond the shared PTY state. */
type SandboxMeta = { containerName: string };

function envValue(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function resolveSandboxConfig(): SandboxExecutorConfig {
  const runtime: SandboxRuntime =
    envValue("LOKI_SANDBOX_RUNTIME", "docker") === "podman" ? "podman" : "docker";
  return {
    runtime,
    image: envValue(
      "LOKI_SANDBOX_IMAGE",
      runtime === "podman" ? "loki-agent:latest" : "ubuntu:24.04",
    ),
    // A private builder's root is its home: the project and its worktrees
    // are both under it, and the home is what the container is given.
    workspaceRoot: path.resolve(
      envValue(
        "LOKI_SANDBOX_WORKSPACE_ROOT",
        runtime === "podman" ? os.homedir() : path.join(os.homedir(), "dev"),
      ),
    ),
    network:
      envValue("LOKI_SANDBOX_NETWORK", runtime === "podman" ? "bridge" : "none") === "bridge"
        ? "bridge"
        : "none",
    cpus: envValue("LOKI_SANDBOX_CPUS", "2"),
    memory: envValue("LOKI_SANDBOX_MEMORY", "4g"),
    pidsLimit: envValue("LOKI_SANDBOX_PIDS", "512"),
    user: envValue("LOKI_SANDBOX_USER", "current") === "root" ? "root" : "current",
    mountMode: envValue("LOKI_SANDBOX_MOUNT", "rw") === "ro" ? "ro" : "rw",
    extraRunArgs: (process.env.LOKI_SANDBOX_DOCKER_ARGS ?? "").split(/\s+/).filter(Boolean),
    ociRuntime: process.env.LOKI_SANDBOX_OCI_RUNTIME?.trim() || null,
    home: os.homedir(),
  };
}

export function sandboxContainerName(id: WorkspaceId): string {
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 24);
  return `fc-ws-${hash}`;
}

export function assertSandboxCwdAllowed(cwd: string, workspaceRoot: string): string {
  const resolved = path.resolve(cwd);
  const root = path.resolve(workspaceRoot);
  const rel = path.relative(root, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return resolved;
  throw new Error(`Sandbox cwd ${resolved} is outside LOKI_SANDBOX_WORKSPACE_ROOT (${root})`);
}

export function buildDockerRunArgs(
  spec: WorkspaceSpec,
  config: SandboxExecutorConfig,
  containerName = sandboxContainerName(spec.id),
): string[] {
  const cwd = assertSandboxCwdAllowed(spec.cwd, config.workspaceRoot);
  if (config.runtime === "podman") return buildPodmanRunArgs(spec, config, containerName, cwd);
  const userArgs =
    config.user === "current"
      ? ["--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`]
      : [];
  const envArgs = Object.entries(spec.env ?? {}).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ]);
  const mountSuffix = config.mountMode === "ro" ? ":ro" : ":rw";

  return [
    "run",
    "--rm",
    "-i",
    "--name",
    containerName,
    "--workdir",
    "/workspace",
    "--mount",
    `type=bind,src=${cwd},dst=/workspace${mountSuffix}`,
    "--network",
    config.network,
    "--cpus",
    config.cpus,
    "--memory",
    config.memory,
    "--pids-limit",
    config.pidsLimit,
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--env",
    "TERM=xterm-256color",
    "--env",
    "HOME=/tmp",
    ...userArgs,
    ...envArgs,
    ...config.extraRunArgs,
    config.image,
    spec.command,
    ...(spec.args ?? []),
  ];
}

/**
 * Agent sign-in that lives in the runner's environment (the unit's env file).
 * A sealed build sees none of the runner's env unless named here, so Gemini
 * inside runsc exited with "When using Gemini API, you must specify the
 * GEMINI_API_KEY environment variable" six seconds after launch and every
 * Antigravity run failed as "never accepted the prompt" (Substrata,
 * 2026-10-21). Passed as `--env NAME` (value inherited from podman's own
 * environment), so no key ever appears on a command line.
 */
export const AGENT_CREDENTIAL_ENV = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "CURSOR_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export function agentCredentialEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of AGENT_CREDENTIAL_ENV) {
    const value = env[name];
    if (value) out[name] = value;
  }
  return out;
}

/** A private builder's sealed build (see SandboxRuntime). */
function buildPodmanRunArgs(
  spec: WorkspaceSpec,
  config: SandboxExecutorConfig,
  containerName: string,
  cwd: string,
): string[] {
  const envArgs = Object.entries(spec.env ?? {}).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ]);
  const credentialArgs = Object.keys(agentCredentialEnv())
    .filter((name) => !(spec.env && name in spec.env))
    .flatMap((name) => ["--env", name]);
  return [
    "run",
    "--rm",
    // -t as well as -i: the runner drives an interactive TUI through node-pty.
    // With -i alone the agent's stdin is a pipe, so Gemini CLI skips its
    // composer and exits ("No input provided via stdin") — measured in the
    // sealed container 2026-10-21; with -it the same image answers a prompt.
    "-i",
    "-t",
    "--name",
    containerName,
    // Same hostname as the host: CLIs that seal their stored sign-in to the
    // machine (Gemini's file keychain) read it as corrupted under a random one.
    "--hostname",
    os.hostname(),
    // The tenant inside is the tenant outside: files it writes are its own.
    "--userns=keep-id",
    // Stay in the unit's cgroup (rootless, no delegation needed), so the
    // deploy's drain sees these processes and MemoryMax still bounds them.
    // gVisor refuses NoCgroups (measured on the box 2026-10-21: "runsc is not
    // compatible with NoCgroups"), so under runsc podman keeps its default and
    // runsc is told to leave cgroups alone; crun/runc stay in the unit's cgroup.
    ...(config.ociRuntime === "runsc"
      ? ["--runtime-flag", "ignore-cgroups"]
      : ["--cgroups=disabled"]),
    ...(config.ociRuntime ? ["--runtime", config.ociRuntime] : []),
    "--workdir",
    cwd,
    "--mount",
    `type=bind,src=${config.home},dst=${config.home}`,
    // Rootless "bridge" goes through pasta, which could not open its netns
    // under the runner unit on the box (2026-10-21); slirp4netns works.
    "--network",
    config.network === "bridge" ? "slirp4netns" : config.network,
    "--pids-limit",
    config.pidsLimit,
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--env",
    "TERM=xterm-256color",
    "--env",
    `HOME=${config.home}`,
    "--env",
    `PATH=${config.home}/.local/bin:${config.home}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin`,
    ...credentialArgs,
    ...envArgs,
    ...config.extraRunArgs,
    config.image,
    spec.command,
    ...(spec.args ?? []),
  ];
}

export class SandboxExecutor extends PtyExecutor<SandboxMeta> {
  constructor(private readonly config = resolveSandboxConfig()) {
    super();
  }

  protected async launch(spec: WorkspaceSpec): Promise<{ pty: IPty; meta: SandboxMeta }> {
    if (!fs.existsSync(spec.cwd)) throw new Error(`Sandbox cwd does not exist: ${spec.cwd}`);

    const containerName = sandboxContainerName(spec.id);
    const args = buildDockerRunArgs(spec, this.config, containerName);
    const pty = spawn(this.config.runtime, args, {
      name: "xterm-color",
      cwd: this.config.workspaceRoot,
      cols: spec.cols ?? 120,
      rows: spec.rows ?? 32,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? os.homedir(),
        // podman reads XDG_RUNTIME_DIR for its rootless state; the sealed
        // drop-in sets it on the unit.
        ...(process.env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR } : {}),
        ...(this.config.runtime === "podman" ? agentCredentialEnv() : {}),
      },
    });

    return { pty, meta: { containerName } };
  }

  /** Best effort: node-pty kill usually stops docker run; this catches a
   *  detached container if Docker needed an extra nudge. */
  protected async afterTerminate(state: PtyWorkspaceState<SandboxMeta>): Promise<void> {
    try {
      const { execFile } = await import("node:child_process");
      await new Promise<void>((resolve) => {
        execFile(
          this.config.runtime,
          ["rm", "-f", state.meta.containerName],
          { timeout: 5000 },
          () => resolve(),
        );
      });
    } catch {
      /* docker unavailable or already removed */
    }
  }
}
