import { DEFAULT_AUTH_LABELS as L } from "@bitbaum/accountkit/auth/react";
import { AuthCard, AuthHeading, AuthShell } from "@/components/auth/AuthShell";
import { LokiRecovery } from "@/components/auth/AccountKitAuth";
import { LegacyForgotPassword } from "@/components/auth/LegacyForgotPassword";
import { accountKitMethods } from "@/lib/auth/shared/screens";

/**
 * Recovery. On AccountKit (AUTH_RUNTIME=accountkit) it is AccountKit's own
 * form: the reset link comes back to /sign-in, where the new password is set.
 * On Auth.js, Loki's own form, as before.
 */
export default function ForgotPasswordPage() {
  const methods = accountKitMethods();
  if (!methods) return <LegacyForgotPassword />;
  return (
    <AuthShell>
      <AuthHeading title={L.recovery?.reset ?? "Reset password"} />
      <AuthCard>
        <LokiRecovery methods={methods} />
      </AuthCard>
    </AuthShell>
  );
}
