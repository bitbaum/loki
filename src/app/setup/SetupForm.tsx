"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { postJson } from "@/lib/api/fetch";
import { ROUTES } from "@/config/auth";
import { APP_NAME } from "@/config/brand";
import {
  AuthShell,
  AuthCard,
  CreateAccountFields,
  AuthSubmitButton,
  AuthIconBadge,
  AuthHeading,
} from "@/components/auth/AuthShell";

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
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
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await postJson("/api/setup", { name, password });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Setup failed.");
        return;
      }

      const signInRes = await signIn("user-password", {
        userId: data.userId as string,
        password,
        redirect: false,
      });
      if (!signInRes?.ok) {
        setError("Account created — sign in with your password.");
        router.push(ROUTES.SIGN_IN);
        return;
      }
      router.push(ROUTES.APP_HOME);
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthHeading
        badge={<AuthIconBadge>✦</AuthIconBadge>}
        title={`Set up ${APP_NAME}`}
        description="Create your admin account to get started."
      />

      <AuthCard>
        <form onSubmit={handleSubmit} className="space-y-4">
          <CreateAccountFields
            name={name}
            onName={setName}
            namePlaceholder="e.g. Alex"
            password={password}
            onPassword={setPassword}
            confirm={confirm}
            onConfirm={setConfirm}
          />

          {error && <p className="ui-error">{error}</p>}

          <AuthSubmitButton
            loading={loading}
            disabled={!name || !password || !confirm}
            label="Create account →"
            loadingLabel="Creating account…"
          />
        </form>
      </AuthCard>

      <p className="ui-auth-footer">
        After setup you&apos;ll land in the app signed in. Already have an account?{" "}
        <Link href={ROUTES.SIGN_IN} className="ui-auth-footer-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
