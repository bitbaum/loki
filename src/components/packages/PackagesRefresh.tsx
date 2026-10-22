"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { postJson } from "@/lib/api/fetch";

/**
 * Read the repositories again, then re-render the page with what was found.
 *
 * `autoStart` runs it once on arrival when the data is missing or older than
 * six hours, so the first visit is never an empty page with a button to work
 * out. A failure says so beside the button, which stays the way to retry.
 */
export function PackagesRefresh({
  autoStart = false,
  projectId,
  label = "Refresh",
  variant = "button",
}: {
  autoStart?: boolean;
  /** Read only this project. */
  projectId?: string;
  label?: string;
  /** `link`: a quiet text button at the end of a line (/packages' read line),
   *  where the state is the button's own word. */
  variant?: "button" | "link";
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "reading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  async function run() {
    setState("reading");
    setMessage(null);
    try {
      const res = await postJson("/api/packages/sync", projectId ? { projectId } : {});
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        failed?: number;
      };
      if (!res.ok) throw new Error(body.error ?? "Could not read the repositories.");
      setState("idle");
      setMessage(
        body.failed
          ? `${body.failed} ${body.failed === 1 ? "repository" : "repositories"} could not be read — see below.`
          : null,
      );
      router.refresh();
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not read the repositories.");
    }
  }

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    // Deferred a tick so the first paint is the page, not a spinner on a blank one.
    const timer = setTimeout(() => void run(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, [autoStart]);

  if (variant === "link") {
    return (
      <>
        <button
          type="button"
          onClick={() => void run()}
          disabled={state === "reading"}
          className="ui-link-muted"
        >
          {state === "reading" ? "Reading…" : state === "error" ? "Try again" : label}
        </button>
        {message && (
          <span role={state === "error" ? "alert" : "status"}>
            {" "}
            {state === "error" ? "Could not read them just now." : message}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === "reading"}
        className="ui-btn-secondary min-h-11 gap-2"
      >
        {state === "reading" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        {state === "reading" ? "Reading repositories…" : state === "error" ? "Try again" : label}
      </button>
      {message && (
        <p
          role={state === "error" ? "alert" : "status"}
          className={state === "error" ? "ui-error-xs" : "text-xs text-text-tertiary"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
