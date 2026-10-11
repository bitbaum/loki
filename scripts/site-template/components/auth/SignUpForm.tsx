"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { button, buttonQuiet, input, label, notice } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import type { SignInMethods } from "@/lib/auth/methods";
import { ROUTES } from "@/lib/routes";
import { Divider, ErrorLine, OidcButtons, useAuthErrorText, type AuthError } from "./shared";

/**
 * A new account in one step. No real name is asked for — a display name is
 * optional and may be anything. A passkey is added from the account page once
 * the account exists.
 */
export function SignUpForm({
  methods,
  next,
  signUpPath,
}: {
  methods: SignInMethods;
  next: string;
  signUpPath: string;
}) {
  const t = useTranslations("Auth");
  const errorText = useAuthErrorText();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"verify" | "link" | null>(null);

  const fail = (e: AuthError) => {
    setError(errorText(e));
    setBusy(false);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.signUp.email({
      name: name.trim(),
      email,
      password,
      callbackURL: next,
    });
    if (e) return fail(e);
    if (methods.verifyEmail) {
      setSent("verify");
      setBusy(false);
      return;
    }
    window.location.assign(next);
  }

  async function withLink() {
    if (!email) {
      setError(t("errors.emailFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.signIn.magicLink({
      email,
      name: name.trim(),
      callbackURL: next,
    });
    if (e) return fail(e);
    setSent("link");
    setBusy(false);
  }

  if (sent) {
    return (
      <p className={notice} role="status">
        {sent === "verify" ? t("confirmInbox", { email }) : t("checkInbox", { email })}
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      <OidcButtons
        methods={methods}
        callbackURL={next}
        errorCallbackURL={`${signUpPath}?error=oidc`}
        onError={fail}
      />
      <Divider label={t("orEmail")} />
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="name" className={label}>
            {t("displayName")}
          </label>
          <input
            id="name"
            className={input}
            autoComplete="nickname"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby="name-hint"
          />
          <p id="name-hint" className="text-sm text-fg-secondary">
            {t("displayNameHint")}
          </p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="email" className={label}>
            {t("email")}
          </label>
          <input
            id="email"
            type="email"
            className={input}
            autoComplete="email"
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
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
            required
          />
          <p id="password-hint" className="text-sm text-fg-secondary">
            {t("passwordHint")}
          </p>
        </div>
        <ErrorLine message={error} />
        <button type="submit" className={button} disabled={busy}>
          {t("createAccount")}
        </button>
        {methods.magicLink && (
          <button type="button" className={buttonQuiet} onClick={withLink} disabled={busy}>
            {t("signUpWithLink")}
          </button>
        )}
      </form>
      <p className="text-sm text-fg-secondary">
        {t("haveAccount")}{" "}
        <Link href={ROUTES.signIn} className="underline underline-offset-4">
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
