"use client";
import { useState } from "react";
import type { AutoInjectMode } from "@/config/beacon";

/** One optimistic effective setting for the control and its surrounding copy. */
export function useProjectAutopilot(
  current: AutoInjectMode | null | undefined,
  inherited: AutoInjectMode,
) {
  const source = current ?? null;
  const [state, setState] = useState({ source, value: source });
  if (state.source !== source) setState({ source, value: source });
  const override = state.source === source ? state.value : source;
  return {
    override,
    effectiveMode: override ?? inherited,
    setOverride: (value: AutoInjectMode | null) => setState({ source, value }),
  };
}
