"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { APP_NAME } from "@/config/brand";
import { ROLE_LABELS, roleGuide } from "@/lib/project-capabilities";
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
  projectDescription: string | null;
  liveUrl: string | null;
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

/** "petvity.orangecat.ch", not the scheme — the words a person would say. */
function siteName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Where an invited person lands — and the whole manual, since the first one
 * invited was a doctor who had never seen Loki (2026-10-17). What the project
 * is, what they will be able to do, what happens to what they ask for, and
 * one button. No "roles", no "dispatch": the role is explained, not named.
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
      if (!res.ok) await throwApiError(res, "Could not join the project.");
      const data = (await res.json()) as { projectId: string };
      // The project shows the same three steps on arrival (joined=1), so the
      // page they read here is the page they find there.
      router.push(`/projects/${data.projectId}?joined=1`);
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : "Could not join the project.");
      setAccepting(false);
    }
  }

  if (loadError) {
    return (
      <AuthShell>
        <AuthHeading
          badge={<AuthIconBadge>✦</AuthIconBadge>}
          title="This link does not work"
          description={`${loadError} Ask the person who sent it for a new one.`}
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
  const builder = view.role === "editor";
  const site = siteName(view.liveUrl);
  const guide = roleGuide(view.role, { site, owner: who });
  const own = view.reason === "own";
  const member = view.reason === "member";

  return (
    <AuthShell>
      <AuthHeading
        badge={<AuthIconBadge>✦</AuthIconBadge>}
        title={own ? "Your invite link" : `Join ${view.projectName}`}
        description={
          own
            ? "This is what the person you send it to will read."
            : builder
              ? `${who} invited you to help build ${view.projectName}.`
              : `${who} invited you to follow ${view.projectName}.`
        }
      />
      <AuthCard>
        <div className="space-y-5">
          {/* What it is. A person decides from this page, not by asking back. */}
          <section className="ui-auth-inset-panel" aria-labelledby="invite-what">
            <h2 id="invite-what" className="ui-auth-inset-label">
              What {view.projectName} is
            </h2>
            <p className="ui-auth-body">
              {view.projectDescription ??
                `A site ${who} is building with ${APP_NAME}, an assistant that makes the changes it is asked for.`}
            </p>
            {view.liveUrl && (
              <a
                className="ui-auth-link mt-2 inline-flex min-h-11 items-center text-sm"
                href={view.liveUrl}
                target="_blank"
                rel="noreferrer"
              >
                See it: {site} ↗
              </a>
            )}
          </section>

          {/* The manual. Same words the project shows after joining. */}
          <section aria-labelledby="invite-how">
            <h2 id="invite-how" className="ui-auth-inset-label">
              {builder ? "How you change it — no approvals, no code" : "How you ask for a change"}
            </h2>
            <ol className="ui-auth-list">
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
              <li>{guide.then}</li>
            </ol>
          </section>

          {!view.signedIn && (
            <>
              <p className="ui-auth-note">
                {view.invitedEmail
                  ? `This invitation is for ${view.invitedEmail}. Sign in with that OrangeCat account, or create it on the way.`
                  : "You need an OrangeCat account — the one login for everything here. If you have none, you create it in a minute and come straight back."}
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
              <p className={own ? "ui-auth-body" : "ui-error"}>{view.problem}</p>
              {/* Already in, or the owner checking the link: the way forward
                  is the project itself. */}
              {(member || own) && (
                <AuthSubmitButton
                  label={own ? "Back to the project" : `Open ${view.projectName}`}
                  onClick={() =>
                    router.push(
                      own ? `/projects/${view.projectId}#people` : `/projects/${view.projectId}`,
                    )
                  }
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
          {!own && (
            <p className="ui-auth-note">
              You will be on {view.projectName} as{" "}
              {builder ? "a Builder" : `a ${ROLE_LABELS[view.role].label}`}. {who} can change that
              or remove you at any time.
            </p>
          )}
        </div>
      </AuthCard>
    </AuthShell>
  );
}
