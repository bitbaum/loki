import { EXECUTOR_COPY } from "@/config/executor-copy";

export type ExecutorHonestyKind =
  "queued" | "needs-builder" | "needs-github" | "needs-gateway" | "builder-starting";

export interface ExecutorHonestyLabel {
  kind: ExecutorHonestyKind;
  label: string;
  title: string;
}

export type ExecutorHonestyInput = {
  /** Cloud and/or desktop builder connected (from bridge presence). */
  runnerConnected: boolean | null;
  /** True when this machine hosts the local runtime (owned PTYs). */
  runtimeAvailable?: boolean;
  /** Action requires linked GitHub repo / CI. */
  needsGitHub?: boolean;
  /** Loki chat path needs OpenClaw gateway (not Groq fallback). */
  needsGateway?: boolean;
  /**
   * Which builder this surface is scoped to. When set, connectivity labels
   * name it explicitly ("Cloud builder online" / "This computer offline") —
   * a bare "Builder online" next to a Cloud/This computer switch reads as a
   * third mode, and says nothing about WHICH builder it describes.
   */
  scope?: "cloud" | "machine";
  /**
   * Which builders are connected, for unscoped surfaces (Loki chat). A bare
   * "Builder online" there sat beside a Terminal showing the cloud builder
   * grey — both true, since only the laptop was up, but it read as a
   * contradiction and left the person guessing where their work would run.
   */
  presence?: { cloud: boolean; local: boolean } | null;
};

/** SSOT for short honesty chips on Control / Loki / Terminal actions. */
export function deriveExecutorHonestyLabel(
  input: ExecutorHonestyInput,
): ExecutorHonestyLabel | null {
  if (input.needsGateway) {
    return {
      kind: "needs-gateway",
      label: EXECUTOR_COPY.honesty.needsGateway,
      title:
        "Loki brain runs on the OpenClaw gateway. Without it, chat may fall back to Groq or show unavailable.",
    };
  }
  if (input.needsGitHub) {
    return {
      kind: "needs-github",
      label: EXECUTOR_COPY.honesty.needsGitHub,
      title: "Link this project to a GitHub repo in Projects before this action can run.",
    };
  }
  if (input.runtimeAvailable) {
    return null;
  }
  if (input.runnerConnected === true) {
    return {
      kind: "builder-starting",
      label:
        input.scope === "machine"
          ? EXECUTOR_COPY.builder.localComputerOnline
          : input.scope === "cloud"
            ? EXECUTOR_COPY.builder.cloudOnline
            : namedOnline(input.presence),
      title: EXECUTOR_COPY.queuedWithBuilderOnlineLong,
    };
  }
  if (input.runnerConnected === false || input.runnerConnected === null) {
    return {
      kind: "needs-builder",
      label:
        input.scope === "machine"
          ? EXECUTOR_COPY.builder.localComputerOffline
          : input.scope === "cloud"
            ? EXECUTOR_COPY.builder.cloudOffline
            : EXECUTOR_COPY.honesty.needsBuilder,
      title: EXECUTOR_COPY.queuedWhenOfflineLong,
    };
  }
  return {
    kind: "queued",
    label: EXECUTOR_COPY.honesty.queued,
    title: EXECUTOR_COPY.queuedWhenOfflineLong,
  };
}

/**
 * Name the builder when only one is up — that is the case that read as a
 * contradiction. Both up keeps the short generic label: nothing to reconcile,
 * and the composer row has no room for "Cloud + this computer online".
 */
function namedOnline(presence: ExecutorHonestyInput["presence"]): string {
  if (presence?.cloud && !presence.local) return EXECUTOR_COPY.builder.cloudOnline;
  if (presence?.local && !presence.cloud) return EXECUTOR_COPY.builder.localComputerOnline;
  return EXECUTOR_COPY.honesty.builderStarting;
}
