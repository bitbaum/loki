/**
 * Grok adapter — x.ai's `grok` CLI.
 *
 * Grok writes its own session log to ~/.grok/sessions so Loki's
 * watcher tails that directory for direct-activity events instead of
 * relying on hooks (which Grok doesn't expose).
 *
 * One-click install link points at the official x.ai installer; the
 * /control "Install Grok" button shells out to it.
 */

import path from "path";
import { existsSync } from "fs";
import { HOME } from "@/lib/constants";
import { shellEscape } from "@/lib/shell-escape";
import { commandExistsInPath } from "./helpers";
import type { AgentAdapter, AgentAvailability, AgentRuntimeConfig } from "./types";

export const grokAdapter: AgentAdapter = {
  id: "grok",
  label: "Grok",
  processMatchers: ["grok"],
  defaultModel: "auto",
  modelSuggestions: ["auto", "grok-3", "grok-4"],
  switchable: true,
  quitCommand: "/exit",
  installCommand: "curl -fsSL https://x.ai/cli/install.sh | bash",
  sessionDir: "~/.grok/sessions",
  directActivitySource: "native-session-log",
  capabilities: {
    tabSwitching: true,
    manualPromptInjection: true,
    autonomousPromptLoop: true,
    sessionLifecycleSignals: true,
  },

  detectAvailable(): AgentAvailability {
    if (commandExistsInPath("grok")) return { available: true };
    if (existsSync(path.join(HOME, ".grok"))) {
      return {
        available: false,
        availabilityReason:
          "Grok config exists (~/.grok), but the `grok` CLI is not on $PATH. Run the installer from the web UI.",
      };
    }
    return {
      available: false,
      availabilityReason:
        "Grok CLI is not installed. Click Install Grok in the Control panel to get the one-click terminal installer.",
    };
  },

  readConfiguredModel(): string | null {
    // Grok CLI doesn't expose its configured model via a stable file we
    // can read deterministically. Return null so /control falls back to
    // defaultModel ("auto" — Grok picks the best model internally).
    return null;
  },

  buildLaunchCommand({ dir }: AgentRuntimeConfig): string {
    // Keep the PTY in browser scrollback and let an Implement run use tools
    // without waiting for an invisible approval prompt. Workspace trust is
    // prepared by Fleet Runner before this command starts.
    return `source ~/.bashrc >/dev/null 2>&1 || true; cd ${shellEscape(dir)} && grok --always-approve --no-alt-screen`;
  },
};
