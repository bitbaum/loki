"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ROUTES } from "@/config/auth";
import {
  OPEN_SOURCE_STARTERS,
  OPEN_SOURCE_STARTER_IDS,
  TAKE,
  openSourceRepoUrl,
  type OpenSourceStarterId,
} from "@/config/open-source-starters";
import { cn } from "@/lib/utils";

type Draft = { repo: OpenSourceStarterId; wishes: string; requestId: string };

const isStarter = (value: unknown): value is OpenSourceStarterId =>
  OPEN_SOURCE_STARTER_IDS.includes(value as OpenSourceStarterId);

/**
 * "Make it yours": pick one of our open-source projects, say what your copy
 * should be, and Loki's agents import it into a project of your own and
 * personalise it. Same shape as /change: the draft survives sign-in, and a
 * resubmit reuses its requestId so it cannot create two projects.
 */
export function TakeRepoBrief({
  signedIn,
  initialRepo,
}: {
  signedIn: boolean;
  initialRepo?: string;
}) {
  const router = useRouter();
  const [repo, setRepo] = useState<OpenSourceStarterId>(
    isStarter(initialRepo) ? initialRepo : OPEN_SOURCE_STARTER_IDS[0],
  );
  const [wishes, setWishes] = useState("");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(TAKE.draftKey);
        const draft: Partial<Draft> | null = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
        if (draft) {
          // A link that names a project wins over an older draft for another one.
          if (isStarter(draft.repo) && !isStarter(initialRepo)) setRepo(draft.repo);
          if (typeof draft.wishes === "string") setWishes(draft.wishes.slice(0, TAKE.maxWishes));
          if (typeof draft.requestId === "string" && /^[a-f\d-]{36}$/.test(draft.requestId))
            requestId.current = draft.requestId;
        }
      } catch {
        /* Storage is optional. */
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialRepo]);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(
        TAKE.draftKey,
        JSON.stringify({ repo, wishes, requestId: requestId.current }),
      );
    } catch {
      /* optional */
    }
  }, [repo, wishes, ready]);

  async function build() {
    if (sending || !wishes.trim()) return;
    setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      sessionStorage.setItem(
        TAKE.draftKey,
        JSON.stringify({ repo, wishes, requestId: requestId.current }),
      );
    } catch {
      /* optional */
    }
    if (!signedIn) {
      const back = `${TAKE.path}?repo=${repo}`;
      router.push(`${ROUTES.SIGN_IN}?callbackUrl=${encodeURIComponent(back)}`);
      return;
    }
    setSending(true);
    try {
      const response = await fetch(TAKE.buildPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, wishes, requestId: requestId.current }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        projectPath?: string;
      };
      if (!response.ok || !body.ok)
        throw new Error(body.error ?? "Your brief is still here. Try again to resume.");
      if (!body.projectPath || !/^\/projects\/[\da-f-]+\/watch$/.test(body.projectPath))
        throw new Error("The response was incomplete. Retry to resume this request.");
      try {
        sessionStorage.removeItem(TAKE.draftKey);
      } catch {
        /* optional */
      }
      router.push(body.projectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again; your brief is still here.");
    } finally {
      setSending(false);
    }
  }

  const starter = OPEN_SOURCE_STARTERS[repo];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Project to start from">
        {OPEN_SOURCE_STARTER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={repo === id}
            onClick={() => {
              requestId.current = "";
              setRepo(id);
            }}
            className={cn("ui-chip-toggle", repo === id && "ui-chip-toggle-active")}
          >
            {OPEN_SOURCE_STARTERS[id].name}
          </button>
        ))}
      </div>

      <section className="ui-change-brief" aria-label="Your copy">
        <p className="text-sm text-text-secondary">
          {starter.what} Your copy needs {starter.needs}.{" "}
          <a
            className="ui-public-link inline-flex items-center gap-1"
            href={openSourceRepoUrl(repo)}
          >
            See the code
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </p>

        <label htmlFor="take-brief-text" className="ui-change-brief-label">
          What yours is for
        </label>
        <textarea
          id="take-brief-text"
          className="ui-input min-h-24 w-full resize-y text-base"
          rows={4}
          maxLength={TAKE.maxWishes}
          placeholder={`e.g. “A ${starter.name} for my climbing club: our name, green, and only the parts we need.”`}
          value={wishes}
          disabled={!ready || sending}
          onChange={(e) => {
            requestId.current = "";
            setWishes(e.target.value);
          }}
        />

        {error && (
          <p role="alert" className="ui-error">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void build()}
            className="ui-btn-primary min-h-11"
            disabled={sending || !ready || !wishes.trim()}
          >
            {sending ? "Creating your project…" : `Make my own ${starter.name}`}
          </button>
          <span className="text-sm text-text-muted">
            {signedIn
              ? "Agents copy it, rename it and show you before anything runs."
              : "You sign in next; this brief stays here."}
          </span>
        </div>
      </section>
    </div>
  );
}
