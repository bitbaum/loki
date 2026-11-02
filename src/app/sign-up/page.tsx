import { SignUpForm } from "@/components/auth/SignUpForm";
import { getEnabledAuthProviders, sharedSigninLabel } from "@/lib/auth-providers";

// Server component — same pattern (and same reason) as sign-in/page.tsx:
// provider flags come from server env via the auth-providers SSOT, so the
// buttons can never drift from the actually-mounted providers.
export default function SignUpPage() {
  const providers = getEnabledAuthProviders();
  return (
    <SignUpForm
      oauthFlags={{
        orangecatEnabled: providers.orangecat,
        signinLabel: sharedSigninLabel(providers),
        githubEnabled: providers.github,
        googleEnabled: providers.google,
        twitterEnabled: providers.x,
      }}
      magicLinkEnabled={providers.magicLink}
    />
  );
}
