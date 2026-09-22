"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { Loader2, GitBranch, X as XIcon, Globe, Trash2, Cat } from "lucide-react";
import { patchJson, postJson, deleteJson } from "@/lib/api/fetch";
import { Modal } from "@/components/ui/modal";
import { useFetch } from "@/hooks/use-fetch";
import { TOAST_MEDIUM_MS } from "@/lib/constants/timings";

type ConnectedAccount = {
  provider: string;
  providerAccountId: string;
  /** Linked, but the provider has refused the stored token. */
  needsReconnect?: boolean;
};

const PROVIDER_META: Record<string, { label: string; icon: React.ElementType }> = {
  github: { label: "GitHub", icon: GitBranch },
  google: { label: "Google", icon: Globe },
  twitter: { label: "Twitter/X", icon: XIcon },
  orangecat: { label: "OrangeCat", icon: Cat },
};

function ConnectedAccountsSection({
  hasPassword,
  orangecatEnabled,
}: {
  hasPassword: boolean;
  orangecatEnabled: boolean;
}) {
  const { data, refetch } = useFetch<{ accounts: ConnectedAccount[] }>(
    "/api/me/connected-accounts",
  );
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedAccounts = data?.accounts ?? [];
  // Bridge Part A settings-connect: existing FC users link their OrangeCat
  // identity here (the sign-in button only covers the login page). The OIDC
  // round-trip carries the capability scopes, so a successful link also
  // unlocks Publish to OrangeCat — no separate API-key step.
  const showOrangeCatConnect =
    orangecatEnabled && !connectedAccounts.some((a) => a.provider === "orangecat");

  const connectOrangeCat = async () => {
    setConnecting(true);
    setError(null);
    // The orangecat provider deliberately has NO allowDangerousEmailAccountLinking
    // (actor sub, not email, is the identity boundary — see src/auth.ts). From a
    // live session Auth.js links the OC account to THIS user regardless of email;
    // from the sign-in page an email collision yields OAuthAccountNotLinked instead.
    await signIn("orangecat", { callbackUrl: "/settings#account" });
  };

  const disconnect = async (provider: string) => {
    setDisconnecting(provider);
    setError(null);
    try {
      const res = await deleteJson(`/api/me/connected-accounts/${provider}`);
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? "Failed to disconnect");
        return;
      }
      refetch();
    } catch {
      setError("Network error — try again");
    } finally {
      setDisconnecting(null);
    }
  };

  if (!data) return <div className="h-8 w-40 animate-pulse rounded bg-border-default" />;

  return (
    <div className="space-y-2">
      {connectedAccounts.length === 0 && (
        <p className="text-sm text-text-muted">No OAuth providers connected.</p>
      )}
      {connectedAccounts.map(({ provider, needsReconnect }) => {
        const meta = PROVIDER_META[provider] ?? { label: provider, icon: Globe };
        const Icon = meta.icon;
        const isOnly = connectedAccounts.length === 1 && !hasPassword;
        return (
          <div
            key={provider}
            className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-base px-3 py-2.5"
          >
            <Icon className="h-4 w-4 shrink-0 text-text-secondary" />
            <span className="flex-1 text-sm text-text-primary">{meta.label}</span>
            {/* Linked is not working. When the provider has refused the stored
                token, the row says so and offers the ONE action that fixes it
                — re-running the same consent round-trip. Before this, a broken
                OrangeCat link read "Connected" in green and offered only
                Disconnect, which is a dead end wearing a healthy label. */}
            {needsReconnect ? (
              <>
                <span className="text-xs text-status-warning">Needs reconnecting</span>
                <button onClick={connectOrangeCat} disabled={connecting} className="ui-btn-xs ml-2">
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reconnect"}
                </button>
              </>
            ) : (
              <span className="text-xs text-status-positive">Connected</span>
            )}
            <button
              onClick={() => disconnect(provider)}
              disabled={!!disconnecting || isOnly}
              title={
                isOnly
                  ? "Set a password before disconnecting your only sign-in method"
                  : `Disconnect ${meta.label}`
              }
              className="ml-2 p-1 rounded text-text-muted hover:text-status-negative/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label={`Disconnect ${meta.label}`}
            >
              {disconnecting === provider ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        );
      })}
      {showOrangeCatConnect && (
        <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-base px-3 py-2.5">
          <Cat className="h-4 w-4 shrink-0 text-text-secondary" />
          <span className="flex-1 text-sm text-text-primary">OrangeCat</span>
          <button onClick={connectOrangeCat} disabled={connecting} className="ui-btn-xs">
            {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Connect"}
          </button>
        </div>
      )}
      {error && <p className="ui-error-xs">{error}</p>}
    </div>
  );
}

/**
 * Lets an OAuth-only user (no password yet) set an initial password, so they
 * gain a second, provider-independent sign-in method and can safely disconnect
 * their only OAuth provider. Without this the Connected-accounts disconnect
 * button is permanently disabled with no escape — a dead end.
 */
function SetInitialPasswordSection() {
  const router = useRouter();
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const mismatch = confirmPwd.length > 0 && newPwd !== confirmPwd;
  const tooShort = newPwd.length > 0 && newPwd.length < 8;
  const canSave = newPwd.length >= 8 && newPwd === confirmPwd;

  const setInitialPassword = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await postJson("/api/me/password", { newPassword: newPwd });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to set password");
      }
      // Re-render the server component so hasPassword flips to true and this
      // block is replaced by the regular change-password form.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-border-subtle pt-4 space-y-3">
      <h3 className="text-sm font-medium text-text-primary">Set a password</h3>
      <p className="text-xs text-text-muted">
        Add a password so you can sign in without an external provider — required before you can
        disconnect your only connected account.
      </p>
      <div className="space-y-2">
        <div className="space-y-1.5">
          <label className="ui-kicker">New password</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => {
              setNewPwd(e.target.value);
              setError("");
            }}
            autoComplete="new-password"
            className={`ui-input ${tooShort ? "border-status-negative/50" : ""}`}
            placeholder="At least 8 characters"
          />
          {tooShort && <p className="ui-error-xs">At least 8 characters required</p>}
        </div>
        <div className="space-y-1.5">
          <label className="ui-kicker">Confirm password</label>
          <input
            type="password"
            value={confirmPwd}
            onChange={(e) => {
              setConfirmPwd(e.target.value);
              setError("");
            }}
            autoComplete="new-password"
            className={`ui-input ${mismatch ? "border-status-negative/50" : ""}`}
            placeholder="Repeat password"
          />
          {mismatch && <p className="ui-error-xs">Passwords don&apos;t match</p>}
        </div>
      </div>
      {error && <p className="ui-error">{error}</p>}
      <button
        onClick={setInitialPassword}
        disabled={saving || !canSave}
        className="ui-btn-secondary"
      >
        {saving && <Loader2 className="ui-spinner" />}
        Set password
      </button>
    </div>
  );
}

type Props = {
  user: { email: string | null; hasPassword: boolean };
  /** Whether the OrangeCat OIDC provider is mounted (env-gated, server-derived). */
  orangecatEnabled: boolean;
};

export function AccountSettings({ user, orangecatEnabled }: Props) {
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [pwdSaved, setPwdSaved] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await deleteJson("/api/me", { confirm: deleteConfirm.trim() });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Delete failed (${res.status})`);
      }
      // Account is gone — end the (now orphaned) session and land on the homepage.
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  };

  const pwdMismatch = confirmPwd.length > 0 && newPwd !== confirmPwd;
  const pwdTooShort = newPwd.length > 0 && newPwd.length < 8;
  const canSavePwd = !!currentPwd && newPwd.length >= 8 && newPwd === confirmPwd;

  const savePassword = async () => {
    setPwdSaving(true);
    setPwdError("");
    setPwdSaved(false);
    try {
      const res = await patchJson("/api/me/password", {
        currentPassword: currentPwd,
        newPassword: newPwd,
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to change password");
      }
      setPwdSaved(true);
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setTimeout(() => setPwdSaved(false), TOAST_MEDIUM_MS);
    } catch (e) {
      setPwdError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <section className="ui-settings-section">
      <h2 className="font-medium text-text-primary">Account</h2>

      {/* Email */}
      <div className="space-y-1.5">
        <label className="ui-kicker">Email address</label>
        <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-raised px-3 py-2.5">
          <span className="flex-1 text-sm text-text-secondary">{user.email ?? "No email set"}</span>
          <span className="text-xs text-text-muted">Read-only</span>
        </div>
      </div>

      {/* Connected OAuth accounts */}
      <div className="space-y-2">
        <label className="ui-kicker">Connected accounts</label>
        <ConnectedAccountsSection
          hasPassword={user.hasPassword}
          orangecatEnabled={orangecatEnabled}
        />
      </div>

      {/* Set initial password (OAuth-only accounts with no password yet) */}
      {!user.hasPassword && <SetInitialPasswordSection />}

      {/* Password */}
      {user.hasPassword && (
        <div className="border-t border-border-subtle pt-4 space-y-3">
          <h3 className="text-sm font-medium text-text-primary">Change password</h3>
          <div className="space-y-2">
            <div className="space-y-1.5">
              <label className="ui-kicker">Current password</label>
              <input
                type="password"
                value={currentPwd}
                onChange={(e) => {
                  setCurrentPwd(e.target.value);
                  setPwdError("");
                }}
                autoComplete="current-password"
                className="ui-input"
                placeholder="Your current password"
              />
            </div>
            <div className="space-y-1.5">
              <label className="ui-kicker">New password</label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => {
                  setNewPwd(e.target.value);
                  setPwdError("");
                }}
                autoComplete="new-password"
                className={`ui-input ${pwdTooShort ? "border-status-negative/50" : ""}`}
                placeholder="At least 8 characters"
              />
              {pwdTooShort && <p className="ui-error-xs">At least 8 characters required</p>}
            </div>
            <div className="space-y-1.5">
              <label className="ui-kicker">Confirm new password</label>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => {
                  setConfirmPwd(e.target.value);
                  setPwdError("");
                }}
                autoComplete="new-password"
                className={`ui-input ${pwdMismatch ? "border-status-negative/50" : ""}`}
                placeholder="Repeat new password"
              />
              {pwdMismatch && <p className="ui-error-xs">Passwords don&apos;t match</p>}
            </div>
          </div>
          {pwdError && <p className="ui-error">{pwdError}</p>}
          {pwdSaved && <p className="text-sm text-status-positive">Password updated.</p>}
          <button
            onClick={savePassword}
            disabled={pwdSaving || !canSavePwd}
            className="ui-btn-secondary"
          >
            {pwdSaving && <Loader2 className="ui-spinner" />}
            Update password
          </button>
        </div>
      )}

      {/* Danger zone */}
      <div className="border-t border-border-subtle pt-4">
        <h3 className="text-sm font-medium text-status-negative/80 mb-2">Danger zone</h3>
        <p className="text-xs text-text-muted mb-3">
          Permanently delete your account and everything it owns — projects, runs, memory, feedback,
          chat history. This cannot be undone.
        </p>
        <button
          onClick={() => setDeleteOpen(true)}
          className="text-xs text-status-negative border border-status-negative/40 rounded-lg px-3 py-1.5 hover:bg-status-negative/10"
        >
          Delete account
        </button>
      </div>

      {deleteOpen && (
        <Modal onClose={() => !deleting && setDeleteOpen(false)} disableClose={deleting}>
          <h3 className="text-base font-semibold text-status-negative">Delete account</h3>
          <p className="text-sm text-text-secondary">
            This permanently deletes your account and all data it owns. There is no undo and no
            grace period. Type{" "}
            <span className="font-mono text-text-primary">{user.email ?? "your email"}</span> to
            confirm.
          </p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={user.email ?? "you@example.com"}
            className="ui-input w-full"
            autoComplete="off"
          />
          {deleteError && <p className="text-xs text-status-negative">{deleteError}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
              className="ui-btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={
                deleting || deleteConfirm.trim().toLowerCase() !== (user.email ?? "").toLowerCase()
              }
              className="ui-btn-danger"
            >
              {deleting && <Loader2 className="ui-spinner" />}
              Delete forever
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
