import Link from "next/link";
import { Laptop, Smartphone } from "lucide-react";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "Quickstart",
  description: "From zero to dispatching your first agent in 5 minutes.",
};

/** The seven steps, split by the device each one actually needs. The homepage
 *  sends phone visitors here ("See how it works"), and three of these steps
 *  are terminal work — so the split is the first thing the page should say,
 *  not something you infer after reading them. */
const STEPS = [
  { n: 1, id: "decide", label: "Choose where agents run", desktop: false },
  { n: 2, id: "sign-in", label: "Sign in", desktop: false },
  { n: 3, id: "install-runner", label: "Install Fleet Runner", desktop: true },
  { n: 4, id: "agent-cli", label: "Install an agent CLI", desktop: true },
  { n: 5, id: "register-project", label: "Create project and set Runs on", desktop: false },
  { n: 6, id: "dispatch", label: "Dispatch your first intent", desktop: false },
  { n: 7, id: "watch", label: "Watch from anywhere", desktop: false },
] as const;

export default function QuickstartPage() {
  const anywhere = STEPS.filter((s) => !s.desktop);
  const needsComputer = STEPS.filter((s) => s.desktop);

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-prose mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="ui-public-title mb-2">Quickstart</h1>
        <p className="ui-public-meta mb-6 sm:mb-8">
          From zero to dispatching your first agent in 5 minutes.
        </p>

        <nav className="ui-public-steps" aria-label="Steps by device">
          <div>
            <p className="ui-public-steps-label">
              <Smartphone className="h-3.5 w-3.5" aria-hidden />
              From any device
            </p>
            <div className="ui-public-steps-list">
              {anywhere.map((step) => (
                <a key={step.id} href={`#${step.id}`} className="ui-public-steps-link">
                  <span className="ui-public-steps-num">{step.n}</span>
                  {step.label}
                </a>
              ))}
            </div>
          </div>
          <div>
            <p className="ui-public-steps-label">
              <Laptop className="h-3.5 w-3.5" aria-hidden />
              Needs a computer
            </p>
            <div className="ui-public-steps-list">
              {needsComputer.map((step) => (
                <a key={step.id} href={`#${step.id}`} className="ui-public-steps-link">
                  <span className="ui-public-steps-num">{step.n}</span>
                  {step.label}
                </a>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Reading this on a phone? Steps 3&ndash;5 are terminal work. Do 1&ndash;2 now, then
              pick these up at your machine.
            </p>
          </div>
        </nav>

        <section id="decide" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">1. Choose where agents run</h2>
          <p>
            The web and desktop share your Loki account. The web is the control plane; choose a
            builder per project:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Web</strong> (
              <Link href="/" className="ui-public-link">
                loki.orangecat.ch
              </Link>
              ) — create projects, dispatch work, and monitor sessions from any browser. Eligible
              accounts can run agents on the shared Cloud builder without installing desktop
              software.
            </li>
            <li>
              <strong>Desktop</strong> (
              <Link href="/download" className="ui-public-link">
                Fleet Runner
              </Link>
              ) — optional. Install it when a project should run in your local checkout and use
              tools or provider sign-ins from this computer. It adds native notifications too.
            </li>
          </ul>
          <p>
            Shared Cloud builder access is currently limited to eligible accounts. If it is not
            available to you, connect Fleet Runner to run projects on your computer. Loki queues
            work when the project&apos;s selected builder is offline; it does not silently switch
            machines.
          </p>
        </section>

        <section id="sign-in" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">2. Sign in</h2>
          <p>
            Visit{" "}
            <Link href="/sign-in" className="ui-public-link">
              /sign-in
            </Link>{" "}
            and sign in with GitHub. First time only: GitHub asks you to authorize Loki. After that
            you land on the dashboard.
          </p>
        </section>

        <section id="install-runner" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">
            3. Install Fleet Runner
            <span className="ui-public-step-badge">Needs a computer</span>
          </h2>
          <p>
            Skip this step if you have access to the Cloud builder and do not need a local checkout
            or tools. Fleet Runner is only needed to run work on this computer.
          </p>
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              Visit{" "}
              <Link href="/download" className="ui-public-link">
                /download
              </Link>
              . The page auto-detects your OS and has the current install steps.
            </li>
            <li>
              Follow the instructions for your operating system on the download page. Installers are
              available for Linux, macOS, and Windows; the page explains any first-launch security
              prompts.
            </li>
            <li>
              Fleet Runner opens to the same Loki interface you saw in the browser. If your browser
              is signed in, the desktop app is signed in automatically (it shares cookies).
            </li>
            <li>
              Alternatively, from{" "}
              <Link href="/sign-in" className="ui-public-link">
                /sign-in
              </Link>{" "}
              → Settings → Agent tokens, click <em>Open in Fleet Runner</em> to deep-link an auth
              token into the desktop app without copy-paste.
            </li>
          </ol>
        </section>

        <section id="agent-cli" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">
            4. Install an agent CLI
            <span className="ui-public-step-badge">Needs a computer</span>
          </h2>
          <p>
            Fleet Runner doesn&apos;t bundle agent CLIs. Install and sign in to the supported agent
            you want to use on this computer. Loki currently supports Claude Code, Codex, Cursor
            Agent, Antigravity, Grok, and OpenClaw; availability can differ by builder.
          </p>
          <p>
            You only need one agent to start. Use Control or Terminal to see which agents are
            available on your selected builder and follow that provider&apos;s current installation
            instructions.
          </p>
        </section>

        <section id="register-project" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">5. Create a project and set Runs on</h2>
          <p>
            Create or import a project, then set <strong>Runs on</strong> in Control → project
            profile. Choose Cloud builder when it is available to your account, or This computer
            when the checkout and tools are on the connected Fleet Runner. A project&apos;s selected
            builder determines where dispatches run.
          </p>
        </section>

        <section id="dispatch" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">6. Dispatch your first intent</h2>
          <p>
            Go to <strong>Control</strong>, pick a project, type a prompt, and dispatch it. The
            project&apos;s configured builder claims the work. If that builder is offline, the
            dispatch stays queued until it reconnects.
          </p>
          <p>
            The builder starts the agent in a PTY it owns. Open Terminal → Cloud builder or Your
            computer to view sessions and start a session directly. The Terminal location does not
            change the project&apos;s future <strong>Runs on</strong> setting.
          </p>
        </section>

        <section id="watch" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">7. Watch from anywhere</h2>
          <p>
            The same dashboard works from your phone while an agent runs on the Cloud builder or
            Fleet Runner. Control shows run state; Terminal streams live sessions so you can steer
            the agent remotely.
          </p>
        </section>

        <section className="ui-public-prose-divider">
          <h2 className="ui-public-prose-h2">Need help?</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <a
                href="https://github.com/bitbaum/loki/issues"
                className="ui-public-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open a GitHub issue
              </a>{" "}
              — bugs, feature requests, or questions.
            </li>
            <li>
              <Link href="/roadmap" className="ui-public-link">
                Roadmap
              </Link>{" "}
              — what&apos;s shipping next.
            </li>
            <li>
              <Link href="/whitepaper" className="ui-public-link">
                Whitepaper
              </Link>{" "}
              — the bigger architecture and product thesis.
            </li>
          </ul>
        </section>
      </main>
    </PublicSurface>
  );
}
