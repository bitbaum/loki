"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { SignInMethods } from "@/lib/auth/methods";
import { authClient } from "@/lib/auth/client";
import { buttonQuiet, errorText } from "@/components/ui";

/** The error shape better-auth's client returns, plus our own guard's answers. */
export type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

const KNOWN = [
  "INVALID_EMAIL_OR_PASSWORD",
  "EMAIL_NOT_VERIFIED",
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "INVALID_EMAIL",
  "INVALID_CODE",
  "INVALID_TWO_FACTOR_CODE",
  "SESSION_EXPIRED",
  "INVALID_PASSWORD",
] as const;

/**
 * A failure in words, never a raw code: what happened and what to do next
 * (fleet AGENTS.md, "No dead ends"). Unknown codes get the generic sentence —
 * a provider's message can carry details the person should not be shown.
 */
export function useAuthErrorText() {
  const t = useTranslations("Auth.errors");
  return (error: AuthError): string | null => {
    if (!error) return null;
    if (error.status === 429) return t("rateLimited");
    if (error.status === 503) return t("unavailable");
    const code = error.code as (typeof KNOWN)[number] | undefined;
    if (code && (KNOWN as readonly string[]).includes(code)) return t(code);
    return t("generic");
  };
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className={errorText}>
      {message}
    </p>
  );
}

/** "Continue with …" for each OIDC method this deployment has switched on. */
export function OidcButtons({
  methods,
  callbackURL,
  errorCallbackURL,
  onError,
}: {
  methods: SignInMethods;
  callbackURL: string;
  errorCallbackURL: string;
  onError: (error: AuthError) => void;
}) {
  const t = useTranslations("Auth");
  const [busy, setBusy] = useState<string | null>(null);
  const providers = [
    methods.signin ? { id: "bitbaum-signin", label: t("withSignin") } : null,
    methods.orangecat ? { id: "orangecat", label: t("withOrangecat") } : null,
  ].filter((p): p is { id: string; label: string } => p !== null);
  if (providers.length === 0) return null;

  return (
    <div className="grid gap-3">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={buttonQuiet}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(provider.id);
            const { error } = await authClient.signIn.social({
              provider: provider.id,
              callbackURL,
              errorCallbackURL,
            });
            if (error) {
              onError(error);
              setBusy(null);
            }
          }}
        >
          {provider.label}
        </button>
      ))}
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-caps text-fg-tertiary">
      <span className="h-px flex-1 bg-border-subtle" />
      {label}
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}
