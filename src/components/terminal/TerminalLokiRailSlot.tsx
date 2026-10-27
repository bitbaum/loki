"use client";

import type { ComponentProps } from "react";
import { TerminalLokiRail } from "./TerminalLokiRail";

type RailProps = ComponentProps<typeof TerminalLokiRail>;

/**
 * Loki's panel beside (or, on a phone, over) a session. It only ASKS: the
 * session box under the terminal is where words for the agent go, in both
 * views, so a summary's step lands there as a draft rather than being sent.
 */
export function TerminalLokiRailSlot({
  project,
  channel,
  runId,
  explainer,
  setDraft,
  ...rest
}: Omit<RailProps, "key" | "askOnly" | "explain" | "onStep" | "runId"> & {
  runId: string | null;
  explainer: NonNullable<RailProps["explain"]> & { setSheetOpen: (open: boolean) => void };
  setDraft: (draft: { text: string; nonce: number }) => void;
  channel: string;
}) {
  return (
    <TerminalLokiRail
      key={`${project}:${runId ?? "latest"}:${channel}`}
      project={project}
      runId={runId}
      askOnly
      explain={explainer}
      onStep={(text) => {
        setDraft({ text, nonce: Date.now() });
        explainer.setSheetOpen(false);
      }}
      {...rest}
    />
  );
}
