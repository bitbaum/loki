/**
 * Pure: evidence that an agent CLI took a prompt Loki submitted. Shared by the
 * runner (pty-runtime.ts) and its tests. RUN-STATUS-SSOT: "Working" needs this.
 */
import type { AgentOption } from "@/lib/agent-registry";
import { stripReportResidue } from "@/lib/terminal-reports";

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const normalizeScreenText = (s: string) =>
  s.replace(ANSI_RE, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Agents that draw an unmistakable "I am working on it" line once a prompt is
 * submitted. Gemini CLI (Antigravity) shows "(esc to cancel, 3s)" beside its
 * spinner for every turn, including tool calls.
 */
export const WORKING_MARKERS: Partial<Record<AgentOption, RegExp>> = {
  // Gemini CLI 0.65.0 (measured in the sealed container, 2026-10-21) draws no
  // "esc to cancel" at all: a taken prompt shows a braille spinner, "✓ Tool …"
  // lines for each tool call and "✦" before every model reply.
  gemini: /esc to cancel|esc to interrupt|✦|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|✓ [A-Z]/i,
};

/**
 * Pure: whether output captured after Loki submitted a prompt shows the agent
 * took it. With a known working marker, only the marker counts. Otherwise the
 * agent must draw real text that is neither our prompt echoed back nor the
 * residue of terminal query answers.
 */
export function promptAcceptedEvidence(
  raw: string,
  agent: AgentOption | null,
  prompt: string,
): boolean {
  const visible = stripReportResidue(raw.replace(ANSI_RE, ""));
  const marker = agent ? WORKING_MARKERS[agent] : undefined;
  if (marker) return marker.test(visible);
  const echoed = normalizeScreenText(prompt);
  const said = visible
    .split(/\r?\n|\r/)
    .map((line) => normalizeScreenText(line).replace(/^[\s>│┃|]+|[\s│┃|]+$/g, ""))
    .map((line) => line.replace(/[─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║]+/g, "").trim())
    .filter((line) => line.length > 1 && !(echoed && echoed.includes(line)))
    .join(" ");
  return said.replace(/\s+/g, "").length >= 24;
}

/**
 * Pure: the reason a sealed container never started, from podman/runsc's own
 * words on the PTY (exit 125: name in use, runsc delete failed, image missing,
 * OCI runtime error), or null. 2026-10-21 22:22: three providers were blamed
 * for "never accepting the prompt" when no container had ever existed.
 */
export function containerStartFailure(raw: string): string | null {
  const text = raw.replace(ANSI_RE, "");
  const m = text.match(
    /^\s*Error:\s*(.*(?:container|runsc|OCI|crun|name .* in use|image|storage|netns|slirp4netns|cgroup).*)$/im,
  );
  if (!m) return null;
  return m[1]
    .replace(/[A-Za-z0-9]{32,}/g, "…")
    .trim()
    .slice(0, 240);
}
