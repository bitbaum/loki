"use client";

import { useState } from "react";
import { useFetch } from "@/hooks/use-fetch";
import { deleteJson, postJson, throwApiError } from "@/lib/api/fetch";

type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  role: "editor" | "viewer";
};

export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const members = useFetch<{ members: Member[]; canManage: boolean; role: string }>(
    `/api/projects/${projectId}/members`,
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (members.loading || members.error || !members.data?.canManage) return null;

  async function addEditor() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await postJson(`/api/projects/${projectId}/members`, {
        email,
        role: "editor",
      });
      if (!response.ok) await throwApiError(response, "Could not add editor");
      setEmail("");
      setMessage("Editor added. They can now triage and implement this project's feedback.");
      members.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add editor");
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    const response = await deleteJson(`/api/projects/${projectId}/members`, { userId });
    if (!response.ok) {
      setMessage("Could not remove editor");
      return;
    }
    members.refetch();
  }

  return (
    <details className="mb-4 rounded-lg border border-border-subtle bg-surface-raised p-3">
      <summary className="cursor-pointer text-sm font-medium text-text-primary">
        Editors · {members.data.members.filter((m) => m.role === "editor").length}
      </summary>
      <p className="mt-2 text-xs text-text-secondary">
        Editors can review and implement feedback. Reporters can only track their own submissions.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="ui-input flex-1"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Editor’s Loki account email"
        />
        <button
          className="ui-btn-primary"
          type="button"
          disabled={busy || !email.trim()}
          onClick={addEditor}
        >
          {busy ? "Adding…" : "Add editor"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-text-secondary">{message}</p>}
      {members.data.members.map((member) => (
        <div
          key={member.userId}
          className="mt-2 flex items-center justify-between gap-3 text-xs text-text-secondary"
        >
          <span>
            {member.name || member.email || "Loki user"} · {member.role}
          </span>
          <button type="button" className="ui-btn-ghost" onClick={() => void remove(member.userId)}>
            Remove
          </button>
        </div>
      ))}
    </details>
  );
}
