import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { isMailConfigured } from "@bitbaum/mail-kit";
import { getUserByEmail } from "@/db/queries/users";
import {
  createProjectInvitation,
  getProjectAccess,
  getProjectInvitationByToken,
  listPendingProjectInvitations,
  listProjectMembers,
  removeProjectMember,
  revokeProjectInvitation,
  upsertProjectMember,
} from "@/db/queries/project-access";
import { jsonError, jsonOk, readIdParam, readJsonBody, z } from "@/lib/api/route-helpers";
import { PROJECT_ROLE_VALUES } from "@/db/schema";
import { PROJECT_INVITE_TTL_DAYS, projectInvitePath } from "@/lib/project-invites";
import { appUrl, projectInviteTemplate, sendEmail } from "@/lib/email";

const AddBody = z.object({
  email: z.string().email().max(320),
  role: z.enum(PROJECT_ROLE_VALUES).default("editor"),
});
const DeleteBody = z.union([
  z.object({ userId: z.string().uuid() }),
  z.object({ invitationId: z.string().uuid() }),
]);

async function ownerAccess(params: Promise<{ id: string }>) {
  const userId = await getSessionUserId();
  if (!userId) return { error: jsonError("Unauthorized", 401) } as const;
  const id = await readIdParam(params);
  if (id instanceof NextResponse) return { error: id } as const;
  const access = await getProjectAccess(userId, id);
  if (!access) return { error: jsonError("Project not found", 404) } as const;
  return { id, access, userId } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await ownerAccess(params);
  if ("error" in result) return result.error;
  const canManage = result.access.canManageMembers;
  return jsonOk({
    members: await listProjectMembers(result.id),
    // Only the owner sees who else has been invited: an editor learning the
    // email addresses of people not yet on the project is not theirs to know.
    invitations: canManage ? await listPendingProjectInvitations(result.id) : [],
    canManage,
    role: result.access.role,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await ownerAccess(params);
  if ("error" in result) return result.error;
  if (!result.access.canManageMembers)
    return jsonError("Only the project owner can invite people", 403);
  const body = await readJsonBody(req, AddBody);
  if (body instanceof NextResponse) return body;

  // Already has an account: add them directly, as before.
  const user = await getUserByEmail(body.email);
  if (user) {
    if (user.id === result.access.ownerUserId)
      return jsonError("The project owner already has full access", 409);
    return jsonOk({ member: await upsertProjectMember(result.id, user.id, body.role) });
  }

  // No account yet. This used to end in "Ask them to register first" — a dead
  // end that left the owner to explain sign-up out of band. Now it issues an
  // invite that the person claims by signing in with OrangeCat.
  const { invitation, token } = await createProjectInvitation({
    projectId: result.id,
    email: body.email,
    role: body.role,
    invitedBy: result.userId,
  });
  const link = `${appUrl()}${projectInvitePath(token)}`;

  // Email is best effort. The link is ALWAYS returned, because "we tried to
  // email them" is not a guarantee anyone received it, and the owner can
  // always send the link themselves.
  //
  // `sendEmail` returns quietly when mail is not configured, so success of the
  // call alone would report an email that was never sent. Check first.
  let emailed = false;
  if (isMailConfigured())
    try {
      const loaded = await getProjectInvitationByToken(token);
      const mail = projectInviteTemplate({
        projectName: loaded?.projectName ?? "a project",
        inviterName: loaded?.inviterName ?? null,
        role: body.role,
        inviteUrl: link,
        expiresDays: PROJECT_INVITE_TTL_DAYS,
      });
      await sendEmail(invitation.email, mail.subject, mail.html, mail.text, {
        idempotencyKey: `project-invite-${invitation.id}`,
      });
      emailed = true;
    } catch (error) {
      console.error(
        "[members] invite email failed:",
        error instanceof Error ? error.message : error,
      );
    }

  return jsonOk({
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    },
    link,
    emailed,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const result = await ownerAccess(params);
  if ("error" in result) return result.error;
  if (!result.access.canManageMembers)
    return jsonError("Only the project owner can manage who has access", 403);
  const body = await readJsonBody(req, DeleteBody);
  if (body instanceof NextResponse) return body;
  if ("invitationId" in body)
    return jsonOk({ revoked: await revokeProjectInvitation(result.id, body.invitationId) });
  return jsonOk({ removed: await removeProjectMember(result.id, body.userId) });
}
