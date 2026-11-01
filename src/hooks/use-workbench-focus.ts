"use client";

import { useBodyClass } from "@/hooks/use-body-class";

const BODY_CLASS = "fc-workbench-focus";

/**
 * The workbench is a focus screen: while it is open, the app's sidebar,
 * top bar and the project strip ("Profile · Chat · Home · Sessions") are
 * gone, at every width. They are for moving between pages, and a person
 * on the workbench is not moving — they are building one thing, and the
 * way out is the one back link in its header. The same holds, more so,
 * for a window that is one pane (`?pane=`). Scoped in globals.css to this
 * class. On a phone the workbench is rows and keeps the phone's chrome.
 */
export function useWorkbenchFocus(active: boolean) {
  useBodyClass(BODY_CLASS, active);
}
