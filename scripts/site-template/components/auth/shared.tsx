"use client";
import { useLocale } from "next-intl";
import { authLabelsFor } from "@bitbaum/accountkit/auth";
/** Product locale adapter; controls and their states/styles belong to accountkit. */
export function useSharedAuth() {
  return { labels: authLabelsFor(useLocale()) };
}
