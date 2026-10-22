"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, PackagePlus } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import {
  CANNOT_WRITE_MESSAGE,
  UPDATE_ACTIONS,
  UPDATE_DECISION,
  UPDATE_DECISION_LABELS,
  type UpdateAction,
} from "@/config/package-updates";
import { PAUSED_BY_OWNER } from "@/config/package-releases";
import { LinkGithubButton } from "@/components/onboarding/LinkGithubButton";
import type { UpdateCard } from "@/lib/packages/view";
import { BreakingTag, UpdateStatusTag } from "./UpdateStatusTag";

/**
 * One held package update on Approvals: what would change, whether its checks
 * pass, and the three answers — take it, not now, or stay on this version.
 * A refusal from GitHub stays on the card with the buttons, so it can be
 * tried again; "no write access" comes with the way to connect GitHub.
 */
export function PackageUpdateCard({
  update,
  onHandled,
}: {
  update: UpdateCard;
  /** Called once Loki has done it, with the sentence to keep on screen: the card is about to leave the queue. */
  onHandled?: (update: UpdateCard, decision: UpdateAction, message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);

  async function decide(decision: UpdateAction) {
    setBusy(decision);
    setResult(null);
    try {
      const res = await postJson(`/api/packages/updates/${update.id}`, { decision });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not do that just now.");
      const message = body.message ?? "Done.";
      setResult({ text: message, error: false });
      onHandled?.(update, decision, message);
      router.refresh();
    } catch (err) {
      setResult({
        text: err instanceof Error ? err.message : "Could not do that just now.",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className="ui-approvals-item space-y-3"
      aria-label={`Update for ${update.projectName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <PackagePlus className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
          <Link
            href={update.projectHref}
            className="wrap-anywhere font-medium text-text-primary hover:underline"
          >
            {update.projectName}
          </Link>
        </div>
        <a
          href={update.prUrl}
          target="_blank"
          rel="noreferrer"
          className="ui-link-subtle inline-flex items-center gap-1 text-xs"
        >
          Pull request #{update.prNumber}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      <ul className="space-y-1.5">
        {update.bumps.map((b) => (
          <li key={b.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="min-w-0 wrap-anywhere text-text-primary">{b.name}</span>
            <span className="font-mono text-xs text-text-secondary">
              {b.from} → {b.to}
            </span>
            {b.breaking && <BreakingTag />}
          </li>
        ))}
        {update.otherCount > 0 && (
          <li className="text-xs text-text-tertiary">
            and {update.otherCount} other {update.otherCount === 1 ? "update" : "updates"} in the
            same pull request
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <UpdateStatusTag status={update.checks} />
        {update.paused && <span className="ui-tag ui-tag-warning shrink-0">{PAUSED_BY_OWNER}</span>}
        <span>{update.why}</span>
      </div>
      {update.detail && <p className="text-xs text-text-tertiary">{update.detail}</p>}

      {/* An even grid, the yes on its own row on a phone: wrapping left
          "Stay on this version" alone under the other two (2026-10-19). */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {UPDATE_ACTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => void decide(d)}
            disabled={busy !== null}
            className={`${d === UPDATE_DECISION.UPDATE ? "ui-btn-primary col-span-2 sm:col-span-1" : "ui-btn-secondary"} min-h-11 gap-2`}
          >
            {busy === d && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {UPDATE_DECISION_LABELS[d]}
          </button>
        ))}
      </div>
      {result && (
        <div className="space-y-2">
          <p
            role={result.error ? "alert" : "status"}
            className={result.error ? "ui-error-xs" : "text-xs text-text-tertiary"}
          >
            {result.text}
          </p>
          {result.error && result.text === CANNOT_WRITE_MESSAGE && (
            <LinkGithubButton callbackUrl="/approvals" size="sm" />
          )}
        </div>
      )}
    </article>
  );
}
