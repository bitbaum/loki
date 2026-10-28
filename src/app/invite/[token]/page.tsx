"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { getJson, postJson } from "@/lib/api/fetch";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import {
  AuthShell,
  AuthCard,
  AuthField,
  AuthInput,
  AuthSubmitButton,
  AuthIconBadge,
  AuthHeading,
} from "@/components/auth/AuthShell";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const [status, setStatus] = useState<"loading" | "valid" | "expired" | "used">("loading");
  const [prefillEmail, setPrefillEmail] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getJson<{ valid: boolean; used: boolean; email?: string }>(`/api/invitations/${token}`)
      .then((data) => {
        if (data.valid && !data.used) {
          setStatus("valid");
          if (data.email) setPrefillEmail(data.email);
        } else {
          setStatus(data.used ? "used" : "expired");
        }
      })
      .catch(() => setStatus("expired"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await postJson(`/api/invitations/${token}/accept`, {
        name,
        password,
        ...(email ? { email } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
        return;
      }

      const result = await signIn("user-password", {
        userId: data.userId,
        password,
        redirect: false,
      });
      if (result?.ok) {
        router.push(ROUTES.ONBOARDING);
      } else {
        router.push(ROUTES.SIGN_IN);
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const heading =
    status === "loading"
      ? "Checking…"
      : status === "used"
        ? "Already used"
        : status === "expired"
          ? "Link expired"
          : "You're invited";

  const subheading =
    status === "loading"
      ? "Verifying your invitation link."
      : status === "used"
        ? "This invitation has already been accepted."
        : status === "expired"
          ? "This invitation link is invalid or has expired."
          : prefillEmail
            ? `Joining as ${prefillEmail}.`
            : `Create your ${APP_NAME} account.`;

  const isError = status === "expired" || status === "used";

  return (
    <AuthShell>
      <AuthHeading
        badge={<AuthIconBadge>✦</AuthIconBadge>}
        title={heading}
        description={subheading}
      />

      {isError && (
        <p className="ui-auth-note">
          <Link href={ROUTES.SIGN_IN} className="ui-auth-inline-link">
            Sign in
          </Link>{" "}
          if you already have an account.
        </p>
      )}

      {status === "valid" && (
        <AuthCard>
          <form onSubmit={handleSubmit} className="space-y-4">
            <AuthField label="Your name">
              <AuthInput
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Manu"
                autoComplete="name"
                required
              />
            </AuthField>

            {prefillEmail ? (
              <AuthField label="Email">
                <AuthInput
                  type="email"
                  value={prefillEmail}
                  disabled
                  className="ui-auth-input-disabled"
                />
              </AuthField>
            ) : (
              <AuthField label="Email">
                <AuthInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </AuthField>
            )}

            <AuthField label="Password">
              <AuthInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </AuthField>

            <AuthField label="Confirm password">
              <AuthInput
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                required
              />
            </AuthField>

            {error && <p className="ui-error">{error}</p>}

            <AuthSubmitButton
              loading={submitting}
              disabled={!name || !password || !confirm || (!prefillEmail && !email)}
              label="Create account →"
              loadingLabel="Creating account…"
            />
          </form>
        </AuthCard>
      )}
    </AuthShell>
  );
}
