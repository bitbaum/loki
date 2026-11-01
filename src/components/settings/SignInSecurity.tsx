"use client";

/**
 * Passkeys and the second factor, on the AccountKit runtime
 * (getEnabledAuthProviders().passkey). Both are AccountKit's own endpoints
 * (src/lib/auth/shared/open-paths.ts); the words are AccountKit's labels, as
 * on every other fleet product's account page.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_AUTH_LABELS, authErrorText } from "@bitbaum/accountkit/auth/react";
import { sharedAuthClient } from "@/lib/auth/shared/client";

const A = DEFAULT_AUTH_LABELS.account;
type Passkey = { id: string; name?: string | null };
type AuthError = Parameters<typeof authErrorText>[1];
const failure = (error: unknown) =>
  authErrorText(DEFAULT_AUTH_LABELS, error as AuthError) ?? DEFAULT_AUTH_LABELS.errors.generic;

export function SignInSecurity({
  twoFactorEnabled,
  hasPassword,
}: {
  twoFactorEnabled: boolean;
  hasPassword: boolean;
}) {
  return (
    <>
      <Passkeys />
      <TwoFactor initiallyOn={twoFactorEnabled} hasPassword={hasPassword} />
    </>
  );
}

function Passkeys() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const { data } = await sharedAuthClient.passkey.listUserPasskeys();
    setPasskeys((data as Passkey[] | null) ?? []);
  }, []);
  useEffect(() => {
    let alive = true;
    void sharedAuthClient.passkey.listUserPasskeys().then(({ data }) => {
      if (alive) setPasskeys((data as Passkey[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-2 border-t border-border-subtle pt-4" aria-labelledby="acct-passkeys">
      <h3 id="acct-passkeys" className="ui-kicker">
        {A.passkeys}
      </h3>
      <p className="text-xs text-text-muted">{A.passkeysLede}</p>
      {passkeys && passkeys.length > 0 && (
        <ul className="space-y-1">
          {passkeys.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-text-primary">
                {key.name || A.passkeyDefaultName}
              </span>
              <button
                type="button"
                className="ui-btn-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  const { error: e } = await sharedAuthClient.passkey.deletePasskey({
                    id: key.id,
                  });
                  if (e) setError(failure(e));
                  await load();
                  setBusy(false);
                }}
              >
                {A.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="ui-btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const result = await sharedAuthClient.passkey
            .addPasskey({ name: A.passkeyDefaultName })
            .catch(() => null);
          if (result?.error) setError(failure(result.error));
          await load();
          setBusy(false);
        }}
      >
        {busy && <Loader2 className="ui-spinner" />}
        {A.addPasskey}
      </button>
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}

function TwoFactor({ initiallyOn, hasPassword }: { initiallyOn: boolean; hasPassword: boolean }) {
  const [on, setOn] = useState(initiallyOn);
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    const { data, error: e } = await sharedAuthClient.twoFactor.enable({ password });
    setBusy(false);
    if (e) return setError(failure(e));
    const started = data as { totpURI?: string; backupCodes?: string[] } | null;
    setSetup({ uri: started?.totpURI ?? "", backupCodes: started?.backupCodes ?? [] });
    setPassword("");
  }

  async function confirm() {
    setBusy(true);
    setError("");
    const { error: e } = await sharedAuthClient.twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (e) return setError(failure(e));
    setOn(true);
    setSetup(null);
    setCode("");
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    const { error: e } = await sharedAuthClient.twoFactor.disable({ password });
    setBusy(false);
    if (e) return setError(failure(e));
    setOn(false);
    setPassword("");
  }

  return (
    <div className="space-y-2 border-t border-border-subtle pt-4" aria-labelledby="acct-two-factor">
      <h3 id="acct-two-factor" className="ui-kicker">
        {A.twoFactor}
      </h3>
      <p className="text-xs text-text-muted">{on ? A.twoFactorOn : A.twoFactorOff}</p>
      {!hasPassword ? (
        <p className="text-xs text-text-muted">{A.currentPasswordHint}</p>
      ) : setup ? (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">{A.scan}</p>
          <a href={setup.uri} className="ui-btn-xs inline-flex break-all">
            {A.openAuthenticator}
          </a>
          <code className="block break-all rounded-lg bg-surface-raised p-2 text-xs">
            {setup.uri}
          </code>
          {setup.backupCodes.length > 0 && (
            <>
              <p className="text-xs text-text-muted">{A.backupCodes}</p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
                {setup.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          <label className="ui-kicker" htmlFor="acct-totp-confirm">
            {DEFAULT_AUTH_LABELS.totpCode}
          </label>
          <input
            id="acct-totp-confirm"
            className="ui-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="button"
            className="ui-btn-secondary"
            disabled={busy || !code}
            onClick={confirm}
          >
            {busy && <Loader2 className="ui-spinner" />}
            {A.turnOn}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="ui-kicker" htmlFor="acct-2fa-password">
            {A.currentPassword}
          </label>
          <input
            id="acct-2fa-password"
            type="password"
            className="ui-input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className={on ? "ui-btn-danger" : "ui-btn-secondary"}
            disabled={busy || !password}
            onClick={on ? turnOff : start}
          >
            {busy && <Loader2 className="ui-spinner" />}
            {on ? A.turnOff : A.setUp}
          </button>
        </div>
      )}
      {error && <p className="ui-error">{error}</p>}
    </div>
  );
}
