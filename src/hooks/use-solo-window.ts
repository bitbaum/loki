"use client";

import { useBodyClass } from "@/hooks/use-body-class";

const BODY_CLASS = "fc-workbench-solo";

/**
 * A window that exists to show ONE pane — a workbench pane popped out, or on
 * the other screen — is that pane. The sidebar and the top bar are for moving
 * between pages, and this window is not for moving: a person closes it when
 * they are done. Scoped in globals.css to this class, at every width.
 */
export function useSoloWindow(active: boolean) {
  useBodyClass(BODY_CLASS, active);
}
