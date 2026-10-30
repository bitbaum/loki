"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ChevronRight, Loader2, MessageCircle, TerminalSquare } from "lucide-react";
import { AnswerActions } from "@/components/loki/AnswerActions";
import { MarkdownText } from "@/components/ui/markdown-text";
import { useClaudeTranscript } from "@/hooks/use-claude-transcript";
import {
  describeToolRun,
  describeToolStep,
  groupTranscript,
  lastConversationItem,
  turnElapsedLabel,
  type TranscriptBlock,
  type TranscriptItem,
} from "@/lib/claude-transcript";
import type { BuilderChannel } from "@/lib/constants/statuses";
import {
  asksForFeedback,
  limitSteps,
  stepLabel,
  suggestFromReply,
} from "@/lib/terminal-suggestions";
import { useAiNextSteps } from "@/hooks/use-ai-next-steps";
import { useStableSteps } from "@/hooks/use-stable-steps";
import { SessionComposer } from "./SessionComposer";
import { ReplySteps } from "./SuggestionChips";
import { SessionInfo, sessionInfoFrom } from "./SessionInfo";
import {
  dispatchMessageDisplay,
  isTranscriptInterruption,
  transcriptActivity,
  toolWasInterrupted,
} from "@/lib/terminal-conversation";

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
  onLive,
  onExplain,
  draft,
  project = null,
}: {
  /** The project's name in Loki — whose records the box can attach. */
  project?: string | null;
  /** "What's going on?" — Loki explains the session (first chip above the box). */
  onExplain?: () => void;
  /** Words for the box from Loki's summary, for the person to check and send. */
  draft?: { text: string; nonce: number } | null;
  onLive?: (state: "live" | "connecting" | "stalled") => void;
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
  useEffect(() => {
    onLive?.(!received ? "connecting" : connected ? "live" : "stalled");
  }, [connected, received, onLive]);
  const blocks = groupTranscript(items);
  const last = lastConversationItem(items);
  const now = useSecondTick(last?.kind === "user" || last?.kind === "tool");
  const activity = transcriptActivity(items, now, connected);
  const working = activity.working;
  const liveStatus = activity.label;
  // Claude has finished and is waiting for you: its last reply says what it
  // is waiting on, so the next step is one tap. The rules answer at once; the
  // fast model reads the whole reply and its steps lead once they arrive.
  const reply = last?.kind === "assistant" ? last.text : null;
  const aiSteps = useAiNextSteps(reply, "reply", tab, "claude");
  const stable = useStableSteps(reply, aiSteps, reply ? suggestFromReply(reply) : []);
  // A usage limit is answered with Claude Code's own commands, not sentences.
  const limited = limitSteps(reply, "claude");
  const suggestions = limited.length > 0 ? limited : stable;
  // A reply row pressed under the answer: sent by the box, the one send path.
  const [sendRequest, setSendRequest] = useState<{ text: string; nonce: number } | null>(null);
  // How long this turn has been going, from your last message — the Claude
  // app's "✳ 13 s". A run with no clock reads the same at second 2 and
  // minute 20, which is how a stuck turn hides.
  const turnStart = working
    ? ([...items].reverse().find((i) => i.kind === "user")?.at ?? null)
    : null;
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

  return (
    <div className="ui-claude-chat" data-fc-place="tab">
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
          {!working && (
            <ReplySteps
              steps={suggestions}
              onPick={(text) => setSendRequest({ text, nonce: Date.now() })}
              label={(s) => stepLabel(s, "claude")}
            />
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
        {liveStatus && (
          <div className="ui-claude-live" role="status" aria-live="polite">
            {working && !activity.quiet && (
              <Loader2 className="ui-spinner h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1">{liveStatus}</span>
            {working && !activity.quiet && elapsed && (
              <span className="ui-claude-live-time">{elapsed}</span>
            )}
            {(activity.quiet || last?.kind === "tool") && (
              <button
                type="button"
                className="ui-btn-ghost ui-tap shrink-0"
                onClick={onShowTerminal}
              >
                View terminal
              </button>
            )}
          </div>
        )}
        {/* THE session box — the same one the terminal view shows, so a
            message is written the same way in either view. A message written
            mid-run is QUEUED by Claude Code; Stop is Esc. */}
        <SessionComposer
          tab={tab}
          channel={channel}
          onKey={onKey}
          live={connected}
          agent="claude"
          agentLabel="Claude"
          project={project}
          sendRequest={sendRequest}
          offerFeedback={asksForFeedback(reply)}
          onExplain={onExplain}
          draft={draft}
          working={working}
          onShowTerminal={onShowTerminal}
          onSent={() => setFollowing(true)}
          tools={
            <SessionInfo {...sessionInfoFrom(items)} tab={tab} channel={channel} onKey={onKey} />
          }
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
        <p className="text-sm text-text-tertiary">Opening the conversation…</p>
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
        ["Showing the terminal instead", "This runner does not send the conversation view."]
      : ["Reconnecting…", "Lost the connection to the runner. Trying again."];
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
  return block.type === "tools" ? `tools:${block.id}` : block.item.id;
}

function Block({ block }: { block: TranscriptBlock }) {
  if (block.type === "tools") return <ToolRun tools={block.items} />;
  if (block.type === "setting")
    return (
      <p className={block.item.value ? "ui-claude-setting" : "ui-claude-setting ui-error"}>
        {block.item.text}
      </p>
    );
  const { item } = block;
  if (item.kind === "user") {
    if (isTranscriptInterruption(item.text))
      return <p className="ui-claude-live">Stopped by you</p>;
    const display = dispatchMessageDisplay(item.text);
    return (
      <div className="ui-loki-turn-user">
        <div className="ui-loki-bubble ui-loki-bubble-user">
          <p className="whitespace-pre-wrap break-words">{display.text}</p>
          {display.details && (
            <details className="ui-bubble-details group/details">
              <summary className="ui-bubble-details-summary">
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-open/details:rotate-90"
                  aria-hidden
                />
                Dispatch details
              </summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {display.details}
              </pre>
            </details>
          )}
        </div>
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
  const failed = tools.some((t) => t.status === "error" && !toolWasInterrupted(t));
  const interrupted = tools.some(toolWasInterrupted);
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
        {interrupted && !failed && <span className="text-xs">stopped</span>}
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
        <span
          className={`ui-claude-tool-dot ui-claude-tool-${toolWasInterrupted(tool) ? "stopped" : tool.status}`}
          aria-hidden
        />
        <span className="shrink-0 font-medium text-text-secondary">{tool.name}</span>
        <span className="min-w-0 truncate font-mono text-text-tertiary">{tool.summary}</span>
      </button>
      {open && tool.result && <pre className="ui-claude-tool-result">{tool.result}</pre>}
    </li>
  );
}
