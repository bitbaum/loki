"use client";

import { signOut } from "next-auth/react";
import { useEffect } from "react";
import { AuthShell, AuthHeading, AuthLoadingCenter } from "@/components/auth/AuthShell";
import { ROUTES } from "@/config/auth";

export default function SignOutPage() {
  useEffect(() => {
    // A sign-out that began on the studio site ends there (/studio/left).
    const studio = new URLSearchParams(window.location.search).get("then") === "studio";
    signOut({ callbackUrl: studio ? "/studio/left" : ROUTES.SIGN_IN });
  }, []);

  return (
    <AuthShell>
      <AuthHeading title="Signing out…" description="One moment." />
      <AuthLoadingCenter />
    </AuthShell>
  );
}
