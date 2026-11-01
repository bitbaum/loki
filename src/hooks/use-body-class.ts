"use client";

import { useEffect } from "react";

/** A page state the shell's CSS reads from `<body>`, held only while the
 *  component that asked for it is mounted and `active`. */
export function useBodyClass(className: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add(className);
    return () => document.body.classList.remove(className);
  }, [className, active]);
}
