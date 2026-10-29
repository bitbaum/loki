"use client";
import { SignInForm as SharedSignInForm } from "@bitbaum/accountkit/auth/react";
import type { SignInMethods } from "@bitbaum/accountkit/auth";
import { Link } from "@/i18n/navigation";
import { ROUTES } from "@/lib/routes";
import { authClient } from "@/lib/auth/client";
import { useSharedAuth } from "./shared";
export function SignInForm(props: {
  methods: SignInMethods;
  next: string;
  signInPath: string;
  initialError: boolean;
}) {
  const shared = useSharedAuth();
  return (
    <SharedSignInForm
      {...props}
      {...shared}
      client={authClient}
      signUpLink={<Link href={ROUTES.signUp}>{shared.labels.createAccount}</Link>}
    />
  );
}
