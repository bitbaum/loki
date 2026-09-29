"use client";

/**
 * The message pieces of Watch it work, drawn the way people already read an
 * AI chat (Claude, ChatGPT, Grok): what YOU asked sits on the right in a soft
 * bubble; Loki and the agent answer on the left as plain text under a small
 * name — no card per line, no borders fighting each other. Mechanical hops
 * fold into one quiet "activity" line you can open, the way a chat app folds
 * tool calls. The first version drew every line as a bordered card and read
 * as a form, not a conversation (George, 2026-09-29).
 */

import { useState } from "react";
import { Bot, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/dates";
import type { WatchItem } from "@/lib/project-watch";

export function UserMessage({ text, at }: { text: string; at: string }) {
  const [open, setOpen] = useState(false);
  // Collapsed, show the first paragraph whole rather than clamping mid-way
  // through a blank line (which drew a lone "…").
  const firstPara = text.split(/\n\s*\n/)[0] ?? text;
  const long = text.length > 320 || firstPara.length < text.length;
  const shown = long && !open ? firstPara : text;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="ui-chat-user">
        <p className={cn("whitespace-pre-wrap wrap-anywhere", long && !open && "line-clamp-5")}>
          {shown}
        </p>
        {long && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="ui-chat-more">
            {open ? "Show less" : "Show all"}
          </button>
        )}
      </div>
      <span className="ui-chat-meta pr-1">You · {timeAgo(new Date(at).getTime())}</span>
    </div>
  );
}

export function AssistantMessage({
  who,
  at,
  agent = false,
  children,
}: {
  who: string;
  at?: string | null;
  /** The coding agent speaking, rather than Loki narrating. */
  agent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className={agent ? "ui-chat-avatar-agent" : "ui-chat-avatar"} aria-hidden="true">
        {agent ? <Bot className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="ui-chat-meta">
          <span className="font-medium text-text-secondary">{who}</span>
          {at && <> · {timeAgo(new Date(at).getTime())}</>}
        </p>
        <div className="ui-chat-body">{children}</div>
      </div>
    </div>
  );
}

type Step = Extract<WatchItem, { type: "step" }>;

/** Every mechanical hop, folded into one line — open it for the detail. */
export function ActivityGroup({
  steps,
  live,
  summary,
}: {
  steps: Step[];
  live: boolean;
  summary: string;
}) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="pl-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ui-chat-activity"
      >
        {live && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />}
        <span className="truncate">{summary}</span>
        <span className="shrink-0 text-text-muted">
          · {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 border-l border-border-subtle pl-3">
          {steps.map((s, i) => (
            <li key={`${s.kind}-${s.at}-${i}`} className="text-xs leading-relaxed">
              <span
                className={s.tone === "warning" ? "text-status-warning" : "text-text-secondary"}
              >
                {s.text}
              </span>
              <span className="ml-2 text-text-muted">{timeAgo(new Date(s.at).getTime())}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The agent's raw screen, folded — the live line above already says what it
 * is doing; this is for the person who wants to see it for themselves.
 */
export function ScreenFold({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ui-chat-link"
      >
        {open ? "Hide screen" : "Show screen"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && <pre className="ui-watch-tail">{lines.join("\n")}</pre>}
    </div>
  );
}

/** Three breathing dots — the universal "it is typing" signal. */
export function TypingDots() {
  return (
    <span className="ui-chat-typing" aria-label="Working">
      <span />
      <span />
      <span />
    </span>
  );
}
