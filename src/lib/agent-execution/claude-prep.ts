/**
 * Claude unattended-launch prep — pure fs, no DB, safe in the desktop bundle.
 *
 * A runner-launched claude must never hang on an interactive gate nobody is
 * watching: the trust-folder dialog on a fresh workspace, or a permission ask
 * for a tool outside the allowlist. The box has done this since box-prepare
 * shipped; the DESKTOP launch path never did, so on a machine without a
 * hand-tuned ~/.claude/settings.json. Loki handoffs used to live under
 * Claude's protected ~/.claude tree, where even broad Write allow rules cannot
 * suppress a confirmation prompt. They now migrate to ~/.loki/sessions.
 *
 * Extracted from box-workspace.ts so both runners share ONE prep. Merge-only:
 * adds trust + allow rules, never removes or narrows anything the user set.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { migrateLegacyHandoffs } from "@/lib/session-paths";

export const UNATTENDED_ALLOW = [
  "Bash",
  "Edit",
  "Write",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "MultiEdit",
  "TodoWrite",
];

/**
 * What a runner-launched claude writes under a commit and a pull request.
 * Org rule: no model identifier in anything pushed. Claude Code's default
 * trailer names the model ("Co-Authored-By: Claude Opus 5.5"), and a commit
 * Loki dispatched on 2026-11-11 (orangecat#1601) carried it.
 */
export const AGENT_ATTRIBUTION = {
  commit: "Co-Authored-By: Claude <noreply@anthropic.com>",
  pr: "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
} as const;

export function ensureClaudeReady(dir: string): void {
  const home = os.homedir();
  migrateLegacyHandoffs(home);
  const cfgPath = path.join(home, ".claude.json");
  let cfg: { projects?: Record<string, Record<string, unknown>> } = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch {
    /* fresh config */
  }
  cfg.projects ??= {};
  const existing = cfg.projects[dir] ?? {};
  cfg.projects[dir] = {
    ...existing,
    hasTrustDialogAccepted: true,
    projectOnboardingSeenCount: Math.max(1, Number(existing.projectOnboardingSeenCount) || 0),
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

  const setPath = path.join(home, ".claude", "settings.json");
  let settings: {
    permissions?: { allow?: string[] };
    attribution?: unknown;
  } = {};
  try {
    settings = JSON.parse(fs.readFileSync(setPath, "utf-8"));
  } catch {
    /* fresh settings */
  }
  settings.permissions ??= {};
  const allow = new Set(settings.permissions.allow ?? []);
  for (const t of UNATTENDED_ALLOW) allow.add(t);
  settings.permissions.allow = [...allow];
  // Only when nothing is set: a person who chose their own attribution (or
  // none) keeps it. Unset means Claude Code's default, which names the model.
  if (settings.attribution === undefined) settings.attribution = { ...AGENT_ATTRIBUTION };
  fs.mkdirSync(path.dirname(setPath), { recursive: true });
  fs.writeFileSync(setPath, JSON.stringify(settings, null, 2));
}
