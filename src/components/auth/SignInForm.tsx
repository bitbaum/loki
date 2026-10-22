"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AUTH_COPY, fromSiteWidget, keepCallback, ROUTES } from "@/config/auth";
import { goAfterSignIn } from "@/lib/auth/after-sign-in";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/config/demo";
import {
  AuthShell,
  AuthCard,
  AuthField,
  AuthInput,
  AuthSubmitButton,
  AuthDivider,
  AuthHeading,
  AuthModeTabs,
  AuthSecondaryButton,
} from "@/components/auth/AuthShell";
import { OAuthButtons, hasAnyOAuth } from "@/components/auth/OAuthButtons";
import Link from "next/link";

type Mode = "email" | "owner";

function FormInner({
  githubEnabled,
  googleEnabled,
  twitterEnabled,
  orangecatEnabled,
  localAuthEnabled,
  demoEnabled,
}: {
  githubEnabled: boolean;
  googleEnabled: boolean;
  twitterEnabled: boolean;
  orangecatEnabled: boolean;
  localAuthEnabled: boolean;
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? ROUTES.APP_HOME;
  const safeCallback =
    callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : ROUTES.APP_HOME;

  const urlError = searchParams.get("error");
  const urlErrorMsg =
    urlError === "OAuthAccountNotLinked"
      ? "This email is already registered with a different sign-in method. Sign in with that method first, then connect OrangeCat under Settings → Account."
      : urlError === "AccessDenied"
        ? "Access was denied. Please try again."
        : urlError
          ? "Sign-in failed. Please try again."
          : "";

  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ownerPwd, setOwnerPwd] = useState("");
  const [error, setError] = useState(urlErrorMsg);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState("");

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("email-password", { email, password, redirect: false });
    setLoading(false);
    if (res?.ok) {
      goAfterSignIn(router.push, safeCallback);
    } else {
      setError("Incorrect email or password.");
    }
  }

  async function handleOwnerPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("local", { password: ownerPwd, redirect: false });
    setLoading(false);
    if (res?.ok) {
      goAfterSignIn(router.push, safeCallback);
    } else {
      setError("Wrong owner password.");
    }
  }

  // The demo is the same email+password provider as everyone else — no special
  // sign-in path to keep secure, and the credentials are public by design (they
  // are printed below the button). What makes the demo safe is the sandbox in
  // src/config/demo.ts, not secrecy about how to get in.
  async function handleDemo() {
    setDemoError("");
    setDemoLoading(true);
    const res = await signIn("email-password", {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      redirect: false,
    });
    setDemoLoading(false);
    if (res?.ok) goAfterSignIn(router.push, safeCallback);
    else setDemoError("The demo is being reset — try again in a moment.");
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  const oauthFlags = { orangecatEnabled, githubEnabled, googleEnabled, twitterEnabled };

  return (
    <AuthShell>
      <AuthHeading title={AUTH_COPY.signIn.title} />
      {fromSiteWidget(safeCallback) && <p className="ui-auth-hint">{AUTH_COPY.fromSite.signIn}</p>}

      {/* Mode tabs — only show owner key tab when LOCAL_AUTH_PASSWORD is configured */}
      {localAuthEnabled && (
        <AuthModeTabs
          tabs={[
            { id: "email", label: "Email" },
            { id: "owner", label: "Owner key" },
          ]}
          active={mode}
          onChange={(id) => switchMode(id as Mode)}
        />
      )}

      {mode === "email" ? (
        <AuthCard>
          {hasAnyOAuth(oauthFlags) && (
            <>
              <OAuthButtons flags={oauthFlags} callbackUrl={safeCallback} />
              <AuthDivider label="or email" />
            </>
          )}

          <form onSubmit={handleEmailPassword} className="space-y-3">
            <AuthField label="Email">
              <AuthInput
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </AuthField>
            <AuthField label="Password" htmlFor="password">
              <div className="space-y-1">
                <AuthInput
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                />
                {/* ui-tap + inline-flex, not a bare inline link: this is a
                    standalone row, and it measured 16px tall — the smallest
                    real target on the whole signed-out surface, sitting one
                    line above the password field people mistype into. */}
                <div className="flex justify-end">
                  <Link
                    href={ROUTES.FORGOT_PASSWORD}
                    className="ui-tap inline-flex items-center text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary"
                  >
                    Forgot password?
                  </Link>
                </div>
              </div>
            </AuthField>
            {error && <p className="ui-error">{error}</p>}
            <AuthSubmitButton loading={loading} label="Sign in" loadingLabel="Signing in…" />
            <p className="ui-auth-hint">
              No account?{" "}
              <Link
                href={keepCallback(ROUTES.SIGN_UP, safeCallback, ROUTES.APP_HOME)}
                className="ui-auth-hint-link"
              >
                Create one free →
              </Link>
            </p>
          </form>
        </AuthCard>
      ) : (
        <AuthCard>
          <p className="ui-auth-owner-note">
            Use the owner password set in{" "}
            <code className="ui-auth-inline-code">LOCAL_AUTH_PASSWORD</code>.
          </p>
          <form onSubmit={handleOwnerPassword} className="space-y-3">
            <AuthField label="Owner password">
              <AuthInput
                id="owner-password"
                type="password"
                value={ownerPwd}
                onChange={(e) => setOwnerPwd(e.target.value)}
                placeholder="Enter owner password"
                autoComplete="current-password"
                autoFocus
              />
            </AuthField>
            {error && <p className="ui-error">{error}</p>}
            <AuthSubmitButton
              loading={loading}
              disabled={!ownerPwd}
              label="Sign in as owner →"
              loadingLabel="Signing in…"
            />
          </form>
        </AuthCard>
      )}

      {/* The demo is the one other way in, so it is one secondary button
          under the form — not a filled button above it competing with Sign
          in. A visitor from an essay still finds it on the first screen. */}
      {demoEnabled && mode === "email" && (
        <div className="ui-auth-demo">
          <AuthDivider label="or" />
          <AuthSecondaryButton type="button" onClick={handleDemo} disabled={demoLoading}>
            {demoLoading ? "Opening the demo…" : "Explore the demo"}
          </AuthSecondaryButton>
          {demoError && <p className="ui-error">{demoError}</p>}
          <p className="ui-auth-demo-note">
            No account needed. A sample workspace with real history — starting agents and sending
            messages are switched off. It resets every night.
          </p>
        </div>
      )}
    </AuthShell>
  );
}

export function SignInForm({
  githubEnabled,
  googleEnabled,
  twitterEnabled,
  orangecatEnabled,
  localAuthEnabled,
  demoEnabled,
}: {
  githubEnabled: boolean;
  googleEnabled: boolean;
  twitterEnabled: boolean;
  orangecatEnabled: boolean;
  localAuthEnabled: boolean;
  demoEnabled: boolean;
}) {
  return (
    <Suspense>
      <FormInner
        githubEnabled={githubEnabled}
        googleEnabled={googleEnabled}
        twitterEnabled={twitterEnabled}
        orangecatEnabled={orangecatEnabled}
        localAuthEnabled={localAuthEnabled}
        demoEnabled={demoEnabled}
      />
    </Suspense>
  );
}
