import { AppShell } from "@/components/shell/AppShell";
import { getEnabledAuthProviders } from "@/lib/auth-providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Server fact handed to the client shell: whether "Connect OrangeCat" can
  // work at all here. Same SSOT as the sign-in buttons, same reason.
  const { orangecat } = getEnabledAuthProviders();
  // The same fact the root layout loads /widget.js on: with it, the top bar
  // draws the widget's launcher in the chrome, not a tab over the content.
  const feedbackWidget = !!process.env.FEEDBACK_WIDGET_TOKEN;
  return (
    <AppShell orangecatEnabled={orangecat} feedbackWidget={feedbackWidget}>
      {children}
    </AppShell>
  );
}
