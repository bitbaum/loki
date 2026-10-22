"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Link2, Plus, Loader2 } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
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

  // All members across all orgs the user belongs to (deduplicated by userId).
  const allMembers = orgs.flatMap((o) => o.members);
  const uniqueMembers = allMembers.filter(
    (m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i,
  );

  return (
    <section className="ui-settings-section">
      {uniqueMembers.length > 1 && (
        <Section title="Members">
          <List aria-label="Members">
            {uniqueMembers.map((m) => (
              <ListRow
                key={m.userId}
                avatar={(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                title={m.name ?? m.email ?? "Unknown"}
                secondary={m.username ? `@${m.username}` : undefined}
                trailing={m.role}
              />
            ))}
          </List>
        </Section>
      )}

      <Section title="Invite someone">
        <p className="ui-settings-lede">
          Make a link and send it to them. It works for {INVITATION_EXPIRY_DAYS} days.
        </p>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Their email (optional)"
            aria-label="Their email (optional)"
            className="ui-input flex-1"
          />
          <button
            onClick={create}
            disabled={creating}
            className="ui-btn-secondary gap-1.5 whitespace-nowrap"
          >
            {creating ? <Loader2 className="ui-spinner-sm" /> : <Plus className="h-3.5 w-3.5" />}
            Make link
          </button>
        </div>
        {error && <p className="ui-error">{error}</p>}
      </Section>

      {invites.length > 0 ? (
        <Section title="Links you made">
          <List aria-label="Links you made">
            {invites.map((inv) => {
              const expired = new Date(inv.expiresAt) < new Date();
              const used = !!inv.usedAt;
              const open = !used && !expired;
              return (
                <ListRow
                  key={inv.id}
                  icon={Link2}
                  title={inv.email ? `For ${inv.email}` : "Open link"}
                  secondary={
                    used
                      ? "Used"
                      : expired
                        ? "Expired"
                        : `Works until ${new Date(inv.expiresAt).toLocaleDateString()}`
                  }
                  status={open ? "positive" : undefined}
                  menu={
                    open ? (
                      <button
                        onClick={() => copy(inv.token)}
                        className="ui-btn-icon"
                        aria-label={copied === inv.token ? "Link copied" : "Copy link"}
                        title="Copy link"
                      >
                        {copied === inv.token ? (
                          <Check className="h-4 w-4 text-status-positive" aria-hidden />
                        ) : (
                          <Copy className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </List>
        </Section>
      ) : (
        uniqueMembers.length <= 1 && (
          <p className="ui-settings-lede">No links yet. Make one to invite someone.</p>
        )
      )}
    </section>
  );
}
