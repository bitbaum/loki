import { AppShell } from "@/components/shell/AppShell";
import { getEnabledAuthProviders } from "@/lib/auth-providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Server fact handed to the client shell: whether "Connect OrangeCat" can
  // work at all here. Same SSOT as the sign-in buttons, same reason.
  const { orangecat } = getEnabledAuthProviders();
  return <AppShell orangecatEnabled={orangecat}>{children}</AppShell>;
}
