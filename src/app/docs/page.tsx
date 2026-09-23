import Link from "next/link";
import { BookOpen, Download, MessageSquare, Network, ShieldCheck } from "lucide-react";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { PublicSurface } from "@/components/public/PublicSurface";

export const metadata = {
  title: "Documentation",
  description: "Install Loki, connect a runner, and operate agents safely.",
};

const guides = [
  {
    title: "Quickstart",
    body: "Go from a new account to your first supervised agent dispatch.",
    href: "/docs/quickstart",
    icon: BookOpen,
  },
  {
    title: "Install Fleet Runner",
    body: "Use the Cloud builder when available, or connect Fleet Runner for work on your computer.",
    href: "/download",
    icon: Download,
  },
  {
    title: "Feedback widget",
    body: "Put a feedback button on any site you run — reports become dispatchable fleet work.",
    href: "/docs/feedback-widget",
    icon: MessageSquare,
  },
  {
    title: "Architecture",
    body: "Understand cloud and local execution, handoffs, and the approval boundary.",
    href: "/whitepaper",
    icon: Network,
  },
  {
    title: "Operating safely",
    body: "Keep humans in control while Loki plans and agents execute scoped work.",
    href: "/philosophy",
    icon: ShieldCheck,
  },
] as const;

export default function DocsPage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container-wide py-12 sm:py-20 lg:py-28">
        <div className="ui-public-eyebrow">Documentation</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">Build with a supervised agent fleet</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          Start with one project and one agent. Eligible accounts can use the Cloud builder; Fleet
          Runner is optional when work should run on your computer. Loki keeps planning, dispatch,
          handoffs, and human approval in one operating loop.
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
