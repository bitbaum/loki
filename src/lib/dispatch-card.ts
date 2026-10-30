/**
 * What the card under a Loki dispatch says, and the ONE thing it offers next.
 *
 * It used to show "Queued  waiting for a builder to pick it up  Target: loki"
 * over three equal buttons — Control state, Cloud terminal, This computer (with
 * an external-link icon, though it opened a page in the same tab) — on a
 * dispatch that had gone to this computer and was waiting for it. Two of the
 * three buttons led to a terminal with nothing in it, and none said what to do
 * about the waiting. Operator, 2026-10-05: "confusing".
 *
 * Now: a headline that says where the work is, a line that says what happens
 * next, and one primary action chosen by state — watch it while it runs, fix
 * the thing it waits on, open it in Control when it failed. Everything else is
 * one quiet secondary link.
 */
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { withTerminalView } from "@/lib/fleet-context";
import { builderWayForward, type CloudBuilderState } from "@/lib/builder-way-forward";
import type { BuilderChannel, StatusTone } from "@/lib/constants/statuses";
import type { DispatchLiveStatus } from "@/lib/dispatch-status";

export type DispatchCardLink = { label: string; href: string };

/** A primary that DOES something here, rather than leading somewhere. */
export type DispatchCardAction = { label: string; action: "run-in-cloud" };

export type DispatchCardView = {
  headline: string;
  detail: string | null;
  tone: StatusTone;
  primary: DispatchCardLink | DispatchCardAction | null;
  secondary: DispatchCardLink[];
};

export function isDispatchCardAction(
  primary: DispatchCardView["primary"],
): primary is DispatchCardAction {
  return primary !== null && "action" in primary;
}

export type DispatchCardInput = {
  /** The live lifecycle, when this dispatch has a command/run to poll. */
  live: {
    status: DispatchLiveStatus;
    label: string;
    detail: string | null;
    tone: StatusTone;
  } | null;
  /** The frozen dispatch-time label (dispatchStatusLabel) and whether it warned. */
  staticLabel: string;
  warn: boolean;
  failed: boolean;
  /** The builder it went to; null for messages from before routing was recorded. */
  channel: BuilderChannel | null;
  /** A project that actually started (or the single target). */
  project: string | null;
  projectCount: number;
  /**
   * The cloud builder as this account sees it right now. Decides what a
   * dispatch that waits for "this computer" is offered: the cloud (one tap,
   * nothing to install) when the account has it, the download only when the
   * cloud is private. Defaults to unknown, which offers neither.
   */
  cloud?: CloudBuilderState;
};

/** The terminal that can show THIS dispatch — not one per builder. */
export function terminalHref(project: string, channel: BuilderChannel | null): string {
  const p = encodeURIComponent(project);
  return channel === "local" ? `/terminal?source=machine&tab=${p}` : `/terminal?project=${p}`;
}

/** "Watch it" opens the agent's conversation; the raw terminal is one tap away
 *  on the same page. */
export function watchHref(project: string, channel: BuilderChannel | null): string {
  return withTerminalView(terminalHref(project, channel), "chat");
}

const controlHref = (project: string) => `/control?focus=${encodeURIComponent(project)}`;

export function presentDispatchCard(input: DispatchCardInput): DispatchCardView {
  const { live, project, channel } = input;
  const on = channel ? EXECUTOR_COPY.ranOn[channel] : null;
  const watch = project ? { label: "Watch it", href: watchHref(project, channel) } : null;
  const control = project ? { label: "Open on Home", href: controlHref(project) } : null;
  const all =
    input.projectCount > 1
      ? [{ label: `All ${input.projectCount} on Home`, href: "/control" }]
      : [];
  const only = (...links: (DispatchCardLink | null)[]) => [
    ...links.filter((l): l is DispatchCardLink => l !== null),
    ...all,
  ];

  if (input.failed || live?.tone === "negative") {
    return {
      headline: live?.label ?? "Dispatch failed",
      detail: live?.detail ?? "Nothing is running. Control shows why and can retry it.",
      tone: "negative",
      primary: control,
      secondary: only(watch),
    };
  }

  // Waiting on a builder that is not there. The useful facts are which one,
  // that nothing is lost, and what wakes it — not three terminals to stare at.
  const waiting = live ? live.status === "queued" : input.warn;
  if (waiting && input.warn) {
    return presentWaiting(input, on, control, only);
  }

  if (live && (live.status === "completed" || live.status === "partial")) {
    return {
      headline: live.label,
      detail: live.detail,
      tone: live.tone,
      primary: control ? { label: "See the result", href: control.href } : null,
      secondary: only(watch),
    };
  }

  if (live && (live.status === "unconfirmed" || live.status === "stopped")) {
    return {
      headline: live.label,
      detail: live.detail,
      tone: live.tone,
      primary: watch,
      secondary: only(control),
    };
  }

  // Queued with a builder online, picked up, delivered, working: it is (about
  // to be) on a screen somewhere — that screen is the next step.
  return {
    headline: live?.label ?? input.staticLabel,
    detail: live?.detail ?? null,
    tone: live?.tone ?? "positive",
    primary: watch,
    secondary: only(control),
  };
}

const download: DispatchCardLink = { label: "Connect Fleet Runner", href: "/download" };

/**
 * Queued for a builder that is not there. What wakes it depends on the
 * account, not on the device reading the card: "Connect Fleet Runner" was the
 * one offer here, and from a second computer it sent the owner — whose cloud
 * builder was online — to download an app (2026-10-12).
 */
function presentWaiting(
  input: DispatchCardInput,
  on: string | null,
  control: DispatchCardLink | null,
  only: (...links: (DispatchCardLink | null)[]) => DispatchCardLink[],
): DispatchCardView {
  const local = input.channel === "local";
  const headline = on ? `Waiting for ${on}` : "Waiting for a runner";
  if (!local) {
    return {
      headline,
      detail: "No runner is online. The work stays queued and starts the moment one connects.",
      tone: "warning",
      primary: control,
      secondary: only(),
    };
  }
  const way = builderWayForward({ cloud: input.cloud ?? "unknown", waitingOn: "local" });
  switch (way) {
    case "run-in-cloud":
      return {
        headline,
        detail:
          "Fleet Runner isn't connected on that computer. The cloud runner is online and can take this now — nothing to install.",
        tone: "warning",
        primary: { label: "Run it in the cloud", action: "run-in-cloud" },
        secondary: only(control),
      };
    case "wait-for-cloud":
      return {
        headline,
        detail:
          "Fleet Runner isn't connected on that computer, and the cloud runner is offline too. The work stays queued; it starts the moment either is back.",
        tone: "warning",
        primary: control,
        secondary: only(),
      };
    case "connect-fleet-runner":
      return {
        headline,
        detail:
          "Fleet Runner isn't connected on this computer. The work stays queued and starts the moment it connects.",
        tone: "warning",
        primary: download,
        secondary: only(control),
      };
    case "unknown":
      return {
        headline,
        detail:
          "Fleet Runner isn't connected on that computer. The work stays queued; nothing is lost.",
        tone: "warning",
        primary: control,
        secondary: only(download),
      };
  }
}
