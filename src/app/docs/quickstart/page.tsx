import Link from "next/link";
import { Laptop, Smartphone } from "lucide-react";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "Quickstart",
  description:
    "Create an account, choose where your agents run, and turn an idea into a repository and a site.",
};

/** The steps, split by the device each one actually needs. The homepage sends
 *  phone visitors here ("See how it works"), and two of these steps are
 *  computer work — so the split is the first thing the page should say, not
 *  something you infer after reading them. The note under the list reads its
 *  step numbers from this table, so they cannot drift apart again (it once said
 *  "Steps 3–5" while only 3–4 were marked). */
const STEPS = [
  { n: 1, id: "sign-in", label: "Create your account", desktop: false },
  { n: 2, id: "decide", label: "Choose where agents run", desktop: false },
  { n: 3, id: "install-runner", label: "Install Fleet Runner", desktop: true },
  { n: 4, id: "agent-cli", label: "Install an agent", desktop: true },
  { n: 5, id: "idea", label: "Start from an idea", desktop: false },
  { n: 6, id: "dispatch", label: "Give an existing project work", desktop: false },
  { n: 7, id: "watch", label: "Watch from anywhere", desktop: false },
] as const;

export default function QuickstartPage() {
  const anywhere = STEPS.filter((s) => !s.desktop);
  const needsComputer = STEPS.filter((s) => s.desktop);
  const first = needsComputer[0]?.n;
  const last = needsComputer[needsComputer.length - 1]?.n;
  const computerSteps = first === last ? `${first}` : `${first}–${last}`;

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-prose mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="ui-public-title mb-2">Quickstart</h1>
        <p className="ui-public-meta mb-6 sm:mb-8">
          Create an account, choose where your agents run, and turn an idea into a repository and a
          site.
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
              Reading this on a phone? Steps {computerSteps} need a computer, and only if your
              agents will run on it. Everything else works from here.
            </p>
          </div>
        </nav>

        <section id="sign-in" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">1. Create your account</h2>
          <p>
            Go to{" "}
            <Link href="/sign-up" className="ui-public-link">
              /sign-up
            </Link>{" "}
            and choose <strong>Create an account with OrangeCat</strong>. One OrangeCat account
            signs you in to OrangeCat, Loki and Solon. You can also continue with GitHub, Google or
            X, or set a password just for Loki. After that you land on your dashboard.
          </p>
        </section>

        <section id="decide" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">2. Choose where agents run</h2>
          <p>
            Loki itself runs in your browser. The agents that write the code run on a{" "}
            <em>builder</em>: a computer that is switched on and signed in to them. You choose the
            builder per project:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Cloud builder</strong> — Loki&apos;s own always-on server. Nothing to install.
              It is open to some accounts for now; if yours has it, you can skip steps{" "}
              {computerSteps}.
            </li>
            <li>
              <strong>This computer</strong> — your own machine, through the{" "}
              <Link href="/download" className="ui-public-link">
                Fleet Runner
              </Link>{" "}
              app. You need it when your account does not have the cloud builder, or when the work
              should use files, tools or sign-ins that are on your computer.
            </li>
          </ul>
          <p>
            If a project&apos;s builder is offline, its work waits in a queue you can see. Loki
            never moves work to another machine on its own.
          </p>
        </section>

        <section id="install-runner" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">
            3. Install Fleet Runner
            <span className="ui-public-step-badge">Needs a computer</span>
          </h2>
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              Open{" "}
              <Link href="/download" className="ui-public-link">
                /download
              </Link>
              . It detects your system and shows the current install steps, including any security
              prompt you will see on first launch. There are builds for Linux, Windows and Apple
              Silicon Macs.
            </li>
            <li>
              Sign in once inside the app. Or, in Loki in your browser, open Settings → Agent tokens
              and press <em>Open in Fleet Runner</em> to sign the app in without copying anything.
            </li>
          </ol>
        </section>

        <section id="agent-cli" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">
            4. Install an agent
            <span className="ui-public-step-badge">Needs a computer</span>
          </h2>
          <p>
            Fleet Runner does not include the agents themselves. Install one and sign in to it on
            this computer, following that provider&apos;s own instructions. Loki works with Claude
            Code, Codex, Cursor, Antigravity and Grok. One is enough to start.
          </p>
          <p>
            Control and Terminal show which agents each builder can use, because that can differ
            from one builder to the next.
          </p>
        </section>

        <section id="idea" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">5. Start from an idea</h2>
          <p>This is the shortest way from a sentence to a working project.</p>
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              <strong>Describe it.</strong> On Projects, press <em>Add Project</em>, give it a name
              and say in a sentence or two what it is for. Loki can fill in the rest of the profile
              from what you wrote.
            </li>
            <li>
              <strong>Answer a few questions — or don&apos;t.</strong> Loki may ask up to five short
              questions about what your description left open. Every one can be skipped, and you can
              skip straight to the build.
            </li>
            <li>
              <strong>Press Make it happen.</strong> Loki runs four steps in order and shows each
              one as it goes: filling the profile, planning the milestones, creating the repository,
              and putting an agent on it. It keeps going if you lock your phone or leave the page.
            </li>
            <li>
              <strong>Your code gets a home.</strong> The repository is created in the{" "}
              <a
                href="https://github.com/bitbaum"
                className="ui-public-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                bitbaum organisation on GitHub
              </a>
              , not in a personal account. You choose a starter: Next.js, Python with FastAPI, Hono
              on Cloudflare Workers, plain HTML, or an empty repository.
            </li>
            <li>
              <strong>Your site goes up.</strong> For the Next.js and empty starters, Loki can put
              the site at <code>&lt;name&gt;.orangecat.ch</code> and update it after every change.
              When it cannot set that up for your account, it tells you and gives you the one
              command that does — it never claims a site that is not there. Sites from the other
              starters are hosted wherever you choose.
            </li>
          </ol>
          <p>
            Already have a website you want changed? Start from{" "}
            <Link href="/commission" className="ui-public-link">
              /commission
            </Link>{" "}
            instead: paste its address and say in plain words what should change.
          </p>
        </section>

        <section id="dispatch" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">6. Give an existing project work</h2>
          <p>
            For a project that already has a repository, set <strong>Runs on</strong> in Control →
            the project&apos;s profile: Cloud builder if your account has it, or This computer. Then
            pick the project in Control, write what you want done, and send it. If that builder is
            offline, the request waits in the queue until it is back.
          </p>
          <p>
            To work in a session yourself, open Terminal and choose Cloud builder or Your computer.
            That choice does not change where the project&apos;s own work runs.
          </p>
        </section>

        <section id="watch" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">7. Watch from anywhere</h2>
          <p>
            The same dashboard works on your phone while an agent runs. On a project, press{" "}
            <em>Watch it work</em> to follow the run as a readable thread: what the agent was asked,
            the steps it takes, and what it hands back. Control shows where every project stands,
            and Terminal shows the live session if you want to step in.
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
              — how Loki works underneath, in more depth.
            </li>
          </ul>
        </section>
      </main>
    </PublicSurface>
  );
}
