"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { APP_NAME } from "@/config/brand";
import { ROLE_LABELS } from "@/lib/project-capabilities";
import type { ProjectRole } from "@/db/schema/project-memberships";
import {
  AuthCard,
  AuthHeading,
  AuthIconBadge,
  AuthLoadingCenter,
  AuthSecondaryButton,
  AuthShell,
  AuthSubmitButton,
} from "@/components/auth/AuthShell";

type InviteView = {
  projectName: string;
  inviterName: string | null;
  role: ProjectRole;
  /** Masked, or null for an open link — there is no address to name. */
  invitedEmail: string | null;
  signedIn: boolean;
  canAccept: boolean;
  problem: string | null;
  reason:
    "revoked" | "accepted" | "expired" | "wrong-account" | "no-email" | "own" | "member" | null;
  projectId: string;
};

/**
 * Where an invited person lands.
 *
 * Signed out, the one action is "Sign in with OrangeCat" — which also creates
 * the OrangeCat account on the way for someone who has none. There is no Loki
 * password to set: invited people arrive through the same identity every other
 * product here uses, and the sign-in returns them to this page to accept.
 */
export default function ProjectInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [view, setView] = useState<InviteView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const here = `/invite/project/${token}`;

  // Plain fetch rather than getJson: getJson throws "HTTP 404" and drops the
  // server's sentence, and the sentence is the whole point of this page.
  const load = useCallback(() => {
    fetch(`/api/invitations/project/${token}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as InviteView & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "This invitation link is not valid.");
        setView(data);
      })
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : "This invitation link is not valid."),
      );
  }, [token]);
  useEffect(load, [load]);

  async function accept() {
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await postJson(`/api/invitations/project/${token}`, {});
      if (!res.ok) await throwApiError(res, "Could not accept the invitation.");
      const data = (await res.json()) as { projectId: string };
      router.push(`/projects/${data.projectId}`);
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : "Could not accept the invitation.");
      setAccepting(false);
    }
  }

  if (loadError) {
    return (
      <AuthShell>
        <AuthHeading
          badge={<AuthIconBadge>✦</AuthIconBadge>}
          title="Invitation not found"
          description={loadError}
        />
      </AuthShell>
    );
  }
  if (!view) {
    return (
      <AuthShell>
        <AuthLoadingCenter />
      </AuthShell>
    );
  }

  const who = view.inviterName?.trim() || "A project owner";
  return (
    <AuthShell>
      <AuthHeading
        badge={<AuthIconBadge>✦</AuthIconBadge>}
        title={`Join ${view.projectName}`}
        description={`${who} invited you to ${view.projectName} on ${APP_NAME}, so you can ${ROLE_LABELS[view.role].can}.`}
      />
      <AuthCard>
        <div className="space-y-4">
          {!view.signedIn && (
            <>
              <p className="ui-auth-note">
                {view.invitedEmail
                  ? `This invitation is for ${view.invitedEmail}. Sign in with that OrangeCat account, or create it on the way.`
                  : "Sign in with OrangeCat to join — or create a free account on the way. It takes a minute, and you come straight back here."}
              </p>
              <AuthSubmitButton
                label="Sign in with OrangeCat"
                onClick={() => void signIn("orangecat", { callbackUrl: here })}
              />
            </>
          )}

          {view.signedIn && view.canAccept && (
            <AuthSubmitButton
              label={`Join ${view.projectName}`}
              loadingLabel="Joining…"
              loading={accepting}
              onClick={() => void accept()}
            />
          )}

          {view.signedIn && !view.canAccept && view.problem && (
            <>
              <p className="ui-error">{view.problem}</p>
              {/* Already in: the way forward is the project itself. */}
              {view.reason === "member" && (
                <AuthSubmitButton
                  label={`Open ${view.projectName}`}
                  onClick={() => router.push(`/projects/${view.projectId}`)}
                />
              )}
              {/* Only offered when switching account could actually help. */}
              {view.reason === "wrong-account" && (
                <AuthSecondaryButton
                  type="button"
                  className="w-full"
                  onClick={() => void signOut({ callbackUrl: here })}
                >
                  Sign out and switch account
                </AuthSecondaryButton>
              )}
            </>
          )}

          {acceptError && <p className="ui-error">{acceptError}</p>}
        </div>
      </AuthCard>
    </AuthShell>
  );
}
