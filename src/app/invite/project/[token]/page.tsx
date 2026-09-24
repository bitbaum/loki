"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { APP_NAME } from "@/config/brand";
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
  role: "editor" | "viewer";
  invitedEmail: string;
  signedIn: boolean;
  canAccept: boolean;
  problem: string | null;
  reason: "revoked" | "accepted" | "expired" | "wrong-account" | "no-email" | null;
  projectId: string;
};

const ROLE_COPY: Record<InviteView["role"], string> = {
  editor: "work on it: run agents, edit notes and settings",
  viewer: "follow it: see its runs, feedback and what shipped",
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
        description={`${who} invited you to ${view.projectName} on ${APP_NAME} as ${view.role === "editor" ? "an editor" : "a viewer"}, so you can ${ROLE_COPY[view.role]}.`}
      />
      <AuthCard>
        <div className="space-y-4">
          {!view.signedIn && (
            <>
              <p className="ui-auth-note">
                This invitation is for {view.invitedEmail}. Sign in with that OrangeCat account, or
                create it on the way.
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
