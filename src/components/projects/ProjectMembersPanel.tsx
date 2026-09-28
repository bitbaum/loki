"use client";

import { useState } from "react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson, throwApiError } from "@/lib/api/fetch";
import { PROJECT_ROLE_VALUES, type ProjectRole } from "@/db/schema/project-memberships";
import { ROLE_LABELS } from "@/lib/project-capabilities";

type Role = ProjectRole;

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
  // Ownership is the tenant the work runs in, so this is the one action here
  // that changes whose runner the project uses. The confirm names that; the
  // old owner keeps a builder's seat, so nothing is lost by saying yes.
  async function handOver(member: Member) {
    const who = member.name || member.email || "this person";
    if (
      !window.confirm(
        `Hand this project over to ${who}? It will run in their tenant from now on; you keep a builder's seat.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await postJson(`/api/projects/${projectId}/transfer`, {
        userId: member.userId,
      });
      if (!response.ok) await throwApiError(response, "Could not hand over");
      setMessage(`Handed over to ${who}. You now hold a builder's seat.`);
      await members.refetch();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not hand over");
    } finally {
      setBusy(false);
    }
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
          {PROJECT_ROLE_VALUES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r].label}
            </option>
          ))}
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
      <p className="mt-1 text-xs text-text-tertiary">{ROLE_LABELS[role].help}</p>

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
            {member.name || member.email || "Loki user"} · {ROLE_LABELS[member.role].label}
          </span>
          <span className="flex gap-1">
            <button type="button" className="ui-btn-ghost" onClick={() => void handOver(member)}>
              Hand over
            </button>
            <button
              type="button"
              className="ui-btn-ghost"
              onClick={() => void removeMember(member.userId)}
            >
              Remove
            </button>
          </span>
        </div>
      ))}
      {data.invitations.map((inv) => (
        <div
          key={inv.id}
          className="mt-2 flex items-center justify-between gap-3 text-xs text-text-tertiary"
        >
          <span>
            {inv.email} · {ROLE_LABELS[inv.role].label} · invited, not yet joined
          </span>
          <button type="button" className="ui-btn-ghost" onClick={() => void withdraw(inv.id)}>
            Withdraw
          </button>
        </div>
      ))}
    </section>
  );
}
