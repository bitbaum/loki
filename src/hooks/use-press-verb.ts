"use client";

import { useMediaQuery } from "@/hooks/use-media-query";
import { pressVerbFor, TOUCH_POINTER_QUERY, type PressVerb } from "@/lib/pointer-verb";

/** "tap" or "click", following the device in the person's hand (lib/pointer-verb). */
export function usePressVerb(): PressVerb {
  return pressVerbFor(useMediaQuery(TOUCH_POINTER_QUERY));
}
