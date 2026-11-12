"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  AuthShell,
  AuthCard,
  CreateAccountFields,
  AuthSubmitButton,
  AuthHeading,
  AuthDivider,
} from "@/components/auth/AuthShell";
import { FirstWordsNote } from "@/components/auth/FirstWordsNote";
import { OAuthButtons, hasAnyOAuth, type OAuthEnabledFlags } from "@/components/auth/OAuthButtons";
import { SignInLinkButton } from "@/components/auth/SharedWaysIn";
import { DEFAULT_AUTH_LABELS } from "@bitbaum/accountkit/auth/react";
import Link from "next/link";
import type { SignInMethods } from "@bitbaum/accountkit/auth";
import { LokiSignUp } from "@/components/auth/AccountKitAuth";
import { postJson } from "@/lib/api/fetch";
import { AUTH_COPY, fromSiteWidget, keepCallback, ROUTES } from "@/config/auth";
import { goAfterSignIn } from "@/lib/auth/after-sign-in";
import { signInSucceeded } from "@/lib/auth/sign-in-result";

export function SignUpForm({
  oauthFlags,
  magicLinkEnabled = false,
  accountKit = null,
}: {
  oauthFlags: OAuthEnabledFlags;
  /** AccountKit's own sign-up (AUTH_RUNTIME=accountkit): an email and a password, nothing else. */
  accountKit?: SignInMethods | null;
  /** AccountKit runtime with account mail: create the account by a link instead. */
  magicLinkEnabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? ROUTES.ONBOARDING;
  const safeCallback =
    callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : ROUTES.ONBOARDING;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // The password form is kept for people who want one, but it is no longer
  // the default: a new account is an OrangeCat account (one across the
  // stack), so the form waits behind a single line until asked for.
  const [showPassword, setShowPassword] = useState(!hasAnyOAuth(oauthFlags));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await postJson("/api/auth/register", { name, email, password });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
        return;
      }

      const result = await signIn("email-password", { email, password, redirect: false });
      if (signInSucceeded(result)) {
        // Claim before onboarding can redirect the new account. This preserves
        // the visitor's report even when onboarding takes place first.
        const claimUrl = new URL(safeCallback, window.location.origin);
        const claimToken =
          claimUrl.pathname === "/claim-feedback" ? claimUrl.searchParams.get("token") : null;
        if (claimToken) await postJson("/api/feedback/claim", { token: claimToken });
        goAfterSignIn(router.push, safeCallback);
      } else {
        router.push(ROUTES.SIGN_IN);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthHeading title={DEFAULT_AUTH_LABELS.createAccount} />
      <FirstWordsNote />
      {fromSiteWidget(safeCallback) && <p className="ui-auth-hint">{AUTH_COPY.fromSite.signUp}</p>}

      {accountKit ? (
        <AuthCard>
          <LokiSignUp
            methods={accountKit}
            next={safeCallback}
            signInHref={keepCallback(ROUTES.SIGN_IN, safeCallback, ROUTES.ONBOARDING)}
          />
        </AuthCard>
      ) : (
        <AuthCard>
          {/* OAuth first: signing up via an existing identity (OrangeCat above
            all — one account across the stack) beats minting a new password
            silo. First OAuth sign-in creates the account, so these are as
            much "sign up" buttons as the form below. */}
          {hasAnyOAuth(oauthFlags) && (
            <>
              <OAuthButtons flags={oauthFlags} callbackUrl={safeCallback} intent="sign-up" />
              {showPassword ? (
                <AuthDivider label="or with a password" />
              ) : (
                <p className="pt-2 text-center text-sm text-text-muted">
                  Prefer a password just for Loki?{" "}
                  <button
                    type="button"
                    onClick={() => setShowPassword(true)}
                    className="text-text-secondary underline hover:text-text-primary"
                  >
                    Create one
                  </button>
                </p>
              )}
            </>
          )}

          <form onSubmit={handleSubmit} className={showPassword ? "space-y-4" : "hidden"}>
            <CreateAccountFields
              name={name}
              onName={setName}
              namePlaceholder="e.g. Manu"
              email={email}
              onEmail={setEmail}
              password={password}
              onPassword={setPassword}
              confirm={confirm}
              onConfirm={setConfirm}
            />

            {error && <p className="ui-error">{error}</p>}

            <AuthSubmitButton
              loading={loading}
              label={DEFAULT_AUTH_LABELS.createAccount}
              loadingLabel="Creating account…"
            />
            {magicLinkEnabled && (
              <SignInLinkButton
                email={email}
                name={name.trim() || undefined}
                callbackUrl={safeCallback}
                label={DEFAULT_AUTH_LABELS.signUpWithLink}
              />
            )}
          </form>
        </AuthCard>
      )}

      {!accountKit && (
        <p className="ui-auth-hint">
          {DEFAULT_AUTH_LABELS.haveAccount}{" "}
          <Link
            href={keepCallback(ROUTES.SIGN_IN, safeCallback, ROUTES.ONBOARDING)}
            className="ui-auth-hint-link"
          >
            {DEFAULT_AUTH_LABELS.signIn}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
