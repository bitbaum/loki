"use client";

import { useEffect } from "react";

const BODY_CLASS = "fc-chat-immersive";

/**
 * While a conversation is open on a phone, the conversation IS the screen.
 *
 * The app top bar and the bottom tab bar are for moving between pages; inside
 * a thread they were two more bands of chrome around a ~40%-tall transcript.
 * Every texting app hands the whole screen to the thread and gives it its own
 * one-line header with a way back — the thread header does that here. Scoped
 * to below md in CSS, so a laptop keeps its sidebar and top bar.
 */
export function useImmersiveChat(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add(BODY_CLASS);
    return () => document.body.classList.remove(BODY_CLASS);
  }, [active]);
}
