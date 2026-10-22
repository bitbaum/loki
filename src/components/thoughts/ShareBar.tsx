"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { ORANGECAT_PUBLIC_ORIGIN } from "@/config/orangecat";

// Share affordance for essay pages: X intent + LinkedIn share + copy link.
// The absolute URL is built server-side (APP_URL SSOT in config/brand.ts)
// and passed in — window.location would disagree with the canonical URL
// behind proxies/preview hosts.
export function ShareBar({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  // Our own network first. An essay here could be shared to X and LinkedIn
  // and not to OrangeCat — the platform these essays are about (operator,
  // 2026-10-10). OrangeCat's /share opens its composer prefilled, the way
  // x.com/intent/post opens X's; a reader who does not have an account is
  // offered one and lands back on the same prefilled post.
  const orangeCatHref = `${ORANGECAT_PUBLIC_ORIGIN}/share?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
  const xHref = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  const linkedInHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions, http) — leave the button as-is;
      // the URL is still in the address bar.
    }
  }

  // Words in one line under the essay, not four bordered chips beside its
  // title: sharing is what a reader does after reading.
  return (
    <p className="ui-share-row">
      <span className="text-text-tertiary">Share on</span>
      <a
        href={orangeCatHref}
        className="ui-public-link-standalone"
        aria-label={`Share "${title}" on OrangeCat`}
      >
        OrangeCat
      </a>
      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        className="ui-public-link-standalone"
        aria-label={`Share "${title}" on X`}
      >
        X
      </a>
      <a
        href={linkedInHref}
        target="_blank"
        rel="noopener noreferrer"
        className="ui-public-link-standalone"
        aria-label={`Share "${title}" on LinkedIn`}
      >
        LinkedIn
      </a>
      <span className="text-text-muted" aria-hidden>
        ·
      </span>
      <button
        type="button"
        onClick={copyLink}
        className="ui-public-link-standalone"
        aria-label="Copy link"
      >
        {copied ? (
          <span className="inline-flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Copied
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Link2 className="h-3.5 w-3.5" /> Copy link
          </span>
        )}
      </button>
    </p>
  );
}
