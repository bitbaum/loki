"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronRight,
  Loader2,
  MessageCircle,
  TerminalSquare,
  X,
} from "lucide-react";
import { Composer } from "@/components/composer/Composer";
import type { Attachment } from "@/components/loki/types";
import { AnswerActions } from "@/components/loki/AnswerActions";
import { MarkdownText } from "@/components/ui/markdown-text";
import { useClaudeTranscript } from "@/hooks/use-claude-transcript";
import {
  describeToolRun,
  describeToolStep,
  groupTranscript,
  turnElapsedLabel,
  looksBlockedOnApproval,
  type TranscriptBlock,
  type TranscriptItem,
} from "@/lib/claude-transcript";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { postJson } from "@/lib/api/fetch";
import { suggestFromReply } from "@/lib/terminal-suggestions";
import { mergeSteps } from "@/lib/terminal-next-steps";
import { useAiNextSteps } from "@/hooks/use-ai-next-steps";
import { SuggestionChips } from "./SuggestionChips";

/** Bracketed paste: newlines stay inside the message instead of submitting it. */
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const ENTER = "\r";
const ESC = "\x1b";
/** Claude Code's TUI needs a beat between a paste and the Enter that sends it. */
const SUBMIT_DELAY_MS = 150;
/** No frame after this long → say so, and offer the raw terminal. */
const SILENCE_HINT_MS = 8000;
const FOLLOW_THRESHOLD_PX = 120;

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

/**
 * The live Claude Code session as a conversation — the same session the
 * terminal view shows, read from Claude Code's own log instead of its screen.
 *
 * Built to be the place you work all day from a phone: your messages as
 * bubbles, Claude's answers as readable text, every run of tool calls folded
 * into one tappable line, and Claude's permission questions answered with
 * buttons rather than by reading a TUI and pressing digits. Typing goes into
 * the very same PTY (as a bracketed paste, so newlines do not send early);
 * the raw terminal stays one tap away.
 */
export function ClaudeChatView({
  tab,
  channel,
  onKey,
  onShowTerminal,
  onUnavailable,
}: {
  tab: string;
  channel: BuilderChannel;
  /** Write raw bytes into the session's PTY (TerminalSurface's sendKey).
   *  Resolves once the bytes have left, so Enter can follow a long paste. */
  onKey: (bytes: string) => void | Promise<void>;
  onShowTerminal: () => void;
  /** The builder is connected but never sends this session's conversation
   *  (an older Fleet Runner). The caller shows the terminal instead — a
   *  screen explaining runner versions is a dead end, not a view. */
  onUnavailable?: () => void;
}) {
  const { items, connected, received, sessionId } = useClaudeTranscript(tab, channel);
  const blocks = groupTranscript(items);
  const last = items[items.length - 1];
  const maybeWaiting = looksBlockedOnApproval(items);
  // Working: the last thing in the log is yours (Claude has not answered yet)
  // or a tool still running. Drives Stop in the send slot.
  const working = !!last && (last.kind === "user" || maybeWaiting);
  // The draft, so the send slot can be Stop while the box is empty and Send
  // once you type — a message written mid-run is QUEUED by Claude Code, the
  // way the Claude app lets you line up the next thing while it works.
  const [draft, setDraft] = useState("");
  const liveStatus = !working ? null : last?.kind === "tool" ? describeToolRun([last]) : "Thinking";
  // Claude has finished and is waiting for you: its last reply says what it
  // is waiting on, so the next step is one tap. The rules answer at once; the
  // fast model reads the whole reply and its steps lead once they arrive.
  const reply = last?.kind === "assistant" ? last.text : null;
  const aiSteps = useAiNextSteps(reply, "reply", tab);
  const suggestions = reply && !draft.trim() ? mergeSteps(aiSteps, suggestFromReply(reply)) : [];
  // How long this turn has been going, from your last message — the Claude
  // app's "✳ 13 s". A run with no clock reads the same at second 2 and
  // minute 20, which is how a stuck turn hides.
  const turnStart = working
    ? ([...items].reverse().find((i) => i.kind === "user")?.at ?? null)
    : null;
  const now = useSecondTick(turnStart !== null);
  const elapsed = turnElapsedLabel(turnStart, now);

  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (received) return;
    const t = window.setTimeout(() => setSilent(true), SILENCE_HINT_MS);
    return () => window.clearTimeout(t);
  }, [received]);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  });
  useEffect(() => {
    if (silent && connected && !received) onUnavailableRef.current?.();
  }, [silent, connected, received]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX);
  };
  useLayoutEffect(() => {
    if (following) endRef.current?.scrollIntoView({ block: "end" });
  }, [items, following]);

  const [sendError, setSendError] = useState<string | null>(null);
  const send = async (text: string, attachments: Attachment[]): Promise<boolean> => {
    setSendError(null);
    if (attachments.length > 0) {
      // A screenshot cannot ride the keystroke lane: it goes as an inject the
      // runner turns into files, so Claude opens the image itself
      // (api/control/chat-send, lib/agent-attachments).
      try {
        const res = await postJson("/api/control/chat-send", { tab, text, attachments, channel });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: unknown };
          setSendError(
            typeof data.error === "string"
              ? data.error
              : `Could not send the screenshot (HTTP ${res.status}).`,
          );
          return false;
        }
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "Could not send the screenshot.");
        return false;
      }
      setFollowing(true);
      return true;
    }
    await onKey(`${PASTE_START}${text}${PASTE_END}`);
    window.setTimeout(() => void onKey(ENTER), SUBMIT_DELAY_MS);
    setFollowing(true);
    return true;
  };

  return (
    <div className="ui-claude-chat">
      <div ref={scrollRef} className="ui-loki-thread" onScroll={onScroll}>
        <div className="ui-loki-thread-inner ui-claude-chat-inner">
          {!received || items.length === 0 ? (
            <ChatEmpty
              received={received}
              silent={silent}
              connected={connected}
              started={sessionId !== null}
              onShowTerminal={onShowTerminal}
            />
          ) : (
            blocks.map((block) => <Block key={blockKey(block)} block={block} />)
          )}
          <div ref={endRef} />
        </div>
      </div>

      {!following && (
        <button
          type="button"
          className="ui-loki-jump"
          onClick={() => {
            setFollowing(true);
            endRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          aria-label="Jump to the latest message"
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      )}

      <div className="ui-claude-chat-dock">
        {maybeWaiting && last?.kind === "tool" && (
          // Claude Code asks before a tool outside its allowlist and logs
          // nothing until answered — so a call with no result MAY be a
          // question on screen. Worded as one, with the keys Claude offers.
          <div className="ui-claude-approve" role="group" aria-label="Answer Claude">
            <p className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              <span className="font-medium text-text-primary">{last.name}</span>{" "}
              {last.summary || "is running"} — waiting for you?
            </p>
            <button type="button" className="ui-claude-approve-yes" onClick={() => onKey("1")}>
              <Check className="h-4 w-4" aria-hidden /> Allow
            </button>
            <button type="button" className="ui-claude-approve-btn" onClick={() => onKey("2")}>
              Always
            </button>
            <button
              type="button"
              className="ui-claude-approve-btn"
              onClick={() => onKey(ESC)}
              aria-label="Deny"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        {liveStatus && !maybeWaiting && (
          <p className="ui-claude-live" role="status" aria-live="polite">
            <span className="ui-claude-live-mark" aria-hidden>
              ✳
            </span>
            <span className="min-w-0 truncate">{liveStatus}…</span>
            {elapsed && <span className="ui-claude-live-time">{elapsed}</span>}
          </p>
        )}
        <Composer
          value={draft}
          onValueChange={setDraft}
          onSend={(text, _choice, attachments) => send(text, attachments)}
          placeholder={working ? "Queue a message…" : "Message Claude…"}
          ariaLabel={`Message Claude in ${tab}`}
          attachmentOnlyText="Look at the attached screenshot and fix what is wrong."
          header={
            sendError || suggestions.length > 0 ? (
              <>
                <SuggestionChips
                  suggestions={suggestions}
                  onPick={(prompt) => void send(prompt, [])}
                />
                {sendError && <p className="ui-error">{sendError}</p>}
              </>
            ) : undefined
          }
          sending={working && !draft.trim()}
          // Stop = Esc, exactly what interrupting Claude Code takes.
          onStop={() => onKey(ESC)}
        />
      </div>
    </div>
  );
}

/**
 * Before the first message, the screen names the one state it is in, and the
 * composer below stays live in every one of them — typing reaches the session
 * whether or not the conversation view can read it back.
 *
 * "No conversation yet" used to cover three different facts: the runner has
 * not answered (old runner, or nothing running), Claude is open but has not
 * written a log, and the session is simply empty. They need different next
 * steps, so they get different words.
 */
function ChatEmpty({
  received,
  silent,
  connected,
  started,
  onShowTerminal,
}: {
  received: boolean;
  silent: boolean;
  connected: boolean;
  started: boolean;
  onShowTerminal: () => void;
}) {
  if (!received && !silent) {
    return (
      <div className="ui-claude-chat-empty" role="status">
        <Loader2 className="ui-spinner h-5 w-5 text-text-muted" aria-hidden />
      </div>
    );
  }
  const [title, body] = received
    ? started
      ? ["Nothing said yet", "Write the first message below — it goes straight to Claude."]
      : [
          "Claude hasn't started here yet",
          "Write below to begin. If the agent in this session is not Claude, the terminal shows it.",
        ]
    : connected
      ? // Only seen by a caller that does not take onUnavailable; the
        // terminal surface switches to the terminal instead.
        ["Showing the terminal instead", "This builder does not send the conversation view."]
      : ["Reconnecting…", "Lost the connection to the builder. Trying again."];
  return (
    <div className="ui-claude-chat-empty" role="status">
      <MessageCircle className="h-6 w-6 text-text-muted" aria-hidden />
      <p className="text-base font-medium text-text-primary">{title}</p>
      <p className="max-w-xs text-center text-sm text-text-tertiary">{body}</p>
      {(!received || !started) && (
        <button type="button" className="ui-btn-secondary ui-btn-sm" onClick={onShowTerminal}>
          <TerminalSquare className="h-4 w-4" aria-hidden /> Open the terminal
        </button>
      )}
    </div>
  );
}

function blockKey(block: TranscriptBlock): string {
  return block.type === "message" ? block.item.id : `tools:${block.id}`;
}

function Block({ block }: { block: TranscriptBlock }) {
  if (block.type === "tools") return <ToolRun tools={block.items} />;
  const { item } = block;
  if (item.kind === "user") {
    return (
      <div className="ui-loki-turn-user">
        <div className="ui-loki-bubble ui-loki-bubble-user">{item.text}</div>
      </div>
    );
  }
  return (
    <div className="ui-loki-turn group/turn">
      <div className="ui-loki-answer">
        <MarkdownText text={item.text} className="space-y-2" />
      </div>
      <AnswerActions text={item.text} />
    </div>
  );
}

/** Now, refreshed every second while `on` — for the turn clock. */
function useSecondTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

/** A folded run of tool calls: one line, tap to see each call and its result.
 *  A single call names itself — "Ran" + the command — instead of a count. */
function ToolRun({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => t.status === "running");
  const failed = tools.some((t) => t.status === "error");
  const step = tools.length === 1 ? describeToolStep(tools[0]) : null;
  return (
    <div className="ui-claude-tools">
      <button
        type="button"
        className="ui-claude-tools-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {running && <Loader2 className="ui-spinner h-3.5 w-3.5 shrink-0" aria-hidden />}
        {step && step.target ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0">{step.verb}</span>
            <span className="min-w-0 truncate font-mono text-text-tertiary">{step.target}</span>
          </span>
        ) : (
          <span className="min-w-0 truncate">{describeToolRun(tools)}</span>
        )}
        {failed && <span className="ui-claude-tools-failed">failed</span>}
        <ChevronRight
          className={
            open
              ? "h-4 w-4 shrink-0 rotate-90 transition-transform"
              : "h-4 w-4 shrink-0 transition-transform"
          }
          aria-hidden
        />
      </button>
      {open && (
        <ul className="ui-claude-tools-list">
          {tools.map((t) => (
            <ToolRow key={t.id} tool={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="ui-claude-tool"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!tool.result}
      >
        <span className={`ui-claude-tool-dot ui-claude-tool-${tool.status}`} aria-hidden />
        <span className="shrink-0 font-medium text-text-secondary">{tool.name}</span>
        <span className="min-w-0 truncate font-mono text-text-tertiary">{tool.summary}</span>
      </button>
      {open && tool.result && <pre className="ui-claude-tool-result">{tool.result}</pre>}
    </li>
  );
}
