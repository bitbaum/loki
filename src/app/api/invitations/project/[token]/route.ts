import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getSessionUserId } from "@/lib/session";
import { getUserById } from "@/db/queries/users";
import {
  acceptProjectInvitation,
  getProjectAccess,
  getProjectInvitationByToken,
} from "@/db/queries/project-access";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { DemoBlockedError } from "@/lib/demo-guard";
import { evaluateInviteAcceptance, maskEmail } from "@/lib/project-invites";
import { projectTitle, summarizeDescription } from "@/lib/project-display";

/**
 * GET  /api/invitations/project/:token        — what this invite is, and whether
 *                                               the signed-in person may take it
 * POST /api/invitations/project/:token        — accept it
 *
 * Both run evaluateInviteAcceptance, so the page cannot show "Accept" for an
 * invite the POST would then refuse.
 */

async function sessionEmail(): Promise<{ userId: string | null; email: string | null }> {
  const userId = await getSessionUserId();
  if (!userId) return { userId: null, email: null };
  // The DB row, not the JWT claim: the account's email is what the invite was
  // addressed to, and a stale token claim must not decide who gets access.
  const user = await getUserById(userId);
  return { userId, email: user?.email ?? (await auth())?.user?.email ?? null };
}

/** Where the signed-in person already stands on the invite's project. */
async function standingOn(
  userId: string | null,
  projectId: string,
): Promise<"owner" | "member" | null> {
  if (!userId) return null;
  const access = await getProjectAccess(userId, projectId).catch(() => null);
  if (!access) return null;
  return access.role === "owner" ? "owner" : "member";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await getProjectInvitationByToken(token);
  // One answer for "no such token" and "wrong token": nothing here should help
  // anyone guess which tokens exist.
  if (!loaded) return jsonError("This invitation link is not valid.", 404);

  const { userId, email } = await sessionEmail();
  const standing = await standingOn(userId, loaded.invitation.projectId);
  const verdict = userId
    ? evaluateInviteAcceptance(loaded.invitation, email, new Date(), standing)
    : null;
  return jsonOk({
    projectName: projectTitle({
      name: loaded.projectName,
      title: loaded.projectTitle,
      description: loaded.projectDescription,
    }),
    // What it is and where it lives, so the person can decide from the page.
    projectDescription: summarizeDescription(loaded.projectDescription, 160),
    liveUrl: loaded.liveUrl,
    inviterName: loaded.inviterName,
    role: loaded.invitation.role,
    // Null for an open link: there is no address to name.
    invitedEmail: loaded.invitation.email ? maskEmail(loaded.invitation.email) : null,
    signedIn: Boolean(userId),
    canAccept: verdict?.ok ?? false,
    problem: verdict && !verdict.ok ? verdict.message : null,
    // The page decides what to offer from the reason, never from the wording.
    reason: verdict && !verdict.ok ? verdict.reason : null,
    projectId: loaded.invitation.projectId,
  });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await getProjectInvitationByToken(token);
  if (!loaded) return jsonError("This invitation link is not valid.", 404);

  const { userId, email } = await sessionEmail();
  if (!userId) return jsonError("Sign in to accept this invitation.", 401);

  const standing = await standingOn(userId, loaded.invitation.projectId);
  const verdict = evaluateInviteAcceptance(loaded.invitation, email, new Date(), standing);
  if (!verdict.ok) return jsonError(verdict.message, 403);

  const accepted = await acceptProjectInvitation(loaded.invitation.id, userId).catch(
    (error: unknown) => {
      if (error instanceof DemoBlockedError) return error;
      throw error;
    },
  );
  if (accepted instanceof DemoBlockedError) return jsonError(accepted.message, 403);
  // Lost the race to another tab or a second click: the invite is spent.
  if (!accepted) return jsonError("This invitation has already been used.", 409);
  return jsonOk({ projectId: accepted.projectId });
}
