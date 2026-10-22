"use client";

import { useState } from "react";

// Minimal email capture for the Thoughts surface. POSTs to /api/newsletter
// (public, rate-limited, idempotent). Capture only — no sending pipeline
// exists, and the copy promises nothing beyond "new essays by email".
export function NewsletterSignup({ source }: { source: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("error");
        setError(body.error ?? "Something went wrong — try again.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Network error — try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="space-y-1 border-t border-border-subtle pt-6">
        <p className="text-base text-text-primary">You&apos;re on the list.</p>
        <p className="text-sm text-text-tertiary">
          New essays land in your inbox when they publish.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-border-subtle pt-6">
      <div>
        <p className="text-section font-semibold text-text-primary">Get new essays by email</p>
        <p className="text-sm text-text-tertiary">
          No schedule promises, no marketing — just the essays.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="ui-input flex-1"
          aria-label="Email address"
        />
        <button
          type="submit"
          className="ui-public-cta-ghost shrink-0"
          disabled={status === "loading"}
        >
          {status === "loading" ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      {status === "error" && <p className="ui-error">{error}</p>}
    </form>
  );
}
