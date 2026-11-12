import { AppShell } from "@/components/shell/AppShell";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { auth } from "@/auth";
import { cookies } from "next/headers";
import { SIDEBAR_COLLAPSE_COOKIE, SIDEBAR_COLLAPSED_BY_DEFAULT } from "@/config/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Server fact handed to the client shell: whether "Connect OrangeCat" can
  // work at all here. Same SSOT as the sign-in buttons, same reason.
  const { orangecat } = getEnabledAuthProviders();
  // The same fact the root layout loads /widget.js on: with it, the top bar
  // draws the widget's launcher in the chrome, not a tab over the content.
  const feedbackWidget = !!process.env.FEEDBACK_WIDGET_TOKEN;
  // Who is signed in, so the floating assistant keeps its thread per person
  // on a shared device (lib/loki/panel-thread.ts). The token's id is enough
  // for a storage key; nothing is read from the database for it.
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  // The sidebar's width, known before the first paint (config/shell).
  const stored = (await cookies()).get(SIDEBAR_COLLAPSE_COOKIE)?.value;
  const sidebarCollapsed =
    stored === "true" ? true : stored === "false" ? false : SIDEBAR_COLLAPSED_BY_DEFAULT;
  return (
    <AppShell
      orangecatEnabled={orangecat}
      feedbackWidget={feedbackWidget}
      viewerId={viewerId}
      initialSidebarCollapsed={sidebarCollapsed}
    >
      {children}
    </AppShell>
  );
}
