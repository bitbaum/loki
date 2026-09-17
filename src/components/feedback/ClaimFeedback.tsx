"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api/fetch";

export function ClaimFeedback({ token, signedIn }: { token: string; signedIn: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const callback = `/claim-feedback?token=${encodeURIComponent(token)}`;

  useEffect(() => {
    if (!signedIn) return;
    void (async () => {
      const response = await postJson("/api/feedback/claim", { token });
      if (response.ok) {
        router.replace("/my-feedback");
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Loki could not attach this feedback to your account.");
    })();
  }, [router, signedIn, token]);

  if (signedIn && !error)
    return <p className="text-sm text-text-secondary">Linking your feedback…</p>;
  if (error) return <p className="ui-error">{error}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/sign-up?callbackUrl=${encodeURIComponent(callback)}`}
        className="ui-btn-primary"
      >
        Create a free account
      </Link>
      <Link
        href={`/sign-in?callbackUrl=${encodeURIComponent(callback)}`}
        className="ui-btn-secondary"
      >
        Sign in
      </Link>
    </div>
  );
}
