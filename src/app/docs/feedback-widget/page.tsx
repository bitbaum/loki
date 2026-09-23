import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "Feedback widget",
  description:
    "Put a feedback button on any site you run. Reports land in a per-project inbox, one click dispatches an agent to fix them, and shipped fixes notify the reporter.",
};

export default function FeedbackWidgetDocsPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-prose mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="ui-public-title mb-2">Feedback widget</h1>
        <p className="ui-public-meta mb-8 sm:mb-12">
          One script tag on any site you run. Visitor reports become dispatchable fleet work, and
          shipped fixes close the loop automatically.
        </p>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">1. Enable it on a project</h2>
          <p>
            Open the project&apos;s page in Loki, scroll to <strong>Visitor feedback</strong>, and
            click <strong>Enable &amp; install via agent</strong> (or from Control, use the fleet
            coverage strip). That mints a project token and dispatches an agent to embed the
            snippet. Prefer that one click over copy-paste unless you are wiring a site by hand.
          </p>
          <pre className="ui-public-code-block ui-public-code-pre">
            <code>{`<script src="https://loki.orangecat.ch/widget.js"
        data-fc-project="fcw_…" async></script>`}</code>
          </pre>
          <p>
            The token is public by design and <strong>write-only</strong> — it can submit feedback
            for this one project and read nothing. Origins are allowlisted from your project&apos;s
            production URL; submissions from other origins are rejected.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">2. Install it — two ways</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Copy snippet</strong> — paste it into your site&apos;s base template or root
              layout, before <code>&lt;/body&gt;</code>. Any framework, any stack.
            </li>
            <li>
              <strong>Install via agent</strong> — for repo-linked projects, one click dispatches an
              agent that adds the snippet to your codebase, verifies the page loads cleanly, and
              ships it the way your repo ships changes. It will not add a second embed if one
              already exists. <strong>Remove via agent</strong> is the symmetric operation.
            </li>
          </ul>
          <p>
            If your site already has its own floating button in the bottom-right corner, add{" "}
            <code>data-fc-bottom=&quot;88&quot;</code> to stack the feedback button above it.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">3. What visitors get</h2>
          <p>
            A small button on every page. Opening it, the visitor picks a scope — <em>Element</em>{" "}
            (they click the exact thing that&apos;s broken; the widget records its CSS selector and
            visible text), <em>This page</em>, or <em>Whole site</em> — writes what should be
            improved, optionally attaches an image (file picker or paste; the widget downscales it
            client-side so a phone photo never ships megabytes), and optionally leaves a name or
            email. The widget renders in a Shadow DOM, so your styles and the widget&apos;s
            can&apos;t interfere with each other.
          </p>
          <p>
            Repeat reports don&apos;t pile up: the same complaint filed again bumps a counter on the
            existing inbox row (shown as <em>×N</em>) instead of creating a duplicate — the volume
            signal survives, the noise doesn&apos;t.
          </p>
          <p>
            They can also <strong>speak instead of typing</strong> — useful on a phone, where
            describing a bug by thumb is where most reports die. The transcript lands in the same
            box, editable, and the visitor still presses Send.
          </p>
          <p className="ui-public-callout">
            <strong>The mic needs your site&apos;s permission.</strong> If your site sends a{" "}
            <code>Permissions-Policy</code> header with <code>microphone=()</code> — an empty
            allowlist, which several security presets ship by default — browsers block the
            microphone for every origin including your own, and never show a permission prompt. The
            widget detects this and simply doesn&apos;t offer the button, rather than showing one
            that can only fail. To enable it, allow your own origin:{" "}
            <code>Permissions-Policy: microphone=(self)</code>. Everything else in the widget works
            regardless.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">4. Remote control — no deploys</h2>
          <p>
            The snippet is a pointer; all behavior is server-side. On every page load the widget
            asks Loki whether to render, and that call doubles as a heartbeat:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Live status is observed truth</strong> — the setup card shows{" "}
              <em>Live on your-site.com · last seen …</em> only once the boot call has actually
              arrived from your site.
            </li>
            <li>
              <strong>Pause / Resume</strong> — hides or shows the widget on your live site within
              ~30 seconds, without touching your code.
            </li>
            <li>
              <strong>Rotate</strong> mints a new token (the old snippet stops working);{" "}
              <strong>Disable</strong> revokes it entirely.
            </li>
          </ul>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">5. From report to fix</h2>
          <p>
            Submissions land in the project&apos;s <strong>Visitor feedback</strong> inbox, and the{" "}
            <Link href="/control" className="ui-public-link">
              Control
            </Link>{" "}
            page shows a fleet-wide strip of projects with new reports. Per row:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Dispatch fix</strong> — one report → one scoped agent run. Routes through
              Loki&apos;s <code>injectPrompt</code> SSOT: the project&apos;s configured builder. An
              eligible account can use the shared Cloud builder; connect Fleet Runner when the
              project should run on your computer. You do not pick a terminal.
            </li>
            <li>
              <strong>Dispatch all as one</strong> (2+ new items) — one agent pass covering the
              whole pile. Prefer this when you want a single coherent fix run now.
            </li>
            <li>
              <strong>Synthesize themes</strong> (3+ new items) — an agent clusters the pile into
              structured briefs filed back into the same inbox; you then Dispatch the brief. Use
              when volume is high and themes help before fixing.
            </li>
            <li>
              <strong>AI review</strong> — an agent opens any page of your site in a headless
              browser (desktop + mobile) and files findings into the same inbox.
            </li>
            <li>
              A <strong>daily digest</strong> clusters busy inboxes into themes and files each as a
              draft on{" "}
              <Link href="/approvals" className="ui-public-link">
                Approvals
              </Link>{" "}
              — with the exact agent prompt included, so you review precisely what would run.
            </li>
          </ul>
          <p>
            <strong>Nothing auto-executes.</strong> Visitor text is untrusted input; it reaches an
            agent only after your explicit click. The approval gate is a security boundary, not a
            formality.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">6. You close the loop</h2>
          <p>
            Every dispatched report remembers its run, so you can see what shipped against it.
            Resolving is deliberately a human act — a green run is not proof the reporter&apos;s
            problem went away. When you mark a report resolved, any visitor who left an email gets a
            short note that their feedback shipped. Reporters who hear back report again; that is
            the point.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">Security model</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>Token is write-only and scoped to one project; reading requires your session.</li>
            <li>Origin allowlist enforced on submission; rate limits per IP and per token.</li>
            <li>Pause / rotate / revoke take effect on the live site without customer deploys.</li>
            <li>Human approval gates every agent dispatch that involves visitor text.</li>
          </ul>
        </section>

        <p className="ui-public-meta">
          Deeper read:{" "}
          <Link href="/thoughts/the-visitor-is-part-of-the-fleet-now" className="ui-public-link">
            The Visitor Is Part of the Fleet Now
          </Link>{" "}
          — the full tour with screenshots.
        </p>
      </main>
    </PublicSurface>
  );
}
