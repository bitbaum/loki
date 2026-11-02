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
import {
  PasskeyButton,
  SignInLinkButton,
  TwoFactorStep,
  signInWithPassword,
} from "@/components/auth/SharedWaysIn";
import Link from "next/link";
import { DEFAULT_AUTH_LABELS as L } from "@bitbaum/accountkit/auth/react";

type Mode = "email" | "owner";

function FormInner({
  githubEnabled,
  googleEnabled,
  twitterEnabled,
  orangecatEnabled,
  signinLabel,
  passkeyEnabled,
  magicLinkEnabled,
  localAuthEnabled,
  demoEnabled,
}: {
  githubEnabled: boolean;
  googleEnabled: boolean;
  twitterEnabled: boolean;
  orangecatEnabled: boolean;
  signinLabel: string | null;
  /** AccountKit runtime: passkeys and the second-factor step on this card. */
  passkeyEnabled: boolean;
  /** AccountKit runtime with account mail: the sign-in link. */
  magicLinkEnabled: boolean;
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
      : urlError === "link"
        ? "That sign-in link has expired or was already used. Ask for a new one below."
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
  const [twoFactor, setTwoFactor] = useState(false);
  const signedIn = () => goAfterSignIn(router.push, safeCallback);

  async function handleEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    if (passkeyEnabled) {
      // AccountKit runtime: straight to AccountKit, so the second factor can
      // follow on this card (the compat layer has no step for it).
      const outcome = await signInWithPassword(email, password);
      setLoading(false);
      if (outcome === "signed-in") signedIn();
      else if (outcome === "two-factor") setTwoFactor(true);
      else setError(outcome);
      return;
    }
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

  const oauthFlags = {
    orangecatEnabled,
    signinLabel,
    githubEnabled,
    googleEnabled,
    twitterEnabled,
  };

  return (
    <AuthShell>
      <AuthHeading title={L.signIn} />
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

      {mode === "email" && twoFactor ? (
        <AuthCard>
          <TwoFactorStep
            onSignedIn={signedIn}
            onBack={() => {
              setTwoFactor(false);
              setPassword("");
            }}
          />
        </AuthCard>
      ) : mode === "email" ? (
        <AuthCard>
          {(hasAnyOAuth(oauthFlags) || passkeyEnabled) && (
            <>
              <div className="space-y-2">
                <OAuthButtons flags={oauthFlags} callbackUrl={safeCallback} />
                {passkeyEnabled && <PasskeyButton onSignedIn={signedIn} />}
              </div>
              <AuthDivider label={L.orEmail} />
            </>
          )}

          <form onSubmit={handleEmailPassword} className="space-y-3">
            <AuthField label={L.email}>
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
            <AuthField label={L.password} htmlFor="password">
              <AuthInput
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                required
              />
            </AuthField>
            {error && <p className="ui-error">{error}</p>}
            <AuthSubmitButton loading={loading} label={L.signIn} loadingLabel="Signing in…" />
            {magicLinkEnabled && <SignInLinkButton email={email} callbackUrl={safeCallback} />}
            {/* AccountKit's order on every fleet app: password, the sign-in
                link, then recovery, each a full-width quiet row (44px). */}
            <Link href={ROUTES.FORGOT_PASSWORD} className="ui-auth-secondary-btn">
              {L.recovery?.forgot ?? "Forgot your password?"}
            </Link>
            <p className="ui-auth-hint">
              {L.noAccount}{" "}
              <Link
                href={keepCallback(ROUTES.SIGN_UP, safeCallback, ROUTES.APP_HOME)}
                className="ui-auth-hint-link"
              >
                {L.createAccount}
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
  signinLabel,
  passkeyEnabled,
  magicLinkEnabled,
  localAuthEnabled,
  demoEnabled,
}: {
  githubEnabled: boolean;
  googleEnabled: boolean;
  twitterEnabled: boolean;
  orangecatEnabled: boolean;
  signinLabel: string | null;
  /** AccountKit runtime: passkeys and the second-factor step on this card. */
  passkeyEnabled: boolean;
  /** AccountKit runtime with account mail: the sign-in link. */
  magicLinkEnabled: boolean;
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
        signinLabel={signinLabel}
        passkeyEnabled={passkeyEnabled}
        magicLinkEnabled={magicLinkEnabled}
        localAuthEnabled={localAuthEnabled}
        demoEnabled={demoEnabled}
      />
    </Suspense>
  );
}
