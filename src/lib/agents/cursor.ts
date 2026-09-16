/**
 * Cursor Agent adapter — `agent` CLI installed by Cursor.
 *
 * Detection is more involved than the other adapters because `agent`
 * is a generic-looking binary name and ~3 other tools on a typical
 * developer machine ship something also called `agent`. To pin it down:
 *   1. Check `agent --version` for Cursor's date-stamped format (YYYY.MM.DD).
 *   2. Fallback: check if the resolved PATH entry lives under .cursor/
 *      or .local/bin/ where Cursor's official installer drops it.
 *
 * processMatchers carries BOTH binary names Cursor has shipped: the legacy
 * `agent` (still symlinked in ~/.local/bin) and the current `cursor-agent`
 * (the real binary name as of mid-2026). A running `cursor-agent` process
 * was previously invisible to the /proc scan, so a project with Cursor live
 * read "Tab open" instead of "Awaiting input". `cursor-agent` is a unique
 * name (unlike bare `agent`, which collides with grok's ~/.grok/bin/agent),
 * so the generic basename matcher in control-fast-state handles it safely;
 * only the legacy `agent` needs the cursor-path disambiguation there.
 *
 * No persistent config we read; model is selected at launch via Cursor's
 * own UI inside the CLI, not via Loki's dropdown.
 */

import { execSync } from "child_process";
import { shellEscape } from "@/lib/shell-escape";
import { commandExistsInPath } from "./helpers";
import type { AgentAdapter, AgentAvailability, AgentRuntimeConfig } from "./types";

export const cursorAdapter: AgentAdapter = {
  id: "cursor",
  label: "Cursor",
  processMatchers: ["agent", "cursor-agent"],
  defaultModel: "auto",
  modelSuggestions: ["auto", "composer-1", "gpt-5.4", "claude-sonnet-4"],
  switchable: true,
  quitCommand: "/quit",
  capabilities: {
    tabSwitching: true,
    manualPromptInjection: true,
    autonomousPromptLoop: false,
    sessionLifecycleSignals: false,
  },

  detectAvailable(): AgentAvailability {
    // Prefer the current `cursor-agent` binary; fall back to the legacy `agent`
    // name. A machine that only has `cursor-agent` (no `agent` symlink) used to
    // report Cursor as "not installed" purely because of the rename.
    const bin = commandExistsInPath("cursor-agent")
      ? "cursor-agent"
      : commandExistsInPath("agent")
        ? "agent"
        : null;
    if (!bin) {
      return {
        available: false,
        availabilityReason:
          "Cursor Agent CLI is not installed. Run: curl https://cursor.com/install -fsS | bash",
      };
    }

    try {
      const version = execSync(`${bin} --version 2>&1`, {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (/\d{4}\.\d{2}\.\d{2}/.test(version)) {
        return { available: true };
      }
    } catch {
      // Fall through — still allow if the binary's path looks like Cursor's.
    }

    const pathValue = process.env.PATH ?? "";
    for (const dir of pathValue.split(":")) {
      if (!dir) continue;
      if (`${dir}/${bin}`.includes(".local/bin/") || dir.includes(".cursor")) {
        return { available: true };
      }
    }

    return {
      available: false,
      availabilityReason: "An `agent` binary exists but does not look like Cursor Agent CLI.",
    };
  },

  readConfiguredModel(): string | null {
    return null;
  },

  buildLaunchCommand({ dir }: AgentRuntimeConfig): string {
    // Implement is unattended. `--trust` prevents the first paste from being
    // consumed by Cursor's workspace-trust screen; `--yolo` prevents a later
    // tool approval from turning a visible Working run into a silent stall.
    return `source ~/.bashrc >/dev/null 2>&1 || true; cd ${shellEscape(dir)} && cursor-agent --trust --yolo`;
  },
};
