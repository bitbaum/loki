"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { button, buttonQuiet, input, label, notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import type { SignInMethods } from "@/lib/auth/methods";
import { ROUTES } from "@/lib/routes";
import { Divider, ErrorLine, OidcButtons, useAuthErrorText, type AuthError } from "./shared";

type Step = "start" | "twoFactor" | "linkSent";

/**
 * Every way in, on one screen: password, passkey, a link by email, and the
 * OIDC buttons this deployment has switched on. A second factor, when the
 * account has one, is asked for on the same card.
 */
export function SignInForm({
  methods,
  next,
  signInPath,
  initialError,
}: {
  methods: SignInMethods;
  /** Where to land, already localised (`/de/account`). */
  next: string;
  /** This page, localised — where a failed OIDC round trip comes back to. */
  signInPath: string;
  initialError: boolean;
}) {
  const t = useTranslations("Auth");
  const errorText = useAuthErrorText();
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? errorText({}) : null);
  const [unverified, setUnverified] = useState(false);

  const fail = (e: AuthError) => {
    setError(errorText(e));
    setUnverified(e?.code === "EMAIL_NOT_VERIFIED");
    setBusy(false);
  };
  const done = () => window.location.assign(next);

  async function withPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: e } = await authClient.signIn.email({
      email,
      password,
      callbackURL: next,
    });
    if (e) return fail(e);
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("twoFactor");
      setBusy(false);
      return;
    }
    done();
  }

  async function withSecondFactor(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: e } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice });
    if (e) return fail(e);
    done();
  }

  async function withLink() {
    if (!email) {
      setError(t("errors.emailFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.signIn.magicLink({ email, callbackURL: next });
    if (e) return fail(e);
    setStep("linkSent");
    setBusy(false);
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) return fail(result.error);
    done();
  }

  async function resendVerification() {
    setBusy(true);
    const { error: e } = await authClient.sendVerificationEmail({ email, callbackURL: next });
    if (e) return fail(e);
    setUnverified(false);
    setStep("linkSent");
    setBusy(false);
  }

  if (step === "linkSent") {
    return (
      <div className="grid gap-4">
        <p className={notice} role="status">
          {t("checkInbox", { email })}
        </p>
        <button type="button" className={buttonQuiet} onClick={() => setStep("start")}>
          {t("back")}
        </button>
      </div>
    );
  }

  if (step === "twoFactor") {
    return (
      <form onSubmit={withSecondFactor} className="grid gap-4">
        <p className="text-fg-secondary">{useBackup ? t("backupPrompt") : t("totpPrompt")}</p>
        <div className="grid gap-1.5">
          <label htmlFor="code" className={label}>
            {useBackup ? t("backupCode") : t("totpCode")}
          </label>
          <input
            id="code"
            className={input}
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm text-fg-secondary">
          <input
            type="checkbox"
            className="size-5"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
          />
          {t("trustDevice")}
        </label>
        <ErrorLine message={error} />
        <button type="submit" className={button} disabled={busy}>
          {t("verify")}
        </button>
        <button type="button" className={buttonQuiet} onClick={() => setUseBackup(!useBackup)}>
          {useBackup ? t("useTotp") : t("useBackup")}
        </button>
      </form>
    );
  }

  return (
    <div className="grid gap-6">
      <OidcButtons
        methods={methods}
        callbackURL={next}
        errorCallbackURL={`${signInPath}?error=oidc`}
        onError={fail}
      />
      {methods.passkey && (
        <button type="button" className={buttonQuiet} onClick={withPasskey} disabled={busy}>
          {t("withPasskey")}
        </button>
      )}
      <Divider label={t("orEmail")} />
      <form onSubmit={withPassword} className="grid gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="email" className={label}>
            {t("email")}
          </label>
          <input
            id="email"
            type="email"
            className={input}
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="password" className={label}>
            {t("password")}
          </label>
          <input
            id="password"
            type="password"
            className={input}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <ErrorLine message={error} />
        {unverified && methods.verifyEmail && (
          <button
            type="button"
            className={buttonQuiet}
            onClick={resendVerification}
            disabled={busy}
          >
            {t("resendVerification")}
          </button>
        )}
        <button type="submit" className={button} disabled={busy}>
          {t("signIn")}
        </button>
        {methods.magicLink && (
          <button type="button" className={buttonQuiet} onClick={withLink} disabled={busy}>
            {t("withLink")}
          </button>
        )}
      </form>
      <p className="text-sm text-fg-secondary">
        {t("noAccount")}{" "}
        <Link href={ROUTES.signUp} className="underline underline-offset-4">
          {t("createAccount")}
        </Link>
      </p>
    </div>
  );
}
