import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/shell/ThemeProvider";
import { DogfoodFeedbackWidget } from "@/components/shell/DogfoodFeedbackWidget";
import { APP_DESCRIPTION, APP_NAME, APP_URL } from "@/config/brand";
import { PALETTE } from "@/lib/palette";
import "./globals.css";

// Geist (a modern technical grotesk) + Geist Mono — the x.ai / grok / modern
// product typeface. Self-hosted by the `geist` package; exposes the CSS vars
// --font-geist-sans / --font-geist-mono which globals.css maps to
// --font-sans / --font-mono (SSOT).

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/app-icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  // OpenGraph + Twitter pick up the file-convention opengraph-image.tsx
  // (served at /opengraph-image) and twitter-image.tsx automatically once the
  // openGraph / twitter blocks are declared here.
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: APP_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the visual viewport instead of overlaying
  // it, so a bottom-anchored composer (Loki, Terminal) stays visible above the
  // keyboard rather than being covered by it.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PALETTE.light.surfacePage },
    { media: "(prefers-color-scheme: dark)", color: PALETTE.dark.surfacePage },
  ],
};

// Client auth/onboarding pages use hooks; avoid static prerender failures (Next 16 + React 19).
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full" suppressHydrationWarning>
        <SessionProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SessionProvider>
        {/* Dogfood: Loki's own feedback widget, on every surface except a
            short excluded list (config/feedback-widget.ts). Active only where
            FEEDBACK_WIDGET_TOKEN is provisioned. It sits in the ROOT layout on
            purpose — a signed-in user hitting a bug in the app had no way to
            report it, because the widget was scoped to marketing pages and
            Loki cannot file feedback. */}
        {process.env.FEEDBACK_WIDGET_TOKEN && (
          <DogfoodFeedbackWidget token={process.env.FEEDBACK_WIDGET_TOKEN} />
        )}
      </body>
    </html>
  );
}
