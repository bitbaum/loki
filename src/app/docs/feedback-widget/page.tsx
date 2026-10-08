import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

export const metadata = {
  title: "Feedback widget",
  description:
    "Put a feedback button on any site you run. Reports land in your inbox, one click hands them to an agent, and the person who reported hears back when the fix ships.",
};

export default function FeedbackWidgetDocsPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-prose mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <h1 className="ui-public-title mb-2">Feedback widget</h1>
        <p className="ui-public-meta mb-8 sm:mb-12">
          One line of code on any site you run. What visitors report becomes work you can hand to an
          agent, and they hear back when it is fixed.
        </p>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">1. Turn it on for a project</h2>
          <p>
            Open the project in Loki, find its feedback section and press{" "}
            <strong>Widget setup</strong>. Then choose <strong>Enable &amp; install</strong>, which
            creates the project&apos;s key and asks an agent to add the line to your site, or{" "}
            <strong>Enable only</strong> if you will add it yourself. Next.js sites started from
            Loki&apos;s starter already have it.
          </p>
          <pre className="ui-public-code-block ui-public-code-pre">
            <code>{`<script src="https://loki.orangecat.ch/widget.js"
        data-fc-project="fcw_…" async></script>`}</code>
          </pre>
          <p>
            The key in that line is public on purpose and can only <strong>send</strong>: it files
            feedback for this one project and can read nothing. Only your project&apos;s own web
            address may use it; reports sent from anywhere else are turned away.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">2. Install it — two ways</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Copy snippet</strong> — paste the line into your site&apos;s main template,
              before <code>&lt;/body&gt;</code>. It works with any framework.
            </li>
            <li>
              <strong>Install via agent</strong> — for projects with a repository, an agent adds the
              line to your code, checks the page still loads, and ships it the way your project
              ships changes. It will not add a second copy if one is already there.{" "}
              <strong>Remove via agent</strong> takes it out again.
            </li>
          </ul>
        </section>

        <section id="placement" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">3. Where the button sits</h2>
          <p>
            Nothing to set up in the usual case. The button looks for a free corner each time the
            page loads, scrolls or changes, and stays off anything a visitor could click — your
            links, buttons, form fields, chat bubbles and bottom bars. If every spot is taken, it
            hides until there is room, because a button that steals a click is worse than none.
          </p>
          <p>For the cases it cannot see, mark your page:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <code>data-fc-avoid</code> on any element — the button never covers it.
            </li>
            <li>
              <code>data-fc-place=&quot;left&quot;</code> or <code>&quot;right&quot;</code> on{" "}
              <code>&lt;html&gt;</code> or on part of a page — keep the button on that side.
            </li>
            <li>
              <code>data-fc-place=&quot;hidden&quot;</code> — no button while that part of the page
              is showing, for example on a checkout or a full-screen editor.
            </li>
          </ul>
          <p>
            The older <code>data-fc-bottom=&quot;88&quot;</code> on the script line still works and
            lifts the button by that many pixels.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">4. What visitors get</h2>
          <p>
            A small button on every page. Opening it, the visitor picks what they mean —{" "}
            <em>Element</em> (they click the exact thing that is wrong, and the widget notes which
            one), <em>This page</em>, or <em>Whole site</em> — writes what should be better, can add
            a picture (it is shrunk in their browser, so a phone photo never uploads megabytes), and
            can leave a name or email. The widget is sealed off from your page, so your styles and
            its styles cannot interfere.
          </p>
          <p>
            The same complaint sent twice does not pile up: it adds to a counter on the existing
            report (shown as <em>×N</em>), so you still see how many people hit it.
          </p>
          <p>
            Visitors can <strong>speak instead of typing</strong> — useful on a phone. What they say
            appears as text they can edit, and they still press Send.
          </p>
          <p>
            <strong>One conversation with Loki.</strong> Most people you build a site for are not
            web professionals and cannot tell a mistake from a convention. In the panel they simply
            talk to Loki — about the page, the whole site, or an element they point at — and get an
            honest second opinion that may well be &ldquo;leave it&rdquo;. Every change Loki
            suggests, and their own message as written, has <em>Send to builder</em>, which becomes
            an ordinary report; the receipt and a tracking link land in the same conversation, which
            survives their page loads. Loki reads an outline of the page — headings, words, links,
            buttons — not a picture of it, and says so. Answers are charged to your AI budget.{" "}
            <code>data-fc-modes=&quot;report&quot;</code> on the script line turns the answers off.
          </p>
          <p>
            <strong>Watch</strong> is in the panel&rsquo;s header. On your own site, tap it and sign
            in with Loki: you come straight back with Loki watching how you use the page, fixing
            what breaks, and on <em>Review</em> saying what to improve. Visitors are never watched.
          </p>
          <p>
            <strong>A studio front desk</strong> instead of site advice: with{" "}
            <code>data-fc-modes=&quot;chat&quot;</code> the Cat and Loki point visitors to the right
            project.
          </p>
          <p>
            <strong>Visitors can hide it.</strong> <em>Hide this button on this site</em> at the
            foot of the panel hides it for that visitor only, with an Undo. Opening any page with{" "}
            <code>#loki</code> at the end of the address brings it back.
          </p>
          <p>
            <strong>Visitors can follow their report.</strong> Someone who signs in to Loki sees
            every report they have sent, and where its fix stands, on{" "}
            <Link href="/my-feedback" className="ui-public-link">
              My feedback
            </Link>
            .
          </p>
          <p className="ui-public-callout">
            <strong>The microphone needs your site&apos;s permission.</strong> If your site sends a{" "}
            <code>Permissions-Policy</code> header with <code>microphone=()</code> — which several
            security presets do by default — browsers block the microphone everywhere on your site
            and never ask. The widget notices and does not show the button, rather than one that can
            only fail. To allow it, send <code>Permissions-Policy: microphone=(self)</code>.
            Everything else works either way.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">5. Change it without redeploying</h2>
          <p>
            The line on your site only points at Loki; everything else is decided on Loki&apos;s
            side. Each time a page loads, the widget asks Loki whether to show itself, and that same
            call tells Loki the widget is really running:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              The setup card only says the widget is running on your site once that call has
              actually arrived from it — not just because the line is in your code.
            </li>
            <li>
              <strong>Pause / Resume</strong> hides or shows the widget on your site within about 30
              seconds, without touching your code.
            </li>
            <li>
              <strong>Rotate</strong> makes a new key (the old line stops working);{" "}
              <strong>Disable</strong> switches it off for good.
            </li>
          </ul>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">6. From report to fix</h2>
          <p>
            Reports land in the project&apos;s inbox and in{" "}
            <Link href="/feedback" className="ui-public-link">
              Feedback
            </Link>{" "}
            (after you sign in), which shows every project&apos;s reports in one list and what stage
            each fix is at. On the project you have:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Implement</strong> — one report becomes one agent run, on whichever builder
              the project runs on. You do not pick a terminal.
            </li>
            <li>
              <strong>Implement all as one</strong> (two or more new reports) — one agent run that
              covers the whole pile, when you want a single fix now.
            </li>
            <li>
              <strong>Synthesize</strong> (three or more new reports) — an agent groups them into a
              few clear briefs, filed back into the same inbox, which you then implement. Nothing
              does this on a schedule; it runs when you press it.
            </li>
            <li>
              <strong>AI review</strong> — an agent opens a page of your site in a browser, at
              desktop and phone size, and files what it finds into the same inbox.
            </li>
          </ul>
        </section>

        <section id="owner-notes" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">7. Your own notes start the work</h2>
          <p>
            When you open your site from the project in Loki, the widget knows it is you. A note you
            leave that way starts an agent on it straight away, with no second click — say what to
            change and it gets built. To keep a leaked link from running up costs, this is capped at
            40 a day per project; past that, notes wait in Loki for you to start them.
          </p>
          <p>
            <strong>What a visitor writes never runs by itself.</strong> Their text could say
            anything, so it reaches an agent only after you press Implement. That click is a safety
            boundary, not a formality.
          </p>
        </section>

        <section className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">8. You close the loop</h2>
          <p>
            Every report remembers the run that worked on it, so you can see what shipped against
            it. Once a fix is out, <strong>Watch the fix</strong> opens your page and tells the
            story of the change in about a minute: the report and the screenshot that came with it,
            what was actually wrong, the change shown live with a pointer, why it was done that way,
            what else was considered, and who it helps. Back, Pause and Next set the pace. If a step
            cannot be shown, it says so and files that back into your inbox, so a fix that did not
            really land comes back to you. The person who reported it gets their own shorter version
            on their feedback page: their words, the change shown live, and one plain sentence about
            what changed for them, without the technical reasoning. <strong>Share</strong> gives you
            a link for anyone else: it opens the live site and plays the same walkthrough there in
            plain words, without the reasoning, the pull request or the reporter&apos;s screenshot.
          </p>
          <p>
            Marking a report resolved is your call — a finished run is not proof the problem went
            away. When you do, any visitor who left an email gets a short note that their feedback
            shipped. People who hear back report again; that is the point.
          </p>
        </section>

        <section id="security" className="mb-10 space-y-4 sm:mb-12">
          <h2 className="ui-public-prose-h2">Security model</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              The key can only send feedback for one project; reading anything needs your sign-in.
            </li>
            <li>Only your project&apos;s own address may use the key; sending is rate-limited.</li>
            <li>Pause, rotate and disable take effect on your site without a deploy.</li>
            <li>
              Visitor text reaches an agent only after you click. Only your own notes, left while
              signed in as the owner, start work by themselves — at most 40 a day per project.
            </li>
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
