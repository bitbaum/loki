"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import {
  orangecatAuthorizationParams,
  orangecatButtonLabel,
  type OrangeCatIntent,
} from "@/lib/auth/orangecat-sign-in";
import { AuthSecondaryButton } from "@/components/auth/AuthShell";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function OrangeCatIcon() {
  // Minimal monochrome cat mark — matches the GitHub/X icon treatment.
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M12 4.5c-1 0-1.9.17-2.76.5L5.5 2v4.32A7.47 7.47 0 0 0 4.5 10c0 4.14 3.36 7.5 7.5 7.5s7.5-3.36 7.5-7.5c0-1.35-.36-2.61-1-3.68V2l-3.74 3c-.87-.33-1.77-.5-2.76-.5Zm-3 4.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm6 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 13l1.2 1.6a1.5 1.5 0 0 1-2.4 0L12 13Zm-1.5 5.4c.47.2.98.32 1.5.35.52-.03 1.03-.15 1.5-.35v1.35a5.9 5.9 0 0 1-3 0V18.4Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export interface OAuthEnabledFlags {
  orangecatEnabled: boolean;
  githubEnabled: boolean;
  googleEnabled: boolean;
  twitterEnabled: boolean;
}

export function hasAnyOAuth(flags: OAuthEnabledFlags): boolean {
  return (
    flags.orangecatEnabled || flags.githubEnabled || flags.googleEnabled || flags.twitterEnabled
  );
}

/**
 * The OAuth block shared by sign-in AND sign-up (it must never again exist
 * on only one of them — a new user following the primary CTA used to be
 * unable to discover OrangeCat login at all).
 *
 * OrangeCat comes first with the accent treatment: it is the stack's
 * identity root (one account across OrangeCat, Loki, Solon), so it is
 * the default door; the other providers are conveniences.
 */
export function OAuthButtons({
  flags,
  callbackUrl,
  intent = "sign-in",
}: {
  flags: OAuthEnabledFlags;
  callbackUrl: string;
  /** "sign-up" opens OrangeCat on its create-account screen (prompt=create). */
  intent?: OrangeCatIntent;
}) {
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  async function handleOAuth(provider: string) {
    setOauthLoading(provider);
    await signIn(
      provider,
      { callbackUrl },
      provider === "orangecat" ? orangecatAuthorizationParams(intent) : undefined,
    );
  }

  if (!hasAnyOAuth(flags)) return null;

  return (
    <div className="space-y-2">
      {flags.orangecatEnabled && (
        <AuthSecondaryButton
          type="button"
          onClick={() => handleOAuth("orangecat")}
          disabled={oauthLoading !== null}
          className="ui-auth-oauth-primary gap-2.5"
        >
          <OrangeCatIcon />
          {oauthLoading === "orangecat" ? "Redirecting…" : orangecatButtonLabel(intent)}
        </AuthSecondaryButton>
      )}
      {flags.githubEnabled && (
        <AuthSecondaryButton
          type="button"
          onClick={() => handleOAuth("github")}
          disabled={oauthLoading !== null}
          className="ui-auth-secondary-btn-strong gap-2.5"
        >
          <GithubIcon />
          {oauthLoading === "github" ? "Redirecting…" : "Continue with GitHub"}
        </AuthSecondaryButton>
      )}
      {flags.googleEnabled && (
        <AuthSecondaryButton
          type="button"
          onClick={() => handleOAuth("google")}
          disabled={oauthLoading !== null}
          className="ui-auth-secondary-btn-strong gap-2.5"
        >
          <GoogleIcon />
          {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
        </AuthSecondaryButton>
      )}
      {flags.twitterEnabled && (
        <AuthSecondaryButton
          type="button"
          onClick={() => {
            setOauthLoading("twitter");
            window.location.href = "/api/x-login/start";
          }}
          disabled={oauthLoading !== null}
          className="ui-auth-secondary-btn-strong gap-2.5"
        >
          <XIcon />
          {oauthLoading === "twitter" ? "Redirecting…" : "Continue with X"}
        </AuthSecondaryButton>
      )}
    </div>
  );
}
