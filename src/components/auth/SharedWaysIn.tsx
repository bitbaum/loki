"use client";

/**
 * The ways in that AccountKit adds on its runtime, in Loki's sign-in card:
 * a passkey, a sign-in link by email, and the second-factor step after a
 * password. Words and error texts are AccountKit's own (DEFAULT_AUTH_LABELS),
 * the same as every other fleet product's sign-in.
 */
import { useState } from "react";
import { DEFAULT_AUTH_LABELS as L, authErrorText, fill } from "@bitbaum/accountkit/auth/react";
import {
  AuthField,
  AuthInput,
  AuthSecondaryButton,
  AuthSubmitButton,
} from "@/components/auth/AuthShell";
import { sharedAuthClient } from "@/lib/auth/shared/client";

type AuthError = Parameters<typeof authErrorText>[1];

/** Sign in with a passkey this device or a phone holds. */
export function PasskeyButton({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="space-y-1">
      <AuthSecondaryButton
        type="button"
        disabled={busy}
        className="ui-auth-secondary-btn-strong gap-2.5"
        onClick={async () => {
          setBusy(true);
          setError("");
          const result = await sharedAuthClient.signIn.passkey().catch(() => null);
          if (result && !result.error) return onSignedIn();
          setBusy(false);
          // A dismissed prompt is not an error worth a red line.
          const code = (result?.error as { code?: string } | undefined)?.code;
          if (result?.error && code !== "AUTH_CANCELLED")
            setError(authErrorText(L, result.error as AuthError) ?? L.errors.generic);
        }}
      >
        {L.withPasskey}
      </AuthSecondaryButton>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}

/** "Email me a sign-in link instead", for the address already typed above. */
export function SignInLinkButton({
  email,
  callbackUrl,
  name,
  label = L.withLink,
}: {
  email: string;
  callbackUrl: string;
  /** On sign-up: the name the new account starts with. */
  name?: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");
  if (state === "sent")
    return (
      <p role="status" className="ui-auth-hint">
        {fill(L.checkInbox, { email })}
      </p>
    );
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={state === "busy"}
        className="ui-tap inline-flex w-full items-center justify-center text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary disabled:opacity-60"
        onClick={async () => {
          setError("");
          if (!email.includes("@")) {
            setError(L.errors.INVALID_EMAIL ?? L.errors.generic);
            return;
          }
          setState("busy");
          const result = await sharedAuthClient.signIn
            .magicLink({
              email: email.trim().toLowerCase(),
              ...(name ? { name } : {}),
              callbackURL: callbackUrl,
              errorCallbackURL: "/sign-in?error=link",
            })
            .catch(() => ({ error: { status: 503 } as AuthError }));
          if (result?.error) {
            setError(authErrorText(L, result.error as AuthError) ?? L.errors.generic);
            setState("idle");
            return;
          }
          setState("sent");
        }}
      >
        {label}
      </button>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}

/** The code after a password, when the account has the second factor on. */
export function TwoFactorStep({
  onSignedIn,
  onBack,
}: {
  onSignedIn: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [trust, setTrust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const input = { code: code.trim(), trustDevice: trust };
        const result = await (
          backup
            ? sharedAuthClient.twoFactor.verifyBackupCode(input)
            : sharedAuthClient.twoFactor.verifyTotp(input)
        ).catch(() => ({ error: { status: 503 } as AuthError }));
        if (!result?.error) return onSignedIn();
        setError(authErrorText(L, result.error as AuthError) ?? L.errors.generic);
        setBusy(false);
      }}
    >
      <p className="ui-auth-hint">{backup ? L.backupPrompt : L.totpPrompt}</p>
      <AuthField label={backup ? L.backupCode : L.totpCode} htmlFor="acct-code">
        <AuthInput
          id="acct-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
          required
        />
      </AuthField>
      <label className="flex min-h-11 items-center gap-3 text-sm text-text-secondary">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
        {L.trustDevice}
      </label>
      {error && <p className="ui-error">{error}</p>}
      <AuthSubmitButton loading={busy} label={L.verify} loadingLabel={L.verify} />
      <div className="flex justify-between">
        <button
          type="button"
          className="ui-tap text-sm text-text-muted underline underline-offset-2"
          onClick={() => {
            setBackup(!backup);
            setCode("");
            setError("");
          }}
        >
          {backup ? L.useTotp : L.useBackup}
        </button>
        <button
          type="button"
          className="ui-tap text-sm text-text-muted underline underline-offset-2"
          onClick={onBack}
        >
          {L.back}
        </button>
      </div>
    </form>
  );
}

/**
 * A password sign-in on AccountKit itself, so an account with the second
 * factor on gets the code step on the same card instead of a session the
 * compat layer cannot finish.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<"signed-in" | "two-factor" | string> {
  const result = await sharedAuthClient.signIn
    .email({ email: email.trim().toLowerCase(), password })
    .catch(() => ({ data: null, error: { status: 503 } as AuthError }));
  if (result.error) return authErrorText(L, result.error as AuthError) ?? L.errors.generic;
  const data = result.data as { twoFactorRedirect?: boolean } | null;
  return data?.twoFactorRedirect ? "two-factor" : "signed-in";
}
