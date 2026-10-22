"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AuthShell,
  AuthCard,
  AuthField,
  AuthInput,
  AuthSubmitButton,
  AuthFooterLink,
  AuthHeading,
} from "@/components/auth/AuthShell";
import { postJson } from "@/lib/api/fetch";
import { AUTH_COPY, ROUTES } from "@/config/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await postJson("/api/auth/forgot-password", { email });
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <AuthHeading
          title={AUTH_COPY.forgot.sentTitle}
          description={AUTH_COPY.forgot.sentDescription(email)}
        />
        <AuthFooterLink href={ROUTES.SIGN_IN}>← Back to sign in</AuthFooterLink>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading title={AUTH_COPY.forgot.title} />

      <AuthCard>
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthField label="Email">
            <AuthInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              autoFocus
            />
          </AuthField>

          {error && <p className="ui-error">{error}</p>}

          <AuthSubmitButton loading={loading} label="Send reset link" loadingLabel="Sending…" />
        </form>
      </AuthCard>

      <p className="mt-4 text-center text-xs text-text-muted">
        Remember it?{" "}
        <Link href={ROUTES.SIGN_IN} className="ui-auth-hint-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
