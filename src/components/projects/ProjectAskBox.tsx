"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Composer } from "@/components/composer/Composer";
import { postJson, throwApiError } from "@/lib/api/fetch";

type Sent = { text: string; say: string; building: boolean; followPath: string };

/**
 * Ask for a change to a project you were invited onto, from its page in Loki
 * — the door that sits beside the site's Feedback button, and the same room
 * behind it (lib/feedback/ask-in-loki.ts). Typed or spoken, through THE
 * composer: no second message box.
 *
 * What it promises is said back in one line once sent ("Loki is building it
 * now…" for a Builder, "Sent to George…" for anyone else), with the way to
 * follow it — never a chat that answers with instructions to install things.
 */
export function ProjectAskBox({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);

  async function send(text: string): Promise<boolean> {
    setSending(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/ask`, { text });
      if (!res.ok) await throwApiError(res, "Could not send that — try again.");
      const data = (await res.json()) as Omit<Sent, "text">;
      setSent((prev) => [{ text, ...data }, ...prev]);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that — try again.");
      // Keep the words in the box: a failed send is retried, never retyped.
      return false;
    } finally {
      setSending(false);
    }
  }

  return (
    <div id="ask" className="mt-4 scroll-mt-24 space-y-3">
      <Composer
        onSend={(text) => send(text)}
        placeholder={`What should change on ${projectName}?`}
        ariaLabel={`Ask for a change to ${projectName}`}
        attach={false}
        sending={sending}
        disabled={sending}
        hint="Type it, or use the mic and say it — in any language."
      />
      {error && (
        <p role="alert" className="ui-error">
          {error}
        </p>
      )}
      {sent.map((s) => (
        <div key={s.followPath + s.text} className="ui-card-shell space-y-2 p-4" role="status">
          <p className="line-clamp-3 text-sm text-text-secondary">“{s.text}”</p>
          <p className="flex items-start gap-2 text-base text-text-primary">
            <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{s.say}</span>
          </p>
          <Link href={s.followPath} className="ui-btn-secondary min-h-11 gap-2">
            {s.building ? "Follow it" : "See where it is"}{" "}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ))}
    </div>
  );
}
