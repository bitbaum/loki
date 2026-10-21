/**
 * Provider inventory — what each runner can actually build with, measured.
 *
 * ONE table. Adding a coding CLI or a model gateway is one entry here: the
 * runner probes every entry on its heartbeat and reports, per provider,
 *   installed (path + version) · auth (key/env or login file present — never
 *   the value) · last probe (a real one-line prompt, at most every 6h) ·
 *   healthy (true ONLY after a real probe answered) · the exact next action.
 *
 * Failover (#1367) reads `usableAgents()` from this instead of "is it on
 * PATH": an agent with no credential at all is not somewhere to fail over to.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";

export type ProviderKind = "cli" | "gateway";

export type ProviderSpec = {
  /** Loki agent id where one exists (failover candidates), else a provider id. */
  id: string;
  label: string;
  kind: ProviderKind;
  /** Binaries to look for, first found wins. Gateways have none. */
  bins: string[];
  versionArgs?: string[];
  /** Env vars that each authenticate it on their own (any one is enough). */
  keyEnvs: string[];
  /** Files under $HOME whose presence means a logged-in CLI. */
  loginFiles: string[];
  /** A one-line non-interactive prompt that must print PONG. */
  probe?: (bin: string) => string[];
  /** Model gateways this CLI can front (informational). */
  fronts?: string[];
  install: string;
};

const PONG = "Reply with exactly: PONG";

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    kind: "cli",
    bins: ["claude"],
    versionArgs: ["--version"],
    keyEnvs: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
    loginFiles: [".claude/.credentials.json"],
    probe: () => ["-p", PONG],
    install: "npm i -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    label: "Codex",
    kind: "cli",
    bins: ["codex"],
    versionArgs: ["--version"],
    keyEnvs: ["OPENAI_API_KEY", "CODEX_API_KEY"],
    loginFiles: [".codex/auth.json"],
    probe: () => ["exec", "--skip-git-repo-check", PONG],
    install: "npm i -g @openai/codex",
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "cli",
    bins: ["cursor-agent", "agent"],
    versionArgs: ["--version"],
    keyEnvs: ["CURSOR_API_KEY"],
    loginFiles: [".config/cursor/auth.json", ".cursor/cli-config.json"],
    probe: () => ["-p", "--trust", "--output-format", "text", PONG],
    install: "curl https://cursor.com/install -fsS | bash",
  },
  {
    id: "grok",
    label: "Grok",
    kind: "cli",
    bins: ["grok"],
    versionArgs: ["--version"],
    keyEnvs: ["XAI_API_KEY", "GROK_DEPLOYMENT_KEY"],
    loginFiles: [".grok/auth.json"],
    probe: () => ["-p", PONG],
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  {
    id: "gemini",
    label: "Antigravity",
    kind: "cli",
    bins: ["gemini"],
    versionArgs: ["--version"],
    keyEnvs: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    loginFiles: [".gemini/oauth_creds.json"],
    probe: () => ["--skip-trust", "-p", PONG],
    install: "npm i -g @google/gemini-cli",
  },
  {
    id: "opencode",
    label: "opencode",
    kind: "cli",
    bins: ["opencode"],
    versionArgs: ["--version"],
    keyEnvs: [
      "OPENROUTER_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "DEEPSEEK_API_KEY",
      "MOONSHOT_API_KEY",
      "DASHSCOPE_API_KEY",
      "MISTRAL_API_KEY",
      "MINIMAX_API_KEY",
    ],
    loginFiles: [".local/share/opencode/auth.json"],
    probe: () => ["run", PONG],
    fronts: ["OpenRouter", "Qwen", "Kimi", "Mistral", "MiniMax", "DeepSeek"],
    install: "npm i -g opencode-ai",
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    kind: "cli",
    bins: ["qwen"],
    versionArgs: ["--version"],
    keyEnvs: ["DASHSCOPE_API_KEY", "QWEN_API_KEY", "OPENAI_API_KEY"],
    loginFiles: [".qwen/oauth_creds.json"],
    probe: () => ["-p", PONG],
    install: "npm i -g @qwen-code/qwen-code",
  },
  {
    id: "kimi",
    label: "Kimi CLI",
    kind: "cli",
    bins: ["kimi"],
    versionArgs: ["--version"],
    keyEnvs: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    loginFiles: [".kimi/credentials/kimi-code.json"],
    probe: () => ["--print", "-c", PONG],
    install: "uv tool install kimi-cli",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "gateway",
    bins: [],
    keyEnvs: ["OPENROUTER_API_KEY"],
    loginFiles: [],
    fronts: ["Qwen", "Kimi", "Mistral", "MiniMax", "DeepSeek"],
    install: "add OPENROUTER_API_KEY (used through opencode)",
  },
];

export type AuthState = "key" | "login" | "none";

export type ProviderInventoryEntry = {
  id: string;
  label: string;
  kind: ProviderKind;
  installed: boolean;
  path: string | null;
  version: string | null;
  auth: AuthState;
  /** Name of the env var or file that authenticates it — never its value. */
  authVia: string | null;
  probe: { ok: boolean; at: string; detail: string } | null;
  /** True only when a real probe answered within PROBE_FRESH_MS. */
  healthy: boolean;
  nextAction: string | null;
};

export const PROBE_EVERY_MS = 6 * 60 * 60 * 1000;
export const PROBE_FRESH_MS = 24 * 60 * 60 * 1000;

const HOME = os.homedir();

function nvmBins(): string[] {
  const d = path.join(HOME, ".nvm", "versions", "node");
  try {
    return fs.readdirSync(d).map((v) => path.join(d, v, "bin"));
  } catch {
    return [];
  }
}

function findBin(bins: string[]): string | null {
  const dirs = [
    ...(process.env.PATH ?? "").split(":"),
    path.join(HOME, ".local/bin"),
    path.join(HOME, ".npm-global/bin"),
    path.join(HOME, ".opencode/bin"),
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
    // nvm installs (the builder's Codex lives here, off the unit's PATH;
    // launches reach it through ~/.bashrc).
    ...nvmBins(),
  ].filter(Boolean);
  for (const b of bins)
    for (const d of dirs) {
      const p = path.join(d, b);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        /* next */
      }
    }
  return null;
}

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    // stdin closed: an open pipe made Claude wait, warn and fail the probe.
    const child = execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        cwd: os.tmpdir(),
        env: { ...process.env, PATH: `${path.dirname(bin)}:${process.env.PATH ?? ""}` },
        maxBuffer: 1 << 20,
      },
      (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}` }),
    );
    child.stdin?.end();
  });
}

/** Strip anything token-shaped before it can leave the machine. */
export function maskSecrets(s: string): string {
  return s
    .replace(/[A-Za-z0-9_\-]{24,}/g, "<masked>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function authOf(
  spec: ProviderSpec,
  env: NodeJS.ProcessEnv = process.env,
  home = HOME,
): { auth: AuthState; via: string | null } {
  const key = spec.keyEnvs.find((k) => (env[k] ?? "").trim().length > 0);
  if (key) return { auth: "key", via: key };
  const file = spec.loginFiles.find((f) => fs.existsSync(path.join(home, f)));
  if (file) return { auth: "login", via: `~/${file}` };
  return { auth: "none", via: null };
}

/** The exact next thing a person has to do, or null when there is nothing. */
export function nextActionFor(
  spec: ProviderSpec,
  e: Pick<ProviderInventoryEntry, "installed" | "auth" | "probe" | "healthy">,
  channel: "cloud" | "local",
): string | null {
  if (spec.kind === "cli" && !e.installed) return `install: ${spec.install}`;
  if (e.auth === "none") {
    const k = spec.keyEnvs[0];
    return channel === "cloud"
      ? `add ${k} to the builder's runner env (/opt/loki/runner/.env)`
      : spec.loginFiles.length
        ? `sign in on this computer (run ${spec.bins[0] ?? spec.id} once) or set ${k}`
        : `set ${k}`;
  }
  if (e.probe && !e.probe.ok)
    return /quota|rate.?limit|429|exhaust|usage limit/i.test(e.probe.detail)
      ? "out of quota — wait for the reset or fail over"
      : `fix: ${e.probe.detail}`;
  if (spec.kind === "cli" && !e.probe) return "waiting for its first probe";
  return null;
}

type ProbeCache = Record<string, { ok: boolean; at: string; detail: string }>;
const CACHE = path.join(HOME, ".loki", "provider-probes.json");
function readCache(): ProbeCache {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
}
function writeCache(c: ProbeCache) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(c));
  } catch {
    /* best effort */
  }
}
let probing = false;

/**
 * Inventory for this runner. Cheap: PATH lookup, `--version`, env/file
 * checks. Real prompts run in the background at most every PROBE_EVERY_MS per
 * provider and land in ~/.loki/provider-probes.json for the next heartbeat.
 */
export async function probeProviderInventory(
  channel: "cloud" | "local",
  now = Date.now(),
): Promise<ProviderInventoryEntry[]> {
  const cache = readCache();
  const out: ProviderInventoryEntry[] = [];
  const due: Array<{ spec: ProviderSpec; bin: string }> = [];
  for (const spec of PROVIDERS) {
    const bin = spec.kind === "cli" ? findBin(spec.bins) : null;
    const installed = spec.kind === "gateway" ? true : bin !== null;
    let version: string | null = null;
    if (bin && spec.versionArgs) {
      const v = await run(bin, spec.versionArgs, 8000);
      version = v.ok ? maskSecrets(v.out.split("\n")[0] ?? "") || null : null;
    }
    const { auth, via } = authOf(spec);
    const probe = cache[spec.id] ?? null;
    const fresh = probe ? now - Date.parse(probe.at) < PROBE_FRESH_MS : false;
    const healthy = Boolean(probe?.ok && fresh && installed && auth !== "none");
    const entry = {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      installed,
      path: bin,
      version,
      auth,
      authVia: via,
      probe,
      healthy,
      nextAction: null as string | null,
    };
    entry.nextAction = nextActionFor(spec, entry, channel);
    out.push(entry);
    if (
      bin &&
      spec.probe &&
      auth !== "none" &&
      (!probe || now - Date.parse(probe.at) > PROBE_EVERY_MS)
    )
      due.push({ spec, bin });
  }
  if (due.length && !probing && process.env.LOKI_PROVIDER_PROBES !== "off") {
    probing = true;
    void (async () => {
      const c = readCache();
      for (const { spec, bin } of due) {
        const r = await run(bin, spec.probe!(bin), 120_000);
        c[spec.id] = {
          ok: r.ok && /PONG/.test(r.out),
          at: new Date().toISOString(),
          detail: maskSecrets(r.out.split("\n").filter(Boolean).slice(-1)[0] ?? ""),
        };
        writeCache(c);
      }
    })().finally(() => {
      probing = false;
    });
  }
  return out;
}

/**
 * Agent ids failover may route to: installed, credentialed, and not known
 * broken. A provider whose last real probe failed is excluded; one not yet
 * probed is kept (unknown is not broken), so a fresh runner still works.
 */
export function usableAgents(inv: readonly ProviderInventoryEntry[]): string[] {
  return inv
    .filter(
      (e) =>
        e.kind === "cli" &&
        e.installed &&
        e.auth !== "none" &&
        !(
          e.probe &&
          !e.probe.ok &&
          !/quota|rate.?limit|429|exhaust|usage limit/i.test(e.probe.detail)
        ),
    )
    .map((e) => e.id);
}

export function sanitizeInventory(raw: unknown): ProviderInventoryEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set(PROVIDERS.map((p) => p.id));
  return raw
    .filter(
      (e): e is ProviderInventoryEntry =>
        !!e && typeof e === "object" && ids.has((e as { id?: string }).id ?? ""),
    )
    .slice(0, PROVIDERS.length)
    .map((e) => ({
      id: e.id,
      label: String(e.label).slice(0, 40),
      kind: e.kind === "gateway" ? "gateway" : "cli",
      installed: e.installed === true,
      path: typeof e.path === "string" ? e.path.slice(0, 200) : null,
      version: typeof e.version === "string" ? maskSecrets(e.version) : null,
      auth: e.auth === "key" || e.auth === "login" ? e.auth : "none",
      authVia: typeof e.authVia === "string" ? e.authVia.slice(0, 80) : null,
      probe:
        e.probe && typeof e.probe === "object"
          ? {
              ok: e.probe.ok === true,
              at: String(e.probe.at).slice(0, 40),
              detail: maskSecrets(String(e.probe.detail ?? "")),
            }
          : null,
      healthy: e.healthy === true,
      nextAction: typeof e.nextAction === "string" ? e.nextAction.slice(0, 200) : null,
    }));
}
