"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Plus, Loader2, Users } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import type { Invitation } from "@/db/schema";
import type { OrgWithMembers } from "@/app/api/orgs/route";
import { INVITATION_EXPIRY_DAYS } from "@/lib/constants";

type Props = { invitations: Invitation[] };

export function TeamSettings({ invitations: initial }: Props) {
  const [invites, setInvites] = useState(initial);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgWithMembers[]>([]);

  useEffect(() => {
    fetch("/api/orgs")
      .then((r) => r.json())
      .then((d: { orgs?: OrgWithMembers[] }) => setOrgs(d.orgs ?? []))
      .catch(() => {});
  }, []);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const res = await postJson("/api/invitations", { email: email.trim() || undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create invitation");
      setInvites((prev) => [...prev, data]);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    await navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const inviteUrl = (token: string) =>
    typeof window !== "undefined"
      ? `${window.location.origin}/invite/${token}`
      : `/invite/${token}`;

  // All members across all orgs the user belongs to (deduplicated by userId).
  const allMembers = orgs.flatMap((o) => o.members);
  const uniqueMembers = allMembers.filter(
    (m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i,
  );

  return (
    <section className="ui-settings-section">
      <h2 className="font-medium text-text-primary">Team</h2>
      <p className="text-sm text-text-tertiary">
        Invite collaborators. Links expire after {INVITATION_EXPIRY_DAYS} days.
      </p>

      {/* Current members */}
      {uniqueMembers.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted">
            <Users className="mr-1 inline-block h-3 w-3" />
            Members ({uniqueMembers.length})
          </p>
          <div className="space-y-1.5">
            {uniqueMembers.map((m) => (
              <div key={m.userId} className="ui-card-shell flex items-center gap-3 px-4 py-2.5">
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.image}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs font-medium text-text-secondary">
                    {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {m.name ?? m.email ?? "Unknown"}
                  </p>
                  {m.username && (
                    <p className="truncate text-xs text-text-tertiary">@{m.username}</p>
                  )}
                </div>
                <span
                  className={`ui-tag shrink-0 ${m.role === "owner" ? "ui-tag-neutral" : "ui-tag-positive"}`}
                >
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite form */}
      <div className="flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Email (optional)"
          className="ui-input flex-1"
        />
        <button
          onClick={create}
          disabled={creating}
          className="ui-btn-secondary gap-1.5 whitespace-nowrap"
        >
          {creating ? <Loader2 className="ui-spinner-sm" /> : <Plus className="h-3.5 w-3.5" />}
          Create link
        </button>
      </div>

      {error && <p className="ui-error">{error}</p>}

      {invites.length > 0 && (
        <div className="space-y-2">
          {invites.map((inv) => {
            const expired = new Date(inv.expiresAt) < new Date();
            const used = !!inv.usedAt;
            return (
              <div key={inv.id} className="ui-card-shell flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p
                    className="truncate font-mono text-xs text-text-secondary"
                    title={inviteUrl(inv.token)}
                  >
                    {inviteUrl(inv.token).replace(/^https?:\/\//, "")}
                  </p>
                  {inv.email && (
                    <p className="text-xs text-text-tertiary mt-0.5">for {inv.email}</p>
                  )}
                </div>
                <span
                  className={`ui-tag shrink-0 ${used ? "ui-tag-neutral" : expired ? "ui-tag-negative" : "ui-tag-positive"}`}
                >
                  {used ? "used" : expired ? "expired" : "active"}
                </span>
                {!used && !expired && (
                  <button
                    onClick={() => copy(inv.token)}
                    className="ui-icon-action shrink-0 min-h-8 min-w-8 p-1.5"
                    title="Copy link"
                  >
                    {copied === inv.token ? (
                      <Check className="h-4 w-4 text-status-positive" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {invites.length === 0 && uniqueMembers.length <= 1 && (
        <p className="text-sm text-text-secondary">
          No invitations yet. Create a link to invite someone.
        </p>
      )}
    </section>
  );
}
