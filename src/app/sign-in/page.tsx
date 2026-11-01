import { SignInForm } from "@/components/auth/SignInForm";
import { getEnabledAuthProviders, sharedSigninLabel } from "@/lib/auth-providers";

// Server component — reads env (via the auth-providers SSOT) on the server and
// passes the result as props. This prevents the hydration mismatch that
// occurred when a "use client" component tried to read server-only process.env
// vars (always undefined on the client, causing the GitHub button to flash away
// on hydration). The enabled-provider predicates live in one place
// (src/lib/auth-providers.ts) shared with src/auth.ts, so the buttons can never
// drift from the actually-mounted providers.
export default function SignInPage() {
  const providers = getEnabledAuthProviders();
  return (
    <SignInForm
      githubEnabled={providers.github}
      googleEnabled={providers.google}
      twitterEnabled={providers.x}
      orangecatEnabled={providers.orangecat}
      signinLabel={sharedSigninLabel(providers)}
      localAuthEnabled={providers.localOwnerKeyTab}
      demoEnabled={providers.demo}
    />
  );
}
