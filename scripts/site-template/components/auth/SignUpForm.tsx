"use client";
import { SignUpForm as SharedSignUpForm } from "@bitbaum/accountkit/auth/react";
import type { SignInMethods } from "@bitbaum/accountkit/auth";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/routes";
import { authClient } from "@/lib/auth/client";
import { useSharedAuth } from "./shared";
export function SignUpForm(props: { methods: SignInMethods; next: string; signUpPath: string }) {
  const shared = useSharedAuth();
  return (
    <SharedSignUpForm
      {...props}
      {...shared}
      client={authClient}
      signInLink={<Link href={ROUTES.signIn}>{shared.labels.signIn}</Link>}
    />
  );
}
