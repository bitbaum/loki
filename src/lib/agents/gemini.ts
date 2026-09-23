/**
 * Antigravity adapter — Google's `gemini` CLI (legacy internal ID).
 *
 * No session lifecycle signals (Gemini CLI is one-shot per invocation).
 * Model is passed via `-m <model>` flag at launch; no persistent config
 * file we read.
 */

import path from "path";
import { existsSync } from "fs";
import { HOME } from "@/lib/constants";
import { shellEscape } from "@/lib/shell-escape";
import { commandExistsInPath } from "./helpers";
import type { AgentAdapter, AgentAvailability, AgentRuntimeConfig } from "./types";

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  label: "Antigravity",
  processMatchers: ["gemini"],
  defaultModel: "auto",
  modelSuggestions: ["auto", "pro", "flash", "flash-lite"],
  switchable: true,
  quitCommand: "q",
  capabilities: {
    tabSwitching: true,
    manualPromptInjection: true,
    autonomousPromptLoop: false,
    sessionLifecycleSignals: false,
  },

  detectAvailable(): AgentAvailability {
    if (commandExistsInPath("gemini")) return { available: true };
    if (existsSync(path.join(HOME, ".gemini"))) {
      return {
        available: false,
        availabilityReason:
          "Antigravity configuration exists, but its CLI command is not installed on PATH.",
      };
    }
    return {
      available: false,
      availabilityReason: "Antigravity CLI is not installed on this machine.",
    };
  },

  readConfiguredModel(): string | null {
    return null;
  },

  buildLaunchCommand({ dir, model }: AgentRuntimeConfig): string {
    const m = (model ?? "").trim();
    const modelFlag = m ? ` -m ${shellEscape(m)}` : "";
    return `source ~/.bashrc >/dev/null 2>&1 || true; cd ${shellEscape(dir)} && gemini${modelFlag}`;
  },
};
