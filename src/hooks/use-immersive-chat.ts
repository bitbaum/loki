"use client";

import { useBodyClass } from "@/hooks/use-body-class";

const BODY_CLASS = "fc-chat-immersive";

/**
 * While a chat is on a phone, the chat IS the screen.
 *
 * The app top bar and the bottom tab bar are for moving between pages; around
 * a thread they were two more bands of chrome around a ~40%-tall transcript,
 * and around /loki's start screen four bands around a clipped inner scroller
 * (owner, 2026-10-21). Every texting app hands the whole screen to the chat
 * and gives it its own one-line header with a way back or a way to the rest —
 * ThreadHeader does that here, in both its shapes. Scoped to below md in CSS,
 * so a laptop keeps its sidebar and top bar.
 */
export function useImmersiveChat(active: boolean) {
  useBodyClass(BODY_CLASS, active);
}
