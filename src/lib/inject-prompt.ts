/**
 * Shared inject prompt assembly — SSOT for what text reaches an agent on dispatch.
 *
 * Used by inject-core on BOTH local and cloud paths so phone → cloud → Fleet Runner
 * carries the same intent templates as Control → orchestration/run. Broad
 * intents may include project context; explicit user tasks stay focused.
 * Local-only session enrichment (zellij state, Loki handoffs) stays in inject-core.
 */
import {
  ORCHESTRATION_TASK_INTENT_IDS,
  renderProjectContextBlock,
  renderTaskForAdapter,
  type AdapterId,
  type OrchestrationTaskIntentId,
} from "@/lib/orchestration";
import { getProjectContext } from "@/db/queries/project-context";
import { getOpenEscalationBlock } from "@/db/queries/run-escalations";
import { PROMPT_TEMPLATES } from "@/config/prompt-library";
import { getOrchestrationIntent } from "@/lib/orchestration/intents";
import { exitContractFor } from "@/lib/agent-config";
import { FLEET_SESSIONS_DISPLAY_PATH } from "@/lib/session-paths";
import { previewDeliveryNote } from "@/lib/previews/delivery-note";
import { previewsRoot } from "@/lib/previews/root";

export type AssembleInjectPromptInput = {
  userId: string;
  projectKey: string;
  projectPath: string;
  projectId: string | null;
  adapter: AdapterId;
  promptKey?: string;
  customPrompt?: string;
  model?: string;
  /** The project's public address, when it has one (a preview's, above all). */
  liveUrl?: string | null;
};

export type AssembleInjectPromptResult =
  | { ok: true; prompt: string; promptLabel: string; intent: OrchestrationTaskIntentId | undefined }
  | { ok: false; status: number; error: string };

function isOrchestrationIntent(key: string): key is OrchestrationTaskIntentId {
  return (ORCHESTRATION_TASK_INTENT_IDS as readonly string[]).includes(key);
}

/** Resolve a non-orchestration prompt key from prompt-library (cloud-safe — no local files). */
function resolveLibraryPromptBody(key: string): string | null {
  const hit = PROMPT_TEMPLATES.find((t) => t.agentKey === key);
  return hit?.template ?? null;
}

/**
 * Build the fully assembled prompt body for inject / queue paths.
 * Never throws — callers treat failures as dispatch errors.
 */
export async function assembleInjectPrompt(
  input: AssembleInjectPromptInput,
): Promise<AssembleInjectPromptResult> {
  const {
    userId,
    projectKey,
    projectPath,
    projectId,
    adapter,
    promptKey,
    customPrompt,
    model,
    liveUrl,
  } = input;

  if (!promptKey && !customPrompt) {
    return { ok: false, status: 400, error: "promptKey or customPrompt required" };
  }

  const [projectContextRaw, escalationBlock] = await Promise.all([
    customPrompt ? Promise.resolve(null) : getProjectContext(userId, projectKey).catch(() => null),
    // Open escalation ladder (retry → patch → replan): the objection from the
    // last failing run goes back to the AGENT first — humans are only alerted
    // at the top rung. Best-effort like every block.
    getOpenEscalationBlock(userId, projectKey).catch(() => ""),
  ]);
  const projectContext = projectContextRaw ?? undefined;

  // Handoff exit-contract, appended to EVERY queued dispatch. The run only
  // closes when the agent's session handoff reports ready (closeRunFromSession
  // reads what the pusher persisted from ~/.loki/sessions/<tab>.md on the
  // executing machine) — without this block, box-executed agents finished
  // real work, wrote no handoff, and were reaped as timeouts. Tilde-relative
  // on purpose: the assembling server doesn't know the executing machine's
  // HOME; the agent expands it. resolveSessionFile reads case-insensitively,
  // so projectKey casing vs repo-dir casing cannot strand the handoff.
  const sessionFileRef = `${FLEET_SESSIONS_DISPLAY_PATH}/${projectKey}.md`;
  const exitContract = exitContractFor(sessionFileRef);
  // A preview folder is the site: no remote, nothing to push, live on save
  // (lib/previews/delivery-note). Said on every dispatch there, because the
  // box contract's "invisible until you push" is the opposite of true for it.
  const delivery = previewDeliveryNote({ projectPath, liveUrl, previewsRoot: previewsRoot() });
  const withHandoff = (body: string) =>
    [
      // Keep an open, same-project recovery note when one exists.
      escalationBlock || null,
      body,
      delivery,
      exitContract,
    ]
      .filter(Boolean)
      .join("\n\n");

  if (customPrompt) {
    const intent: OrchestrationTaskIntentId = "custom";
    const body = renderTaskForAdapter(
      {
        projectId,
        projectKey,
        projectPath,
        adapter,
        intent,
        model,
        // Explicit user tasks do not need the project roadmap repeated; the
        // agent reads instructions from the checked-out repository.
        customInstructions: customPrompt.trim(),
      },
      adapter,
    );
    return {
      ok: true,
      prompt: withHandoff(body),
      promptLabel: customPrompt.slice(0, 40),
      intent,
    };
  }

  const key = promptKey!;

  if (isOrchestrationIntent(key)) {
    const intent = getOrchestrationIntent(key);
    const body = renderTaskForAdapter(
      {
        projectId,
        projectKey,
        projectPath,
        adapter,
        intent: key,
        model,
        projectContext,
      },
      adapter,
    );
    return {
      ok: true,
      prompt: withHandoff(body),
      promptLabel: intent.name,
      intent: key,
    };
  }

  const libraryBody = resolveLibraryPromptBody(key);
  if (libraryBody) {
    const contextBlock = renderProjectContextBlock(projectContext);
    const sections = [contextBlock, `Work on the project at ${projectPath}.`, libraryBody].filter(
      Boolean,
    );
    return {
      ok: true,
      prompt: withHandoff(sections.join("\n\n")),
      promptLabel: key,
      intent: undefined,
    };
  }

  return { ok: false, status: 400, error: `Unknown prompt key: ${key}` };
}
