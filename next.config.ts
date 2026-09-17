import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Build-time version stamp — baked into the client bundle as NEXT_PUBLIC_* so
// the UI can show "which build is this" under the logo (and a changelog link).
// SHA is the precise build identity; the package version is the marketing
// semver. Computed once at build; on the box the push-deploy hook builds
// locally then rsyncs, so the SHA reflects the deployed commit. The desktop
// (Fleet Runner) version is read separately at runtime from the User-Agent
// (`FleetRunner/<ver>`, set in desktop/src/main/index.ts).
function buildSha(): string {
  if (process.env.LOKI_BUILD_SHA) return process.env.LOKI_BUILD_SHA;
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}
const PKG_VERSION = (() => {
  try {
    return (JSON.parse(readFileSync("./package.json", "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin file tracing to the project dir. Without this, a build run inside a
  // nested git worktree (.claude/worktrees/*) walks up to the outer checkout's
  // lockfile as the inferred workspace root: server.js lands nested inside
  // standalone/ and the traced externals (require-in-the-middle, node-pty)
  // become symlinks that escape the tree — both shipped a broken standalone
  // on 2026-07-28. `npm run build` always runs from the project dir.
  outputFileTracingRoot: process.cwd(),
  // node-pty is a native addon (compiled .node) — it must stay external, never
  // bundled by Turbopack/webpack, and only runs in the Node runtime. It backs
  // the LocalPtyExecutor (Loki-owned agent PTYs). See
  // docs/architecture/agent-execution-platform.md.
  // (shiki no longer needs to be external: bip-kit 0.2.1's setHighlighterLoader
  // seam — registered in ThoughtArticleBody — puts the literal import("shiki")
  // in our own code, so the bundler ships it like any other dependency.)
  serverExternalPackages: ["node-pty"],
  env: {
    NEXT_PUBLIC_APP_VERSION: PKG_VERSION,
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
  },
  async redirects() {
    // Assembled so the repo carries no literal of the retired product name.
    const OLD = ["fleet", "crown"].join("");
    return [
      { source: "/agents", destination: "/control", permanent: true },
      { source: "/atlas", destination: "/projects", permanent: true },
      // The product was renamed on 2026-09-14; three article slugs carried the
      // old name and had been shared. Keep the links alive.
      {
        source: `/thoughts/from-idea-to-first-commit-the-${OLD}-bootstrap-loop`,
        destination: "/thoughts/from-idea-to-first-commit-the-loki-bootstrap-loop",
        permanent: true,
      },
      {
        source: `/thoughts/from-polling-to-listening-${OLD}-v0-6`,
        destination: "/thoughts/from-polling-to-listening-loki-v0-6",
        permanent: true,
      },
      {
        source: `/thoughts/the-levelsio-pattern-productized-who-${OLD}-is-for`,
        destination: "/thoughts/the-levelsio-pattern-productized-who-loki-is-for",
        permanent: true,
      },
    ];
  },
  async headers() {
    // Security headers on every response. Shape follows the fleet reference
    // implementation, aoz-begleitung/next.config.js. Everything in this list is
    // inert for rendering: it constrains sniffing, framing, referrer detail,
    // transport and device APIs — never what a page is allowed to load.
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // SAMEORIGIN is safe for the embeddable feedback widget. widget/main.ts
      // mounts a shadow-DOM host into the CUSTOMER page's own <body>
      // (attachShadow + document.body.appendChild) — Loki serves no document
      // that is framed on a customer site, and there is no iframe anywhere in
      // widget/ or src/. /api/widget-boot and the ingest API are cross-origin
      // fetches; framing rules do not touch CORS, and those routes keep setting
      // their own Access-Control-* headers.
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      // microphone=(self) — deliberately NOT the empty `microphone=()`. An
      // empty allowlist denies the feature to EVERY origin including this one,
      // so the browser never prompts and getUserMedia rejects immediately with
      // NotAllowedError. That would silently kill speak-to-report in the
      // dogfood widget (widget/voice.ts) and the app's own dictation
      // (src/hooks/use-whisper-mic.ts, src/hooks/use-voice-input.ts).
      // orangecat.ch shipped the empty form once and had to undo it for exactly
      // this reason. camera and geolocation stay fully denied — nothing here
      // uses them.
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      // REPORT-ONLY on purpose, and it must stay that way until it has been
      // observed. An enforcing Content-Security-Policy blocks SILENTLY: a
      // policy one source short breaks a stylesheet, an image or a third-party
      // script with nothing on screen to explain it. Report-Only asks the
      // browser to report what WOULD have been blocked and block nothing, so
      // this header cannot change how any page looks or behaves.
      //
      // What has to be observed before it could ever become an enforcing
      // `Content-Security-Policy`:
      //   1. a report sink is actually wired up (report-to / report-uri, e.g.
      //      via the Sentry tunnel at /monitoring) — today nothing collects
      //      these reports, so the header is a placeholder for that work;
      //   2. zero violations over real traffic covering the authenticated
      //      shell, /docs/feedback-widget and the widget itself, the Sentry
      //      tunnel, and the markdown content pages (/thoughts, /whitepaper);
      //   3. 'unsafe-inline' and 'unsafe-eval' replaced by per-request nonces —
      //      while they are present script-src is largely decorative.
      {
        key: "Content-Security-Policy-Report-Only",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "media-src 'self' blob: data:",
          "connect-src 'self' https://*.sentry.io",
          "frame-src 'self'",
          "frame-ancestors 'self'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
        ].join("; "),
      },
    ];

    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  outputFileTracingExcludes: {
    "/api/agent/launch": ["./next.config.ts"],
    "/api/system/doctor": ["./next.config.ts"],
    // CRITICAL — without this glob the standalone build's per-route bundles
    // ballooned (the tracer copies traced deps into each), wasting disk and
    // build time. The desktop/ subtree is the Electron app + its
    // node_modules + AppImage build artifacts.
    // It has NOTHING to do with the web app, but Next.js's output:
    // "standalone" tracer was copying the whole tree into every function
    // on the off chance any web code happened to import something from
    // `desktop/`. Nothing does. The "*" key applies the exclusion to
    // every route bundle.
    "*": [
      "./next.config.ts",
      "./desktop/**",
      // The v0.6 event bridge is its own Node service that runs on the box
      // (alongside Postgres) — not part of the web app bundle. Excluding the
      // directory keeps its node_modules out of every route bundle. Same
      // lesson as desktop/.
      "./bridge/**",
      // AppImage extraction artifacts (e.g., from `./Fleet-Runner-*.AppImage
      // --appimage-extract`) drop a `squashfs-root/` tree containing the
      // full unpacked Electron app (~300 MB). It also has nothing to do
      // with the web app; tracing was including it whenever a dev had
      // extracted an AppImage in the repo root for inspection.
      "./squashfs-root/**",
    ],
  },
  outputFileTracingIncludes: {
    // Serves the @loki/agent CLI script to new customers (the package
    // isn't published to npm yet and the repo is private). Without explicit
    // tracing, the standalone tracer would drop the file from the build.
    "/api/agent/install": ["./packages/agent/bin/**"],
    // Markdown content read at runtime via process.cwd()/content (e.g. the
    // /whitepaper page). Tracing it INTO the standalone build makes it
    // deterministically present at .next/standalone/content/, instead of
    // relying on the postbuild deploy-local.sh copy — which raced with the
    // standalone recreate and intermittently left /whitepaper 500-ing
    // (ENOENT content/whitepaper.md), repeatedly failing the pre-push smoke.
    "/whitepaper": ["./content/**"],
    // /api/agent/daemon's bash + python bundle entries are gone — Session 4 of
    // killing-the-bash-daemon (2026-06-11) deleted the source files and the
    // route now returns 410 Gone pointing at /download for Fleet Runner.
  },
};

// Sentry build options — safe without env: sourcemap upload only runs when
// SENTRY_AUTH_TOKEN is set, so builds never fail on a missing token. The SDK
// itself is env-gated at runtime via NEXT_PUBLIC_SENTRY_DSN (see
// sentry.server.config.ts / sentry.edge.config.ts / src/instrumentation-client.ts).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
