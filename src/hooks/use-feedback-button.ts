"use client";

import { useSyncExternalStore } from "react";
import {
  feedbackButtonHidden,
  setFeedbackButtonHidden,
  subscribeFeedbackButton,
} from "@/lib/open-feedback";

/**
 * The on/off switch for Loki's own feedback button, in step with the widget's
 * menu. `hidden` is null while there is no widget to switch.
 */
export function useFeedbackButton(): {
  hidden: boolean | null;
  setHidden(hidden: boolean): void;
} {
  const hidden = useSyncExternalStore(subscribeFeedbackButton, feedbackButtonHidden, () => null);
  return { hidden, setHidden: setFeedbackButtonHidden };
}
