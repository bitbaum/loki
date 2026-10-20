"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson, throwApiError } from "@/lib/api/fetch";
import { PROJECT_ROLE_VALUES, type ProjectRole } from "@/db/schema/project-memberships";
import { ROLE_LABELS } from "@/lib/project-capabilities";
import { OPEN_INVITE_TTL_DAYS } from "@/lib/project-invite-limits";

type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  role: ProjectRole;
};
type PendingInvite = {
  id: string;
  email: string | null;
  role: ProjectRole;
  expiresAt: string;
};
type MembersResponse = {
  members: Member[];
  invitations: PendingInvite[];
  canManage: boolean;
  role: string;
};

/** Viewer first: an open link should hand out the smallest seat unless chosen. */
const ROLE_ORDER: ProjectRole[] = ["viewer", "editor", "client"].filter((r): r is ProjectRole =>
  (PROJECT_ROLE_VALUES as readonly string[]).includes(r),
);

const daysLeft = (iso: string) =>
  Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/**
 * Who has access to this project, and inviting more people.
 *
 * The owner's first question is "how do I get Manu in?", asked while talking
 * to Manu on WhatsApp (2026-10-17) — not knowing which address he signs in
 * with. So the first thing here is a LINK: choose what they can do, create
 * it, send it however you talk to them. It works once, for whoever opens it
 * first, for a week; they sign in with OrangeCat (or create that account on
 * the way) and land in the project. Inviting a specific email is still here,
 * one tap away, for when the address is known.
 */
export function ProjectMembersPanel({
  projectId,
  projectName,
  defaultRole = "viewer",
}: {
  projectId: string;
  projectName: string;
  /** Client on client work: the person a site is made for is who gets
   *  invited to it, and Viewer told her she could not ask for anything. */
  defaultRole?: ProjectRole;
}) {
  const members = useFetch<MembersResponse>(`/api/projects/${projectId}/members`);
  const [role, setRole] = useState<ProjectRole>(defaultRole);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [byEmail, setByEmail] = useState(false);
  const [email, setEmail] = useState("");
  if (members.loading || members.error || !members.data?.canManage) return null;
  const data = members.data;

  async function invite(to: string | null) {
    setBusy(true);
    setMessage(null);
    setLink(null);
    try {
      const response = await postJson(`/api/projects/${projectId}/members`, {
        role,
        ...(to ? { email: to } : {}),
      });
      if (!response.ok) await throwApiError(response, "Could not create the invitation");
      const body = (await response.json()) as { member?: Member; link?: string; emailed?: boolean };
      if (body.member)
        setMessage(
          body.emailed
            ? `Added — they already had an account. ${to} has an email with the link to ${projectName}.`
            : "Added — they already had an account and can open it now.",
        );
      else if (body.link) {
        setLink(body.link);
        if (to)
          setMessage(
            body.emailed
              ? `Emailed to ${to}. You can also send them this link:`
              : `No email was sent from here — send ${to} this link:`,
          );
      }
      setEmail("");
      members.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the invitation");
    } finally {
      setBusy(false);
    }
  }

  async function remove(body: { userId: string } | { invitationId: string }) {
    const response = await deleteJson(`/api/projects/${projectId}/members`, body);
    if (!response.ok) setMessage("That did not work — try again.");
    members.refetch();
  }

  async function handOver(member: Member) {
    const who = member.name || member.email || "this person";
    if (
      !window.confirm(
        `Hand ${projectName} over to ${who}? It will run in their tenant from now on; you keep a builder's seat.`,
      )
    )
      return;
    const response = await postJson(`/api/projects/${projectId}/transfer`, {
      userId: member.userId,
    });
    setMessage(response.ok ? `Handed over to ${who}.` : "Could not hand it over.");
    members.refetch();
  }

  return (
    <section
      id="people-panel"
      className="ui-settings-section"
      aria-labelledby="project-people-title"
    >
      <div>
        <h2 id="project-people-title" className="text-lg font-semibold text-text-primary">
          Invite someone to {projectName}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Create a link and send it however you talk to them — WhatsApp, a text. It works once, for
          whoever opens it first, for {OPEN_INVITE_TTL_DAYS} days. They sign in with OrangeCat, or
          create that account on the way.
        </p>
      </div>

      <fieldset>
        <legend className="ui-micro-label">They can</legend>
        <div className="mt-2">
          <Segmented
            label="They can"
            options={ROLE_ORDER.map((r) => ({
              id: r,
              label: ROLE_LABELS[r].label,
              means: ROLE_LABELS[r].help,
            }))}
            value={role}
            onChange={(r) => setRole(r as typeof role)}
          />
        </div>
      </fieldset>

      {!link && (
        <button
          type="button"
          className="ui-btn-primary min-h-11 w-full sm:w-auto"
          disabled={busy}
          onClick={() => void invite(null)}
        >
          {busy ? "Creating…" : "Create invite link"}
        </button>
      )}
      {link && (
        <InviteLink
          link={link}
          projectName={projectName}
          note={message}
          onAnother={() => {
            setLink(null);
            setMessage(null);
          }}
        />
      )}
      {!link && message && <p className="text-sm text-text-secondary">{message}</p>}

      {!byEmail ? (
        <button type="button" className="ui-link-muted text-sm" onClick={() => setByEmail(true)}>
          Know their email? Invite by email instead
        </button>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void invite(email.trim());
          }}
        >
          <input
            className="ui-input flex-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Email to invite"
          />
          <button type="submit" className="ui-btn-secondary" disabled={busy || !email.trim()}>
            Invite by email
          </button>
        </form>
      )}

      <div>
        <h3 className="ui-micro-label">
          Has access · {data.members.length + 1}
          {data.invitations.length > 0 && ` · ${data.invitations.length} invited`}
        </h3>
        <ul className="mt-2 divide-y divide-border-subtle text-sm">
          <li className="py-2 text-text-secondary">You · {ROLE_LABELS.owner.label}</li>
          {data.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-text-primary">
                {m.name || m.email || "Loki user"}
                <span className="text-text-tertiary"> · {ROLE_LABELS[m.role].label}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" className="ui-btn-ghost" onClick={() => void handOver(m)}>
                  Hand over
                </button>
                <button
                  type="button"
                  className="ui-btn-ghost"
                  onClick={() => void remove({ userId: m.userId })}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
          {data.invitations.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 break-words text-text-tertiary">
                {inv.email ?? "Invite link"} · {ROLE_LABELS[inv.role].label} · not opened yet ·{" "}
                {daysLeft(inv.expiresAt)}d left
              </span>
              <button
                type="button"
                className="ui-btn-ghost shrink-0"
                onClick={() => void remove({ invitationId: inv.id })}
              >
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The link, and the three ways to send it: copy, WhatsApp, the phone's share sheet. */
function InviteLink({
  link,
  projectName,
  note,
  onAnother,
}: {
  link: string;
  projectName: string;
  note: string | null;
  onAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `Join ${projectName} on Loki: ${link}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Denied clipboard: the link is on screen and selectable.
    }
  }
  return (
    <div className="ui-callout-positive flex-col">
      <p className="font-medium text-text-primary">{note ?? "Your invite link is ready."}</p>
      <input
        className="ui-input w-full font-mono"
        readOnly
        value={link}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex flex-wrap gap-2">
        <a
          className="ui-btn-primary min-h-11 gap-2"
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" /> Send on WhatsApp
        </a>
        <button type="button" className="ui-btn-secondary min-h-11 gap-2" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button
            type="button"
            className="ui-btn-secondary min-h-11 gap-2"
            onClick={() => void navigator.share({ text }).catch(() => undefined)}
          >
            <Share2 className="h-4 w-4" aria-hidden="true" /> Share…
          </button>
        )}
      </div>
      <button type="button" className="ui-link-muted text-sm" onClick={onAnother}>
        Invite someone else
      </button>
    </div>
  );
}
