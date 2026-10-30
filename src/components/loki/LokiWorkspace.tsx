"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatScreen, type Thinking } from "@bitbaum/chatkit/react";
import { getJson, postJson, deleteJson, throwApiError } from "@/lib/api/fetch";
import { useLokiStream } from "@/hooks/use-loki-stream";
import { useNewChat } from "@/hooks/use-new-chat";
import { initialLokiSelection } from "@/lib/loki/project-selection";
import { initialThreadId } from "@/lib/loki/conversation-param";
import { useSendQueue } from "@/hooks/use-send-queue";
import { useDispatchOutcome } from "@/hooks/use-dispatch-outcome";
import { useThreadInbox } from "@/hooks/use-thread-inbox";
import { QueuedMessages } from "./QueuedMessages";
import { TurnError } from "./TurnError";
import { clearLokiDraft, lokiDraftKey } from "@/lib/loki/draft";
import { rememberFleetProject } from "@/lib/fleet-context";
import { deriveExecutorHonestyLabel } from "@/lib/executor-honesty";
import { useBuilderPresence } from "@/hooks/use-builder-presence";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { ThreadRail } from "./ThreadRail";
import { StartScreen } from "./StartScreen";
import { DemoChatNotice, useDemoChat } from "./DemoChatNotice";
import { SiteHandoffCard } from "./SiteHandoffCard";
import { useSiteHandoff } from "@/hooks/use-site-handoff";
import { Thread } from "./Thread";
import { LokiComposer } from "./Composer";
import { SaveContextBar } from "./SaveContextBar";
import { useImmersiveChat } from "@/hooks/use-immersive-chat";
import { useTemporaryChat } from "@/hooks/use-temporary-chat";
import { useMediaQuery } from "@/hooks/use-media-query";
import { WorkspaceChrome, WorkspacePhoneHeader } from "./WorkspaceChrome";
import { WorkspaceDrawers } from "./WorkspaceDrawers";
import { VoiceConversation } from "./VoiceConversation";
import { useVoiceConversation } from "@/hooks/use-voice-conversation";
import type {
  Attachment,
  ConversationSummary,
  LokiMessage,
  LokiProject,
  ModelChoice,
} from "./types";
import { LOKI_PREFILL_EVENT } from "@/lib/client-events";
import { localMessageImages } from "@/lib/loki/message-images";

const REFETCH_TIMEOUT_MS = 15_000;
const HISTORY_PIN_KEY = "loki:history-pinned";
const pinSerialize = (v: boolean) => (v ? "1" : "0");
const pinDeserialize = (raw: string) => raw === "1";

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REFETCH_TIMEOUT_MS);
  try {
    return await getJson<T>(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export type LokiWorkspaceProps = {
  initialProjects?: LokiProject[];
  initialConversations?: ConversationSummary[];
  loadErrors?: { projects?: string | null; conversations?: string | null };
};

/**
 * Client orchestrator for Loki's chat-first surface. History is the only
 * persistent rail; project scope is available on demand from the composer.
 */
type SendOpts = {
  selectedProjectsOverride?: string[];
  dispatchOnly?: boolean;
  chatOnly?: boolean;
  /** Answer on the free chain this once, keys or not. */
  pool?: "free";
};

/**
 * "Just answer" — the way out of a needs-project prompt the operator never
 * asked for. dispatchOnly skips the optimistic bubble (their message is
 * already in the transcript); chatOnly forces the answer path server-side.
 * `pool: "free"`: the same path under a turn the person's own model failed —
 * the same words on the free chain, chosen by them, never silently.
 */
const answerAnywayScope = (pool?: "free"): SendOpts => ({
  selectedProjectsOverride: [],
  dispatchOnly: true,
  chatOnly: true,
  ...(pool ? { pool } : {}),
});

/**
 * A "Build next" suggestion that names a project goes to it (and dispatches).
 * One that names none — a goal, a deadline, a need on OrangeCat — is answered
 * by Loki, who scopes it and hands back the line that starts it. Never scoped
 * by whatever the project filter holds, and never a "which project?" picker
 * for a question nobody asked about a project.
 */
const suggestionScope = (project: string | null): SendOpts =>
  project
    ? { selectedProjectsOverride: [project] }
    : { selectedProjectsOverride: [], chatOnly: true };

export function LokiWorkspace({
  initialProjects,
  initialConversations,
  loadErrors,
}: LokiWorkspaceProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?q= deep-link seeds the composer at mount (initializer); later q changes
  // are mirrored by the guarded render-time adjustment below, not an effect.
  const prefillParam = searchParams.get("q")?.trim() || null;
  const [composerPrefill, setComposerPrefill] = useState<string | null>(prefillParam);
  const [prevPrefillParam, setPrevPrefillParam] = useState(prefillParam);
  if (prefillParam !== prevPrefillParam) {
    setPrevPrefillParam(prefillParam);
    if (prefillParam) setComposerPrefill(prefillParam);
  }

  // ?q= from the widget's "Continue in Loki" is context, not a message.
  const site = useSiteHandoff(composerPrefill);

  const hasInitialProjects = initialProjects !== undefined;
  const hasInitialConvos = initialConversations !== undefined;

  const [conversations, setConversations] = useState<ConversationSummary[]>(
    initialConversations ?? [],
  );
  const [convosLoading, setConvosLoading] = useState(!hasInitialConvos);
  const [convosError, setConvosError] = useState<string | null>(loadErrors?.conversations ?? null);

  const [projects, setProjects] = useState<LokiProject[]>(initialProjects ?? []);
  const [projectsLoading, setProjectsLoading] = useState(!hasInitialProjects);
  const [projectsError, setProjectsError] = useState<string | null>(loadErrors?.projects ?? null);

  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectionInitialized, setSelectionInitialized] = useState(false);

  // The open thread lives in the URL (?c=) beside ?project=, so Back returns to
  // it. In state only, dispatching and then navigating back to /loki landed on
  // an empty composer while the thread's follow-up chips still showed
  // (feedback b8a97aef). A plain sidebar visit carries no ?c= and stays the
  // start page.
  // ?c= names a thread; a ?project= link opens that project's recent thread
  // instead of minting another (lib/loki/conversation-param.ts).
  const [activeId, setActiveId] = useState<string | null>(() =>
    initialThreadId({
      c: searchParams.get("c"),
      project: searchParams.get("project"),
      q: prefillParam,
      conversations: initialConversations,
    }),
  );
  const [messages, setMessages] = useState<LokiMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The text of the last turn sent, so "Try again" can re-send it verbatim. */
  const [lastSent, setLastSent] = useState<{ text: string; choice: ModelChoice } | null>(null);
  // Compact slide-overs keep secondary lists out of the primary chat.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useLocalStorageState(
    HISTORY_PIN_KEY,
    true,
    pinSerialize,
    pinDeserialize,
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const builderPresence = useBuilderPresence();
  const dispatchHonesty = deriveExecutorHonestyLabel({
    runnerConnected: builderPresence.runnerConnected,
    runtimeAvailable: builderPresence.runtimeAvailable,
    presence: builderPresence.builderPresence,
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt ?? "";
      setComposerPrefill(prompt);
    };
    window.addEventListener(LOKI_PREFILL_EVENT, handler);
    return () => window.removeEventListener(LOKI_PREFILL_EVENT, handler);
  }, []);

  // Core fetchers set state only from promise callbacks, so the mount effect
  // can call them without a synchronous setState. The reload* wrappers add the
  // spinner priming for event contexts (retry buttons); on the mount path the
  // loading flags are already true from their initializers.
  const fetchProjects = useCallback(
    () =>
      fetchJson<
        Array<{
          id: string;
          name: string;
          entityProjectId?: string | null;
          topGoal?: LokiProject["topGoal"];
        }>
      >("/api/user-projects")
        .then((rows) => {
          setProjects(
            rows.map((p) => ({
              id: p.id,
              name: p.name,
              entityProjectId: p.entityProjectId ?? null,
              topGoal: p.topGoal ?? null,
            })),
          );
          setProjectsError(null);
        })
        .catch(() => {
          setProjectsError("Could not load projects.");
        })
        .finally(() => {
          setProjectsLoading(false);
        }),
    [],
  );

  const reloadProjects = useCallback(() => {
    setProjectsLoading(true);
    setProjectsError(null);
    return fetchProjects();
  }, [fetchProjects]);

  const fetchConversations = useCallback(
    () =>
      fetchJson<{ conversations: ConversationSummary[] }>("/api/conversations")
        .then((data) => {
          setConversations(data.conversations);
          setConvosError(null);
        })
        .catch(() => {
          setConvosError("Could not load conversations.");
        })
        .finally(() => {
          setConvosLoading(false);
        }),
    [],
  );

  const reloadConversations = useCallback(() => {
    setConvosLoading(true);
    setConvosError(null);
    return fetchConversations();
  }, [fetchConversations]);

  // Initial load — conversations + projects.
  useEffect(() => {
    if (!hasInitialProjects) void fetchProjects();
    if (!hasInitialConvos) void fetchConversations();
  }, [hasInitialConvos, hasInitialProjects, fetchConversations, fetchProjects]);

  // One-shot selection seed once projects have loaded. Pure computation over
  // props/state, so it runs as a guarded render-time adjustment (the
  // selectionInitialized latch guarantees convergence) rather than an effect.
  const seedReady = !selectionInitialized && !projectsLoading && projects.length > 0;
  if (seedReady && !(activeId && convosLoading)) {
    // ?project=, or the open thread's own projects (project-selection.ts).
    const thread = conversations.find((c) => c.id === activeId);
    const fromUrl = initialLokiSelection(projects, searchParams.get("project"), thread);
    if (fromUrl.length > 0) setSelectedProjects(fromUrl);
    setSelectionInitialized(true);
  }

  useEffect(() => {
    if (!selectionInitialized) return;
    const project = selectedProjects.length === 1 ? selectedProjects[0] : null;
    rememberFleetProject(project);

    const params = new URLSearchParams(searchParams.toString());
    const current = params.get("project")?.trim() || null;
    const currentConvo = params.get("c") || null;
    if (current === project && currentConvo === activeId) return;
    if (project) params.set("project", project);
    else params.delete("project");
    if (activeId) params.set("c", activeId);
    else params.delete("c");
    const query = params.toString();
    router.replace(query ? `/loki?${query}` : "/loki", { scroll: false });
  }, [router, searchParams, selectedProjects, selectionInitialized, activeId]);

  /**
   * The thread THIS send just created, which must not be mistaken for a
   * thread switch.
   *
   * State rather than a ref because it is READ during render, by the
   * switch-detection adjustment below. Both writers set it from an event
   * handler and in the same batch as `setActiveId`, so the two always land
   * together and the adjustment never sees a half-applied pair.
   *
   * Sending the first message creates the conversation, which moves `activeId`
   * from null to a real id — indistinguishable, to the logic below, from the
   * operator clicking a different thread in the rail. So it cleared the
   * transcript and refetched: the optimistic question vanished, the pane showed
   * "Loading conversation" over the top of the turn being streamed, and the
   * refetch returned a thread the server has not finished writing (it persists
   * a turn only when the turn completes). The question disappeared and the
   * answer arrived on its own.
   */
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  // Switching conversations clears the transcript and arms the loader in the
  // same render pass (guarded adjustment); the effect below only fetches.
  const [prevActiveId, setPrevActiveId] = useState<string | null>(null);
  if (activeId !== prevActiveId) {
    setPrevActiveId(activeId);
    if (activeId !== justCreatedId) {
      setMessages([]);
      setTranscriptLoading(activeId !== null);
    }
  }

  // Load the active conversation's transcript.
  useEffect(() => {
    if (!activeId) return;
    // A thread we just created already holds exactly what is on screen, plus a
    // turn still being written. Fetching it can only lose information.
    if (activeId === justCreatedId) return;
    let current = true;
    getJson<{ messages: LokiMessage[] }>(`/api/conversations/${activeId}`)
      .then((d) => {
        if (current) setMessages(d.messages);
      })
      .catch(() => {
        // Usually a stale ?c= (deleted thread): land on the start page rather
        // than an empty pane that still claims a thread is open.
        if (!current) return;
        setError("Could not load this conversation.");
        setActiveId(null);
      })
      .finally(() => {
        if (current) setTranscriptLoading(false);
      });
    return () => {
      current = false;
    };
  }, [activeId, justCreatedId]);

  useDispatchOutcome(activeId, messages, setMessages);

  const inbox = useThreadInbox(activeId, transcriptLoading, messages.length, setConversations);

  /**
   * The persisted turn arriving off the stream.
   *
   * This is the RECORD, not the preview — whatever was streamed while it was
   * being written is replaced by it (see lib/loki/stream.ts). Anything derived
   * from a turn therefore has to happen here, never off a delta.
   */
  const handleMessage = useCallback(
    (message: LokiMessage, thinking: Thinking) => {
      setMessages((prev) => [...prev, { ...message, thinking }]);

      // A turn can resolve which project it was about (the model named one, or
      // the command resolver picked one). Follow it, so the composer's scope
      // matches what actually happened.
      const resolved = message.meta
        ? typeof message.meta.projectKey === "string"
          ? [message.meta.projectKey]
          : Array.isArray(message.meta.projectKeys)
            ? message.meta.projectKeys.filter((v): v is string => typeof v === "string")
            : []
        : [];
      const known = resolved.filter((name) => projects.some((p) => p.name === name));
      if (known.length > 0) setSelectedProjects(known);

      // Sync the list so the server's auto-title (derived from the first
      // message) and the recency order appear live, not only after a reload.
      inbox.syncConversations(message.conversationId);
    },
    [projects, inbox],
  );

  const stream = useLokiStream({ onMessage: handleMessage });
  const sending = stream.sending;

  // Typed while a turn ran; sent, in order, when it ends (hooks/use-send-queue).
  const queue = useSendQueue<{
    text: string;
    choice: ModelChoice;
    attachments: Attachment[];
    chatOnly?: boolean;
  }>();

  // Client-side project filter over the full list (deselect = show all).
  const visibleConversations = useMemo(() => {
    if (selectedProjects.length === 0) return conversations;
    const wanted = new Set(selectedProjects);
    // The thread you are IN is never filtered out of the rail.
    //
    // Scope follows the answer — a turn that resolves to a project selects it —
    // so asking a question in a fresh thread could set a scope the thread
    // itself does not carry yet, and the row for the conversation on screen
    // vanished from the list while you were reading it. A filter may narrow
    // what else is offered; it may not hide where you are.
    return conversations.filter(
      (c) => c.id === activeId || c.projectKeys.some((k) => wanted.has(k)),
    );
  }, [conversations, selectedProjects, activeId]);

  const createConversation = async (): Promise<string | null> => {
    const res = await postJson("/api/conversations", {
      projectKeys: selectedProjects,
      ephemeral: temporary.armed,
    });
    if (!res.ok) {
      await throwApiError(res, "Could not create conversation.").catch((e: Error) =>
        setError(e.message),
      );
      return null;
    }
    const { conversation } = (await res.json()) as { conversation: ConversationSummary };
    // Claimed BEFORE setActiveId, so the switch-detection below already knows
    // this id is ours and never clears the transcript we are about to fill.
    setJustCreatedId(conversation.id);
    if (temporary.armed) temporary.claim(conversation.id);
    else setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    setMessages([]);
    return conversation.id;
  };

  const startNewConversation = () => {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setComposerPrefill(null);
  };
  const newChat = useNewChat(startNewConversation, () => setHistoryOpen(false));

  const deleteConversation = async (id: string) => {
    setError(null);
    const res = await deleteJson(`/api/conversations/${id}`);
    if (!res.ok) {
      await throwApiError(res, "Could not delete conversation.").catch((e: Error) =>
        setError(e.message),
      );
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  };

  const demo = useDemoChat();
  const send = async (
    text: string,
    choice: ModelChoice = {},
    attachments: Attachment[] = [],
    opts: SendOpts = {},
  ) => {
    // The public demo answers from DemoChatNotice and calls nothing (config/demo.ts).
    if (demo.isDemo) return demo.show(text);
    const scopedProjects = opts.selectedProjectsOverride ?? selectedProjects;
    const dispatchOnly = opts.dispatchOnly ?? false;
    const chatOnly = opts.chatOnly ?? false;
    if (sending && !dispatchOnly) {
      queue.add({ text, choice, attachments, chatOnly });
      clearLokiDraft(lokiDraftKey(activeId));
      return;
    }
    setError(null);
    setLastSent({ text, choice });
    // The draft is leaving the composer. Clear it under the key it was written
    // in NOW: a first message creates the thread and moves the composer to
    // that thread's key, so the composer's own clear-after-send would miss
    // the start-page draft and the next visit to /loki would offer an
    // already-sent message back.
    clearLokiDraft(lokiDraftKey(activeId));

    // Ensure a thread exists; a fresh page send creates one implicitly.
    const convoId = activeId ?? (await createConversation());
    if (!convoId) return;

    // Optimistic user bubble — skipped when re-dispatching after a project
    // pick, because their message is already in the transcript.
    if (!dispatchOnly) {
      setMessages((prev) => [
        ...prev,
        {
          id: `pending-${Date.now()}`,
          conversationId: convoId,
          role: "user",
          kind: null,
          content: text,
          // The pictures show the moment Send is tapped; the stored copies
          // replace them on the next load of the thread.
          meta: attachments.some((a) => a.kind === "image")
            ? { images: localMessageImages(attachments) }
            : null,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    const landed = await stream.send(`/api/conversations/${convoId}/messages`, {
      text,
      selectedProjects: scopedProjects,
      ...(dispatchOnly ? { dispatchOnly: true } : {}),
      ...(chatOnly ? { chatOnly: true } : {}),
      ...(opts.pool ? { pool: opts.pool } : {}),
      // Model picker — omitted keys mean "Auto" (walk the whole chain).
      ...(choice.agent ? { agent: choice.agent } : {}),
      ...(choice.model ? { model: choice.model } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    // The turn landed: the next queued message goes, through this same
    // function. A failed or stopped turn leaves the queue standing behind the
    // error and its Try again.
    if (landed) {
      const next = queue.takeNext();
      if (next) void send(next.text, next.choice, next.attachments, { chatOnly: next.chatOnly });
    }
  };

  /**
   * Re-ask the last question.
   *
   * The previous answer stays in the thread rather than being replaced: a model
   * that answered badly once is evidence, and silently swapping it would hide
   * that the second answer is a second attempt.
   */
  const retryLast = () => {
    if (!lastSent || sending) return;
    void send(lastSent.text, lastSent.choice, [], { dispatchOnly: true });
  };

  const retryAfterError = () => {
    stream.clearError();
    retryLast();
  };

  const dispatchWithProject = (projectName: string, pendingText: string) => {
    if (!activeId || !pendingText.trim()) return;
    setSelectedProjects([projectName]);
    void send(pendingText, {}, [], { selectedProjectsOverride: [projectName], dispatchOnly: true });
  };

  const answerWithoutProject = (pendingText: string, pool?: "free") => {
    if (!activeId || !pendingText.trim()) return;
    void send(pendingText, {}, [], answerAnywayScope(pool));
  };

  // Hands-free voice chat: what is said is sent like a typed message, and the
  // newest answer is read back. Lives here because it needs both ends — the
  // send path and the transcript.
  const newestAnswer = [...messages].reverse().find((m) => m.role === "assistant");
  const voice = useVoiceConversation({
    onUtterance: (text) => void send(text),
    latestAnswer: newestAnswer ? { id: newestAnswer.id, text: newestAnswer.content } : null,
    turnFailed: !!(error ?? stream.error) || stream.stopped,
  });

  const toggleProject = (name: string) => {
    setSelectedProjects((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
  };
  // One-click multi-target — the fast path for "same task → N projects".
  const selectManyProjects = (names: string[]) =>
    setSelectedProjects((prev) => Array.from(new Set([...prev, ...names])));
  const clearProjects = () => setSelectedProjects([]);

  const selectedGoal =
    selectedProjects.length === 1
      ? (projects.find((project) => project.name === selectedProjects[0])?.topGoal ?? null)
      : null;

  const isStart = messages.length === 0 && !transcriptLoading && !sending && !activeId;
  const temporary = useTemporaryChat(activeId);
  useImmersiveChat(true);
  // The rail is `md:flex`: pinned or not, a phone never shows it (treating
  // "pinned" as "visible" hid the recent chats on every phone).
  const wide = useMediaQuery("(min-width: 768px)");
  // Which thread the menu opened "save to context" for (closes on a switch).
  const [saveFor, setSaveFor] = useState<string | null>(null);
  const activeThread = activeId ? conversations.find((c) => c.id === activeId) : undefined;

  // The thread's controls, shared by the desktop bar and the phone's header.
  const chrome = {
    activeId,
    title: activeThread?.title || "New chat",
    projects: selectedProjects,
    pinned: Boolean(activeThread?.pinnedAt),
    canSaveContext: messages.length > 0,
    onOpenHistory: () => setHistoryOpen(true),
    onNewChat: newChat.start,
    onLeaveThread: startNewConversation,
    temporary: activeId ? temporary.id === activeId : temporary.armed,
    onToggleTemporary: temporary.toggle,
    onOpenProjects: () => setFilterOpen(true),
    onSaveContext: () => setSaveFor(activeId ?? "new"),
    onTogglePin: inbox.pinConversation,
    onRename: inbox.renameConversation,
  };

  const conversation = (
    <>
      {isStart && site.handoff && <SiteHandoffCard handoff={site.handoff} onDismiss={site.spend} />}
      {demo.asked && <DemoChatNotice asked={demo.asked} />}
      {isStart && !site.handoff && !demo.asked && (
        <StartScreen
          conversations={conversations}
          railVisible={historyPinned && wide}
          loading={convosLoading}
          onResume={(id) => setActiveId(id)}
          onBrowseAll={() => (wide ? setHistoryPinned(true) : setHistoryOpen(true))}
          onBuild={(prompt, project) => void send(prompt, {}, [], suggestionScope(project))}
        />
      )}

      <Thread
        conversationId={activeId}
        messages={messages}
        live={stream.live}
        loading={transcriptLoading}
        sending={sending}
        stopped={stream.stopped}
        onStop={stream.stop}
        onPickProject={dispatchWithProject}
        // A finished run's next step goes on in this thread, on its project.
        onContinue={(text, p) => void send(text, {}, [], { selectedProjectsOverride: [p] })}
        onAnswerAnyway={answerWithoutProject}
        onAnswerFree={(text) => answerWithoutProject(text, "free")}
        onRetry={lastSent ? retryLast : undefined}
        // A tapped reply goes on the model the operator last chose, as typing
        // it would — it used to fall back to Auto, so a reply could be answered
        // by a different model than the question it followed.
        onFollowUp={(text) => void send(text, lastSent?.choice)}
        // Inside the scroll, after the last turn: it is an action ON the
        // exchange, and as a fixed row between thread and composer it took a
        // permanent line of a phone screen from the conversation.
        // On a phone it waits in the thread menu until asked for.
        tail={
          messages.length > 0 && (wide || saveFor === (activeId ?? "new")) ? (
            <SaveContextBar
              key={activeId ?? "new"}
              projects={projects}
              messages={messages}
              selectedProject={selectedProjects[0] ?? null}
              defaultOpen={saveFor === (activeId ?? "new")}
            />
          ) : null
        }
      />
    </>
  );

  // Floats over the conversation (ChatScreen): the words scroll under it.
  const dock = (
    <>
      {/* A turn that failed says so where the answer would have been, with the
          way out next to it — not as a detached line above the input. */}
      <TurnError
        message={error ?? stream.error}
        onRetry={stream.error && lastSent ? retryAfterError : undefined}
      />

      <QueuedMessages items={queue.items} onRemove={queue.remove} />

      <VoiceConversation voice={voice} />

      <LokiComposer
        onTalk={() => void voice.start()}
        // Re-keyed only on a PREFILL, never on the thread id. Keying on
        // `activeId` remounted the composer the moment a first message created
        // the thread — mid-send — silently resetting the model choice and
        // discarding anything still staged.
        key={composerPrefill ? `prefill:${composerPrefill}` : "composer"}
        defaultText={site.arrived ? "" : (composerPrefill ?? "")}
        context={site.context}
        onContextUsed={site.spend}
        draftKey={lokiDraftKey(activeId)}
        freshRequest={newChat.fresh}
        selectedProjects={selectedProjects}
        projectCount={projects.length}
        selectedGoal={selectedGoal}
        onRemoveProject={toggleProject}
        onOpenProjects={() => setFilterOpen(true)}
        disabled={false}
        sending={sending}
        queue
        onStop={stream.stop}
        showStarters={isStart}
        dispatchHonesty={dispatchHonesty}
        onSend={(t, choice, attachments, opts) =>
          void send(t, choice, attachments, { chatOnly: opts?.chatOnly })
        }
      />
    </>
  );

  const historyList = (
    <ThreadRail
      conversations={visibleConversations}
      activeId={activeId}
      busyId={sending ? activeId : null}
      loading={convosLoading}
      error={convosError}
      onRetry={() => void reloadConversations()}
      mode={inbox.railMode}
      onModeChange={inbox.setRailMode}
      onPin={inbox.pinConversation}
      onSelect={(id) => {
        // A deliberate switch: release the just-created claim so the transcript
        // is fetched even when they click back into the thread they just made.
        setJustCreatedId(null);
        const convo = conversations.find((c) => c.id === id);
        if (convo && convo.projectKeys.length > 0) {
          const known = convo.projectKeys.filter((k) => projects.some((p) => p.name === k));
          setSelectedProjects(known.length > 0 ? known : convo.projectKeys);
        }
        setActiveId(id);
        setHistoryOpen(false);
      }}
      onNew={newChat.start}
      onDelete={(id) => void deleteConversation(id)}
    />
  );

  return (
    <div
      className={historyPinned ? "ui-loki-workspace ui-loki-workspace-split" : "ui-loki-workspace"}
    >
      {historyPinned && (
        <aside className="ui-loki-history-rail" aria-label="Chats">
          {historyList}
        </aside>
      )}

      <div className="ui-loki-main">
        <WorkspaceChrome
          {...chrome}
          onNewChat={newChat.start}
          historyPinned={historyPinned}
          onToggleHistoryPinned={() => setHistoryPinned((open) => !open)}
        />

        {/* One ChatScreen for the start and the thread alike: the composer
            must not remount when the first message turns one into the other
            (it would drop the model choice and anything staged). */}
        <section
          className={
            isStart ? "ui-loki-stage ui-loki-stage-empty" : "ui-loki-stage ui-loki-stage-screen"
          }
        >
          <ChatScreen
            composer={dock}
            header={wide ? undefined : <WorkspacePhoneHeader start={isStart} {...chrome} />}
          >
            {conversation}
          </ChatScreen>
        </section>

        <WorkspaceDrawers
          historyOpen={historyOpen}
          onCloseHistory={() => setHistoryOpen(false)}
          history={historyList}
          filterOpen={filterOpen}
          onCloseFilter={() => setFilterOpen(false)}
          filter={{
            projects,
            selected: selectedProjects,
            loading: projectsLoading,
            error: projectsError,
            onRetry: () => void reloadProjects(),
            onToggle: toggleProject,
            onSelectMany: selectManyProjects,
            onClear: clearProjects,
          }}
        />
      </div>
    </div>
  );
}
