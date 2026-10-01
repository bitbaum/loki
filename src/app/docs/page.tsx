import Link from "next/link";
import { BookOpen, Download, MessageSquare, Network, ShieldCheck } from "lucide-react";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { PublicSurface } from "@/components/public/PublicSurface";

export const metadata = {
  title: "Documentation",
  description:
    "Start with Loki: create an account, choose where agents run, and turn an idea into a project.",
};

const guides = [
  {
    title: "Quickstart",
    body: "From a new account to an idea turned into a repository and a site.",
    href: "/docs/quickstart",
    icon: BookOpen,
  },
  {
    title: "Install Fleet Runner",
    body: "The desktop app that lets agents work on your own computer. Linux, Windows and Apple Silicon Macs.",
    href: "/download",
    icon: Download,
  },
  {
    title: "Feedback widget",
    body: "Put a feedback button on any site you run — what visitors report becomes work for an agent.",
    href: "/docs/feedback-widget",
    icon: MessageSquare,
  },
  {
    title: "How Loki works",
    body: "The whitepaper: where agents run, how work is handed over, and what needs your approval.",
    href: "/whitepaper",
    icon: Network,
  },
  {
    title: "What runs without you",
    body: "What a visitor can and cannot set off, and how to pause or revoke the widget.",
    href: "/docs/feedback-widget#security",
    icon: ShieldCheck,
  },
] as const;

export default function DocsPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container-wide py-12 sm:py-20 lg:py-28">
        <div className="ui-public-eyebrow">Documentation</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">Build with agents you supervise</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          Start with one project and one agent. Agents run on Loki&apos;s cloud builder if your
          account has it, or on your own computer with the Fleet Runner app. Planning, handing out
          work, checking it and approving it all happen in one place.
        </p>
        <div className="ui-public-section-gap grid gap-3 sm:grid-cols-2 sm:gap-4">
          {guides.map(({ title, body, href, icon: Icon }) => (
            /* Icon and title share a row on a phone: stacked, the 20px glyph
               cost a whole line of height per card across five cards. */
            <Link key={href} href={href} className="ui-public-surface-card !min-h-0">
              <div className="flex items-center gap-3 sm:block">
                <Icon className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
                <h2 className="ui-public-prose-strong text-lg sm:mt-5">{title}</h2>
              </div>
              <p className="ui-public-surface-card-body">{body}</p>
              <span className="ui-public-link mt-4 inline-block sm:mt-5">Open guide →</span>
            </Link>
          ))}
        </div>
      </main>
    </PublicSurface>
  );
}
