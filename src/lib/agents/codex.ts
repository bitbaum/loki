/**
 * Codex adapter — OpenAI's `codex` CLI.
 *
 * Codex doesn't ship session lifecycle signals (no session.md), so the
 * autopilot loop can't auto-fire based on handoffs. Users dispatch
 * manually; the activity log relies on explicit prompts they enter.
 *
 * Per-user model config lives in ~/.codex/config.toml as a TOML string.
 * `readConfiguredModel` parses it so the UI defaults reflect the user's
 * choice (e.g. they configured `model = "codex-4"` outside Loki).
 */

import fs from "fs";
import path from "path";
import { existsSync } from "fs";
import { HOME } from "@/lib/constants";
import { shellEscape } from "@/lib/shell-escape";
import { commandExistsInPath, parseTomlStringField } from "./helpers";
import type { AgentAdapter, AgentAvailability, AgentRuntimeConfig } from "./types";

const CONFIG_FILE = path.join(HOME, ".codex", "config.toml");

export const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",
  processMatchers: ["codex"],
  defaultModel: "gpt-5.4",
  modelSuggestions: ["gpt-5.4", "codex-4"],
  switchable: true,
  quitCommand: "q",
  capabilities: {
    tabSwitching: true,
    manualPromptInjection: true,
    autonomousPromptLoop: false,
    sessionLifecycleSignals: false,
  },

  detectAvailable(): AgentAvailability {
    if (commandExistsInPath("codex")) return { available: true };
    if (existsSync(path.join(HOME, ".codex"))) {
      return {
        available: false,
        availabilityReason:
          "Codex configuration exists, but no Codex CLI command is installed on PATH.",
      };
    }
    return {
      available: false,
      availabilityReason: "Codex CLI is not installed on this machine.",
    };
  },

  readConfiguredModel(): string | null {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return parseTomlStringField(raw, "model");
    } catch {
      return null;
    }
  },

  buildLaunchCommand({ dir, model, resumeLatest }: AgentRuntimeConfig): string {
    const m = (model ?? "").trim() || this.defaultModel;
    // `codex resume --last` reopens the newest session started in this
    // folder (Codex filters by the working directory unless given --all).
    // The launch options go before the subcommand, where the root command
    // reads them. A folder with no session yet: the resume fails and the
    // plain launch runs — a fresh session, as Claude's Resume does.
    const base = `codex --model ${shellEscape(m)} --no-alt-screen`;
    const run = resumeLatest ? `${base} resume --last || ${base}` : base;
    return `source ~/.bashrc >/dev/null 2>&1 || true; cd ${shellEscape(dir)} && ${run}`;
  },
};
