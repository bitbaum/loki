import type { ProjectState } from "@/lib/control-types";
import type { OrchestrationTaskIntentId } from "@/lib/orchestration";
import type { PromptMeta } from "@/lib/agent-config";
import type { AutoInjectMode } from "@/config/beacon";
import { TOAST_LONG_MS } from "@/lib/constants/timings";
import type { Attachment } from "@/lib/loki/attachments";
import { EXECUTOR_COPY } from "@/config/executor-copy";

type RegistryEntry = {
  id: string;
  label: string;
  modelSuggestions: string[];
  available?: boolean;
  availabilityReason?: string;
};

type Deps = {
  prompts: PromptMeta[];
  liveTabs: string[];
  selectedAgent: string;
  switchableRegistry: RegistryEntry[];
  /** Operator's provider ranking from the snapshot; null = fleet default. */
  agentOrder: string[] | null;
  inject: (
    tab: string,
    promptKey?: string,
    customPrompt?: string,
    attachments?: Attachment[],
  ) => Promise<{
    mode: "queued" | "direct";
    runnerConnected: boolean | null;
    commandId: string | null;
  }>;
  runWithBrain: (project: ProjectState, intent: OrchestrationTaskIntentId) => Promise<void>;
  runCustomPrompt: (project: ProjectState, prompt: string, agent: string) => Promise<void>;
  setError: (error: string | null) => void;
  setQueuedNotice: (notice: string | null) => void;
  refresh: (clear?: boolean) => void;
  openLaunchModal: (project: ProjectState) => void;
  runtimeAvailable: boolean;
  runtimeStateKnown: boolean;
  /** The hosted runner serves this account (control-types.ts). */
  hostedBuilderAvailable: boolean;
  runnerSyncStale: boolean;
  /** Fleet-wide: builder connected but queued dispatches aren't executing. */
  executionStalled: boolean;
  automationMode: AutoInjectMode;
  countdownSeconds: number | undefined;
  /** ControlPanel's per-render clock (unix seconds) — one Date.now() per
   *  render tree, so the card's staleness math matches the snapshots'. */
  nowS: number;
};

/**
 * Builds the per-project props bag consumed by <ProjectCard /> from the
 * ControlPanel render. Extracted out of ControlPanel.tsx because it was 45
 * lines of callback-wrapping noise that obscured the page's actual render
 * flow. Returns a closure: pass the deps once per render, then invoke per
 * project to get its props.
 *
 * The try/catch around each async callback exists because the per-card
 * `useProjectCardActions` hook needs to render an inline error near the
 * Send button (caught during a mobile dogfood where the global error
 * banner sat off-screen). Setting the global error AND re-throwing gives
 * both surfaces — keep both calls in any future edits.
 */
export function buildCardProps(deps: Deps) {
  const availableAgents = deps.switchableRegistry.map(
    ({ id, label, modelSuggestions, available, availabilityReason }) => ({
      id,
      label,
      modelSuggestions,
      available,
      availabilityReason,
    }),
  );

  return (project: ProjectState) => ({
    project,
    prompts: deps.prompts,
    liveTabs: deps.liveTabs,
    currentAdapter: deps.selectedAgent,
    availableAgents: onProjectBuilder(availableAgents, project),
    agentOrder: deps.agentOrder,
    onInject: async (
      tab: string,
      promptKey?: string,
      customPrompt?: string,
      attachments?: Attachment[],
    ) => {
      try {
        const { mode, runnerConnected, commandId } = await deps.inject(
          tab,
          promptKey,
          customPrompt,
          attachments,
        );
        if (mode === "queued") {
          const msg =
            runnerConnected === false
              ? EXECUTOR_COPY.queuedWhenOffline
              : EXECUTOR_COPY.queuedWithBuilderOnline;
          deps.setQueuedNotice(`${msg} (${tab})`);
          setTimeout(() => deps.setQueuedNotice(null), TOAST_LONG_MS);
        }
        // Hand the queued command id back so the card can track its real
        // lifecycle. Without this the card only ever saw the ambient dir state.
        return { commandId };
      } catch (err) {
        deps.setError(err instanceof Error ? err.message : "Injection failed");
        throw err;
      }
    },
    onRunWithBrain: async (projectState: ProjectState, intent: OrchestrationTaskIntentId) => {
      try {
        await deps.runWithBrain(projectState, intent);
      } catch (err) {
        deps.setError(err instanceof Error ? err.message : "Failed to run task");
        throw err;
      }
    },
    onRunCustomPrompt: async (projectState: ProjectState, prompt: string, ag: string) => {
      try {
        await deps.runCustomPrompt(projectState, prompt, ag);
      } catch (err) {
        deps.setError(err instanceof Error ? err.message : "Failed to run prompt");
        throw err;
      }
    },
    onLaunch: () => deps.openLaunchModal(project),
    runtimeAvailable: deps.runtimeAvailable,
    runtimeStateKnown: deps.runtimeStateKnown,
    hostedBuilderAvailable: deps.hostedBuilderAvailable,
    runnerSyncStale: deps.runnerSyncStale,
    executionStalled: deps.executionStalled,
    automationMode: deps.automationMode,
    countdownSeconds: deps.countdownSeconds,
    nowS: deps.nowS,
  });
}

const BUILDER_WORDS = { cloud: "the cloud runner", local: "your computer" } as const;

/**
 * Each project is offered the agents installed on the builder that will run
 * it. The panel-wide list reads the computer's report first, so a cloud
 * project used to be offered Codex because the laptop had it — and the
 * dispatch then started a session for a program the cloud builder does not
 * have. A builder that has not reported leaves the rows as they were.
 */
export function onProjectBuilder<T extends { id: string; label: string; available?: boolean }>(
  agents: readonly T[],
  project: Pick<ProjectState, "builderChannel" | "builderAgents">,
): (T & { availabilityReason?: string; unavailableNote?: string })[] {
  const channel = project.builderChannel;
  const installed = project.builderAgents;
  if (!channel || !installed) return [...agents];
  const where = BUILDER_WORDS[channel];
  return agents.map((agent) =>
    installed.includes(agent.id)
      ? { ...agent, available: true, availabilityReason: undefined }
      : {
          ...agent,
          available: false,
          availabilityReason: `${agent.label} is not installed on ${where}, which runs this project.`,
          unavailableNote: `not on ${where}`,
        },
  );
}
