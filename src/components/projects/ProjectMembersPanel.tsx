"use client";

import { useState } from "react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson, throwApiError } from "@/lib/api/fetch";

type Role = "editor" | "viewer";

type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  role: Role;
};

type PendingInvite = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
};

type MembersResponse = {
  members: Member[];
  invitations: PendingInvite[];
  canManage: boolean;
  role: string;
};

const ROLE_HELP: Record<Role, string> = {
  editor: "Editor: can run agents, triage and implement feedback, edit notes and settings.",
  viewer: "Viewer: can follow the project and its feedback, but cannot dispatch work.",
};

/**
 * Who has access to this project, and inviting more people.
 *
 * Inviting used to require the person to already have a Loki account ("Ask
 * them to register first"), with no way to ask them. Now any email works: an
 * existing account is added at once; anyone else gets an invite link they
 * claim by signing in with OrangeCat. The link is always shown here to copy,
 * because an email that was sent is not an email that was received.
 */
export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const members = useFetch<MembersResponse>(`/api/projects/${projectId}/members`);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (members.loading || members.error || !members.data?.canManage) return null;
  const data = members.data;

  async function invite() {
    setBusy(true);
    setMessage(null);
    setLink(null);
    setCopied(false);
    try {
      const response = await postJson(`/api/projects/${projectId}/members`, { email, role });
      if (!response.ok) await throwApiError(response, "Could not invite");
      const body = (await response.json()) as {
        member?: Member;
        link?: string;
        emailed?: boolean;
      };
      if (body.member) {
        setMessage(`Added. They already had an account and can open this project now.`);
      } else if (body.link) {
        setLink(body.link);
        setMessage(
          body.emailed
            ? `Invitation emailed to ${email.trim()}. You can also send them this link:`
            : `No email was sent from here. Send ${email.trim()} this link yourself:`,
        );
      }
      setEmail("");
      members.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not invite");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard can be denied (permissions, insecure context). The link is
      // still on screen and selectable, so this is not an error to shout about.
      setCopied(false);
    }
  }

  async function removeMember(userId: string) {
    const response = await deleteJson(`/api/projects/${projectId}/members`, { userId });
    if (!response.ok) {
      setMessage("Could not remove them");
      return;
    }
    members.refetch();
  }

  async function withdraw(invitationId: string) {
    const response = await deleteJson(`/api/projects/${projectId}/members`, { invitationId });
    if (!response.ok) {
      setMessage("Could not withdraw the invitation");
      return;
    }
    members.refetch();
  }

  const peopleCount = data.members.length + data.invitations.length;

  return (
    <section
      className="mb-4 rounded-lg border border-border-subtle bg-surface-raised p-3"
      aria-labelledby="project-people-title"
    >
      <h2 id="project-people-title" className="text-sm font-medium text-text-primary">
        People with access · {peopleCount}
      </h2>
      <p className="mt-2 text-xs text-text-secondary">
        Invite anyone by email. They sign in with OrangeCat, and can create that account on the way.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="ui-input flex-1"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email to invite"
        />
        <select
          className="ui-input sm:w-32"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          aria-label="Role"
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button
          className="ui-btn-primary"
          type="button"
          disabled={busy || !email.trim()}
          onClick={() => void invite()}
        >
          {busy ? "Inviting…" : "Invite"}
        </button>
      </div>
      <p className="mt-1 text-xs text-text-tertiary">{ROLE_HELP[role]}</p>

      {message && <p className="mt-2 text-xs text-text-secondary">{message}</p>}
      {link && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            className="ui-input flex-1 font-mono"
            readOnly
            value={link}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="ui-btn-secondary" onClick={() => void copyLink()}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}

      {data.members.map((member) => (
        <div
          key={member.userId}
          className="mt-2 flex items-center justify-between gap-3 text-xs text-text-secondary"
        >
          <span>
            {member.name || member.email || "Loki user"} · {member.role}
          </span>
          <button
            type="button"
            className="ui-btn-ghost"
            onClick={() => void removeMember(member.userId)}
          >
            Remove
          </button>
        </div>
      ))}
      {data.invitations.map((inv) => (
        <div
          key={inv.id}
          className="mt-2 flex items-center justify-between gap-3 text-xs text-text-tertiary"
        >
          <span>
            {inv.email} · {inv.role} · invited, not yet joined
          </span>
          <button type="button" className="ui-btn-ghost" onClick={() => void withdraw(inv.id)}>
            Withdraw
          </button>
        </div>
      ))}
    </section>
  );
}
