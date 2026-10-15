// Hosted runner — Phase 1: dispatch a real coding task to Hermes.
//
// Where Phase 0 (analyze.ts) does read-only analysis via Groq, this runs an
// actual agent that can WRITE code — by orchestrating Hermes headless rather
// than building our own sandboxed agent. The strategic bet (Thoughts: "The
// Captain Needs a Ship"): we don't out-build Nous's runtime; we point it at a
// project the same way we point claude/grok.
//
// Invocation (verified live on the box, 2026-07-22):
//   hermes -z "<task>" --yolo [-m <model>]   # one-shot; --yolo bypasses approval stalls
//   Provider + default model come from ~/.hermes/config.yaml (provider: copilot,
//   default: gpt-4.1 — GitHub Models, FREE via the injected GITHUB_TOKEN). gpt-4.1
//   is the reliable everyday coder with generous free-tier limits; pass a per-task
//   `model` (e.g. gpt-5) to trade limits for peak quality on high-value tasks.
//   We do NOT pass --ignore-user-config — that bypasses the config and falls back
//   to a built-in default that doesn't work. Run inside the cloned repo dir;
//   Hermes' terminal.backend=local edits CWD.
//
// The agent's work is PRESERVED: after it edits, we commit on a fresh branch,
// push, and open a PR — so an offline dispatch lands reviewable changes instead
// of a discarded diff. Never auto-merges; a human reviews the PR.

import { mkdtemp, rm } from "node:fs/promises";
import { EXEC_TIMEOUT_MS, EXEC_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commandExistsInPath } from "@/lib/agents/helpers";
import { GITHUB_API_BASE } from "@/lib/github-api";

const run = promisify(execFile);

export type HermesRunResult =
  | {
      ok: true;
      output: string;
      diff: string;
      model: string;
      prUrl?: string;
      branch?: string;
      noChanges?: boolean;
    }
  | { ok: false; error: string; needsInstall?: boolean };

/** Parse "https://github.com/owner/repo(.git)" → {owner, repo}; null if not GitHub. */
function parseGitHub(gitUrl: string): { owner: string; repo: string } | null {
  const m = gitUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** Open a PR via the GitHub API. Returns the html_url, or null on failure. */
async function openPr(opts: {
  owner: string;
  repo: string;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API_BASE}/repos/${opts.owner}/${opts.repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { html_url?: string };
    return json.html_url ?? null;
  } catch {
    return null;
  }
}

/**
 * Clone the repo, run Hermes against `task` headless, then preserve any changes
 * as a pushed branch + PR. Always cleans up the temp clone.
 */
export async function runHermesTask(input: {
  gitUrl: string;
  task: string;
  /** Compact "what was just done" block (recent completed/failed work) so the
   *  agent doesn't repeat or collide with it. Assembled by the consumer. */
  recentActivity?: string | null;
  token?: string | null;
  model?: string;
}): Promise<HermesRunResult> {
  const { gitUrl, task, recentActivity, token, model } = input;

  // Orchestrate, don't assume: if the runtime isn't present, say so clearly.
  if (!commandExistsInPath("hermes")) {
    return {
      ok: false,
      needsInstall: true,
      error: "The `hermes` CLI is not installed on this runner.",
    };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "fc-hermes-"));
    const cloneUrl =
      token && gitUrl.startsWith("https://")
        ? gitUrl.replace("https://", `https://x-access-token:${token}@`)
        : gitUrl;
    await run("git", ["clone", "--depth", "1", "--no-tags", cloneUrl, dir], {
      timeout: EXEC_TIMEOUT_LONG_MS,
      maxBuffer: 16 * 1024 * 1024,
    });

    // Identify base branch + a unique work branch up front.
    const { stdout: baseRaw } = await run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: EXEC_TIMEOUT_MS,
    }).catch(() => ({ stdout: "main" }));
    const base = baseRaw.trim() || "main";
    const slug =
      task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "task";
    const branch = `hermes/${slug}-${Date.now().toString(36)}`;

    // Guardrails: this runs unattended and the diff goes straight to a PR. The
    // dominant failure mode is an agent that "helpfully" reformats, installs
    // deps, or edits unrelated files (observed 2026-07-22: gpt-4o redacted a
    // README placeholder + touched package-lock.json for a one-line docs task).
    // Constrain it to a minimal, reviewable change.
    const GUARDRAILS = [
      "Constraints for this run (follow exactly):",
      "- Make the SMALLEST change that accomplishes the task. Edit only the files the task requires.",
      "- Do NOT install, add, upgrade, or remove dependencies, and do NOT modify lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock).",
      "- Do NOT reformat, lint, or rewrite code you were not explicitly asked to change.",
      "- Do NOT alter configuration, secrets, or placeholder values you were not asked to change.",
      "- If a file you were asked to CREATE already exists, do NOT overwrite or wholesale-replace it — append or make a minimal edit, or report the conflict and change nothing.",
      "- If the task is ambiguous or cannot be done safely, make no changes and explain why.",
    ].join("\n");
    const prompt = [recentActivity, `Task:\n${task}`, GUARDRAILS].filter(Boolean).join("\n\n");
    const modelArgs = model && model !== "auto" ? ["-m", model] : [];

    // Headless agentic run. --yolo bypasses approval prompts (we're in a throwaway
    // clone). Model + Nous creds resolved from ~/.hermes/config.yaml.
    const { stdout } = await run("hermes", ["-z", prompt, "--yolo", ...modelArgs], {
      cwd: dir,
      timeout: 15 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env },
    });
    const output = stdout.trim();

    // Stage everything the agent touched; if nothing changed, report that honestly.
    await run("git", ["-C", dir, "add", "-A"], { timeout: 30_000 });
    const { stdout: diffStat } = await run("git", ["-C", dir, "diff", "--cached", "--stat"], {
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }).catch(() => ({ stdout: "" }));
    if (!diffStat.trim()) {
      return { ok: true, output, diff: "", model: model ?? "config-default", noChanges: true };
    }

    // Preserve the work: commit on a branch, push, open a PR (never auto-merge).
    await run("git", ["-C", dir, "config", "user.email", "runner@loki.local"], {
      timeout: 10_000,
    });
    await run("git", ["-C", dir, "config", "user.name", "Loki Hosted Runner"], {
      timeout: 10_000,
    });
    await run("git", ["-C", dir, "checkout", "-b", branch], { timeout: EXEC_TIMEOUT_MS });
    await run("git", ["-C", dir, "commit", "-m", `hermes: ${task.slice(0, 72)}`], {
      timeout: 30_000,
    });
    await run("git", ["-C", dir, "push", "origin", `HEAD:refs/heads/${branch}`], {
      timeout: EXEC_TIMEOUT_LONG_MS,
    });

    let prUrl: string | undefined;
    const gh = parseGitHub(gitUrl);
    if (gh && token) {
      const url = await openPr({
        owner: gh.owner,
        repo: gh.repo,
        token,
        head: branch,
        base,
        title: `hermes: ${task.slice(0, 72)}`,
        body: `Autonomous change by the Loki hosted runner (Hermes) for an offline dispatch.\n\n**Task:** ${task}\n\n**Agent summary:**\n${output.slice(0, 4000)}\n\n_Review before merging — this was produced unattended._`,
      });
      if (url) prUrl = url;
    }

    return {
      ok: true,
      output,
      diff: diffStat.trim(),
      model: model ?? "config-default",
      branch,
      prUrl,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "hermes run failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
