"use client";

import { useSyncExternalStore } from "react";
import { readFirstWords } from "@/lib/first-words";

const subscribe = () => () => {};

/**
 * Shows a visitor's homepage sentence back to them on the way in, so the form
 * in front of them is plainly a step toward what they asked for and not a
 * place where it was lost. Renders nothing when nothing was said.
 */
export function FirstWordsNote() {
  // sessionStorage exists only in the browser: null on the server and on the
  // first client render, the saved sentence after hydration.
  const words = useSyncExternalStore(subscribe, readFirstWords, () => null);
  if (!words) return null;
  return (
    <p className="ui-auth-carried">
      <span className="ui-auth-carried-label">You said</span>
      <span className="ui-auth-carried-words">{words}</span>
    </p>
  );
}
