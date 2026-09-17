"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  AuthShell,
  AuthCard,
  CreateAccountFields,
  AuthSubmitButton,
  AuthFooterLink,
  AuthHeading,
  AuthDivider,
} from "@/components/auth/AuthShell";
import { OAuthButtons, hasAnyOAuth, type OAuthEnabledFlags } from "@/components/auth/OAuthButtons";
import { postJson } from "@/lib/api/fetch";
import { AUTH_COPY, ROUTES } from "@/config/auth";

export function SignUpForm({ oauthFlags }: { oauthFlags: OAuthEnabledFlags }) {
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
      if (result?.ok) {
        // Claim before onboarding can redirect the new account. This preserves
        // the visitor's report even when onboarding takes place first.
        const claimUrl = new URL(safeCallback, window.location.origin);
        const claimToken =
          claimUrl.pathname === "/claim-feedback" ? claimUrl.searchParams.get("token") : null;
        if (claimToken) await postJson("/api/feedback/claim", { token: claimToken });
        router.push(safeCallback);
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
      <AuthHeading title={AUTH_COPY.signUp.title} description={AUTH_COPY.signUp.description} />

      <AuthCard>
        {/* OAuth first: signing up via an existing identity (OrangeCat above
            all — one account across the stack) beats minting a new password
            silo. First OAuth sign-in creates the account, so these are as
            much "sign up" buttons as the form below. */}
        {hasAnyOAuth(oauthFlags) && (
          <>
            <OAuthButtons flags={oauthFlags} callbackUrl={safeCallback} />
            <AuthDivider label="or with email" />
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            disabled={!name || !email || !password || !confirm}
            label="Create account →"
            loadingLabel="Creating account…"
          />
        </form>
      </AuthCard>

      <AuthFooterLink href={ROUTES.SIGN_IN}>Already have an account? Sign in →</AuthFooterLink>
    </AuthShell>
  );
}
