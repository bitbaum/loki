"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { button, buttonQuiet, card, input, label, notice } from "@/components/ui";
import { authClient } from "@/lib/auth/client";
import type { SignInMethods } from "@/lib/auth/methods";
import { ErrorLine, useAuthErrorText, type AuthError } from "./shared";

type Passkey = { id: string; name?: string | null; createdAt?: string | Date | null };

interface Props {
  user: {
    name: string;
    /** Null when the account has no address that can receive mail. */
    email: string | null;
    emailVerified: boolean;
    role: string;
    twoFactorEnabled: boolean;
  };
  linked: string[];
  methods: SignInMethods;
  accountPath: string;
  homePath: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={card} aria-labelledby={title}>
      <h2 id={title} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AccountPanel({ user, linked, methods, accountPath, homePath }: Props) {
  const t = useTranslations("Account");
  const auth = useTranslations("Auth");
  const errorText = useAuthErrorText();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(user.name);
  const [saved, setSaved] = useState(false);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [totp, setTotp] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactor, setTwoFactor] = useState(user.twoFactorEnabled);
  const [confirmDelete, setConfirmDelete] = useState("");

  const fail = (e: AuthError) => {
    setError(errorText(e));
    setBusy(false);
  };

  const loadPasskeys = useCallback(async () => {
    const { data } = await authClient.passkey.listUserPasskeys();
    setPasskeys((data as Passkey[] | null) ?? []);
  }, []);
  useEffect(() => {
    let alive = true;
    void authClient.passkey.listUserPasskeys().then(({ data }) => {
      if (alive) setPasskeys((data as Passkey[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.updateUser({ name: name.trim() });
    if (e) return fail(e);
    setSaved(true);
    setBusy(false);
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    const result = await authClient.passkey.addPasskey({ name: t("passkeyDefaultName") });
    if (result?.error) return fail(result.error);
    await loadPasskeys();
    setBusy(false);
  }

  async function removePasskey(id: string) {
    setBusy(true);
    const { error: e } = await authClient.passkey.deletePasskey({ id });
    if (e) return fail(e);
    await loadPasskeys();
    setBusy(false);
  }

  async function startTwoFactor() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await authClient.twoFactor.enable({
      password: password || undefined,
    });
    if (e) return fail(e);
    if (!data || !("totpURI" in data)) return fail({});
    setTotp({ uri: data.totpURI, backupCodes: data.backupCodes });
    setBusy(false);
  }

  async function confirmTwoFactor(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error: e } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    if (e) return fail(e);
    setTwoFactor(true);
    setTotp(null);
    setCode("");
    setBusy(false);
  }

  async function stopTwoFactor() {
    setBusy(true);
    setError(null);
    const { error: e } = await authClient.twoFactor.disable({ password: password || undefined });
    if (e) return fail(e);
    setTwoFactor(false);
    setBusy(false);
  }

  async function link(provider: string) {
    setBusy(true);
    const { error: e } = await authClient.linkSocial({ provider, callbackURL: accountPath });
    if (e) fail(e);
  }

  async function signOut() {
    await authClient.signOut();
    window.location.assign(homePath);
  }

  async function deleteAccount() {
    setBusy(true);
    const { error: e } = await authClient.deleteUser({ password: password || undefined });
    if (e) return fail(e);
    window.location.assign(homePath);
  }

  const oidc = [
    { id: "bitbaum-signin", label: auth("withSignin"), on: methods.signin },
    { id: "orangecat", label: auth("withOrangecat"), on: methods.orangecat },
  ];
  const methodName = (id: string) =>
    id === "credential" ? t("methodPassword") : (oidc.find((o) => o.id === id)?.label ?? id);

  return (
    <div className="grid gap-6">
      <ErrorLine message={error} />

      <Section title={t("profile")}>
        <form onSubmit={saveName} className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="display-name" className={label}>
              {auth("displayName")}
            </label>
            <input
              id="display-name"
              className={input}
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <dl className="grid gap-1 text-sm text-fg-secondary">
            <div>
              <dt className="inline">{auth("email")}: </dt>
              <dd className="inline">
                {user.email ?? t("noEmail")}
                {user.email && !user.emailVerified && ` (${t("unverified")})`}
              </dd>
            </div>
            <div>
              <dt className="inline">{t("role")}: </dt>
              <dd className="inline">{t(`roles.${user.role}` as "roles.customer")}</dd>
            </div>
          </dl>
          <div className="flex items-center gap-3">
            <button type="submit" className={button} disabled={busy}>
              {t("save")}
            </button>
            {saved && <span role="status">{t("saved")}</span>}
          </div>
        </form>
      </Section>

      <Section title={t("methods")}>
        <ul className="grid gap-2 text-fg-secondary">
          {linked.map((id) => (
            <li key={id}>{methodName(id)}</li>
          ))}
        </ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {oidc
            .filter((o) => o.on && !linked.includes(o.id))
            .map((o) => (
              <button
                key={o.id}
                type="button"
                className={buttonQuiet}
                onClick={() => link(o.id)}
                disabled={busy}
              >
                {t("link", { method: o.label })}
              </button>
            ))}
        </div>
      </Section>

      <Section title={t("passkeys")}>
        <p className="mb-4 text-sm text-fg-secondary">{t("passkeysLede")}</p>
        {passkeys && passkeys.length > 0 && (
          <ul className="mb-4 grid gap-2">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span>{p.name || t("passkeyDefaultName")}</span>
                <button
                  type="button"
                  className={buttonQuiet}
                  onClick={() => removePasskey(p.id)}
                  disabled={busy}
                >
                  {t("remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={button} onClick={addPasskey} disabled={busy}>
          {t("addPasskey")}
        </button>
      </Section>

      <Section title={t("twoFactor")}>
        <p className="mb-4 text-sm text-fg-secondary">
          {twoFactor ? t("twoFactorOn") : t("twoFactorOff")}
        </p>
        <div className="mb-4 grid gap-1.5">
          <label htmlFor="current-password" className={label}>
            {t("currentPassword")}
          </label>
          <input
            id="current-password"
            type="password"
            className={input}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="current-password-hint"
          />
          <p id="current-password-hint" className="text-sm text-fg-secondary">
            {t("currentPasswordHint")}
          </p>
        </div>
        {totp ? (
          <form onSubmit={confirmTwoFactor} className="grid gap-4">
            <p className={notice}>{t("scan")}</p>
            <a href={totp.uri} className="break-all font-mono text-sm underline">
              {t("openAuthenticator")}
            </a>
            <p className="text-sm text-fg-secondary">{t("backupCodes")}</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {totp.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="grid gap-1.5">
              <label htmlFor="totp" className={label}>
                {auth("totpCode")}
              </label>
              <input
                id="totp"
                className={input}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
            <button type="submit" className={button} disabled={busy}>
              {t("turnOn")}
            </button>
          </form>
        ) : twoFactor ? (
          <button type="button" className={buttonQuiet} onClick={stopTwoFactor} disabled={busy}>
            {t("turnOff")}
          </button>
        ) : (
          <button type="button" className={button} onClick={startTwoFactor} disabled={busy}>
            {t("setUp")}
          </button>
        )}
      </Section>

      <Section title={t("leave")}>
        <div className="grid gap-4">
          <button type="button" className={buttonQuiet} onClick={signOut}>
            {t("signOut")}
          </button>
          <div className="grid gap-1.5">
            <label htmlFor="confirm-delete" className={label}>
              {t("deleteConfirm", { word: t("deleteWord") })}
            </label>
            <input
              id="confirm-delete"
              className={input}
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={buttonQuiet}
            onClick={deleteAccount}
            disabled={busy || confirmDelete.trim().toLowerCase() !== t("deleteWord").toLowerCase()}
          >
            {t("delete")}
          </button>
        </div>
      </Section>
    </div>
  );
}
