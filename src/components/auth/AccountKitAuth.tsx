"use client";

/**
 * AccountKit's own screens in Loki's look: sign-in, sign-up, recovery and the
 * account panel, the same screens every fleet app shows. The words are
 * AccountKit's; Loki keeps what is its own around them (the heading, the
 * site-widget hint, the demo, its own account deletion).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import {
  AccountPanel,
  DEFAULT_AUTH_LABELS as L,
  PasswordRecoveryForm,
  SignInForm,
  SignUpForm,
  type AuthClasses,
} from "@bitbaum/accountkit/auth/react";
import type { SignInMethods } from "@bitbaum/accountkit/auth";
import { sharedAuthClient } from "@/lib/auth/shared/client";
import { ROUTES } from "@/config/auth";

/** Loki's auth classes for the parts it styles; dividers and the eye are AccountKit's. */
export const LOKI_AUTH_CLASSES: Partial<AuthClasses> = {
  button: "ui-auth-submit-btn",
  buttonQuiet: "ui-auth-secondary-btn",
  input: "ui-auth-input",
  label: "ui-auth-label",
  hint: "ui-auth-hint",
  error: "ui-error",
  link: "ui-auth-hint-link",
  stack: "space-y-3",
  field: "space-y-1.5",
};

/**
 * "Create an account" offered "Sign in with a Lightning wallet": a newcomer
 * with no account was told to sign in (2026-11-12). The sign-up screen says
 * continue, as every other button on it does.
 */
const SIGN_UP_LABELS: typeof L = {
  ...L,
  lightning: L.lightning && { ...L.lightning, withLightning: "Continue with a Lightning wallet" },
};

export function LokiSignIn({
  methods,
  next,
  signUpHref,
  initialError,
}: {
  methods: SignInMethods;
  next: string;
  signUpHref: string;
  initialError: boolean;
}) {
  return (
    <SignInForm
      client={sharedAuthClient}
      methods={methods}
      labels={L}
      classes={LOKI_AUTH_CLASSES}
      next={next}
      signInPath={ROUTES.SIGN_IN}
      initialError={initialError}
      signUpLink={
        <Link href={signUpHref} className="ui-auth-hint-link">
          {L.createAccount}
        </Link>
      }
    />
  );
}

export function LokiSignUp({
  methods,
  next,
  signInHref,
}: {
  methods: SignInMethods;
  next: string;
  signInHref: string;
}) {
  return (
    <SignUpForm
      client={sharedAuthClient}
      methods={methods}
      labels={SIGN_UP_LABELS}
      classes={LOKI_AUTH_CLASSES}
      next={next}
      signUpPath={ROUTES.SIGN_UP}
      signInPath={ROUTES.SIGN_IN}
      signInLink={
        <Link href={signInHref} className="ui-auth-hint-link">
          {L.signIn}
        </Link>
      }
    />
  );
}

export function LokiRecovery({ methods }: { methods: SignInMethods }) {
  return (
    <PasswordRecoveryForm
      client={sharedAuthClient}
      methods={methods}
      labels={L}
      classes={LOKI_AUTH_CLASSES}
      signInPath={ROUTES.SIGN_IN}
      next={ROUTES.APP_HOME}
      onBack={() => window.location.assign(ROUTES.SIGN_IN)}
    />
  );
}

export function LokiAccountPanel({
  methods,
  user,
  linked,
  deletion,
}: {
  methods: SignInMethods;
  user: {
    name: string;
    email: string | null;
    emailVerified: boolean;
    role: string;
    twoFactorEnabled: boolean;
  };
  linked: string[];
  deletion: ReactNode;
}) {
  return (
    <AccountPanel
      client={sharedAuthClient}
      methods={methods}
      labels={L}
      classes={{
        ...LOKI_AUTH_CLASSES,
        section: "space-y-3 border-t border-border-subtle pt-4",
        sectionTitle: "ui-kicker",
      }}
      user={user}
      linked={linked}
      accountPath="/settings"
      homePath={ROUTES.APP_HOME}
      // Loki's settings page edits the name (its own `users` row).
      ownProfile
      deletion={deletion}
    />
  );
}
