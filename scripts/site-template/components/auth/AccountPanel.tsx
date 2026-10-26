"use client";
import { AccountPanel as SharedAccountPanel } from "@bitbaum/accountkit/auth/react";
import type { ComponentProps } from "react";
import { authClient } from "@/lib/auth/client";
import { useSharedAuth } from "./shared";
type Props = Pick<
  ComponentProps<typeof SharedAccountPanel>,
  "user" | "linked" | "methods" | "accountPath" | "homePath"
>;
export function AccountPanel(props: Props) {
  return <SharedAccountPanel {...props} {...useSharedAuth()} client={authClient} />;
}
