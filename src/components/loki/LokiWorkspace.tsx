"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PanelLeft, SquarePen } from "lucide-react";
import { getJson, postJson, deleteJson, throwApiError } from "@/lib/api/fetch";
import { useLokiStream } from "@/hooks/use-loki-stream";
import { resolveLokiProjectSelection } from "@/lib/loki/project-selection";
import { rememberFleetProject } from "@/lib/fleet-context";
import { deriveExecutorHonestyLabel } from "@/lib/executor-honesty";
import { useBuilderPresence } from "@/hooks/use-builder-presence";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { Drawer } from "@/components/ui/modal";
import { ThreadRail } from "./ThreadRail";
import { StartScreen } from "./StartScreen";
import { Thread } from "./Thread";
import { LokiComposer } from "./Composer";
import { SaveContextBar } from "./SaveContextBar";
import { ProjectFilter } from "./ProjectFilter";
import type {
  Attachment,
  ConversationSummary,
  LokiMessage,
  LokiProject,
  ModelChoice,
} from "./types";
import { LOKI_PREFILL_EVENT } from "@/lib/client-events";

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

  const [activeId, setActiveId] = useState<string | null>(null);
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
  if (!selectionInitialized && !projectsLoading && projects.length > 0) {
    // Only honor an explicit ?project= — a fresh /loki visit is the start
    // page (new / open / what needs me). Remembered scope still writes so
    // Control and Terminal keep the last project.
    const requested = searchParams.get("project");
    const fromUrl = resolveLokiProjectSelection(projects, requested);
    if (fromUrl.length > 0) setSelectedProjects(fromUrl);
    setSelectionInitialized(true);
  }

  useEffect(() => {
    if (!selectionInitialized) return;
    const project = selectedProjects.length === 1 ? selectedProjects[0] : null;
    rememberFleetProject(project);

    const params = new URLSearchParams(searchParams.toString());
    const current = params.get("project")?.trim() || null;
    if (current === project) return;
    if (project) params.set("project", project);
    else params.delete("project");
    const query = params.toString();
    router.replace(query ? `/loki?${query}` : "/loki", { scroll: false });
  }, [router, searchParams, selectedProjects, selectionInitialized]);

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
        if (current) setError("Could not load this conversation.");
      })
      .finally(() => {
        if (current) setTranscriptLoading(false);
      });
    return () => {
      current = false;
    };
  }, [activeId, justCreatedId]);

  // A dispatch is a job that finishes after the reply. Its outcome is written
  // back into this thread by the server when the run closes
  // (lib/orchestration/run-outcome-post.ts); while the newest turn is still a
  // dispatch, re-read the thread so that outcome shows up without a reload.
  // Stops the moment any later turn exists — the outcome itself ends it.
  const awaitingOutcome =
    activeId !== null && messages.length > 0 && messages[messages.length - 1]?.kind === "dispatch";
  useEffect(() => {
    if (!awaitingOutcome || !activeId) return;
    let current = true;
    const tick = () =>
      getJson<{ messages: LokiMessage[] }>(`/api/conversations/${activeId}`)
        .then((d) => {
          if (current && d.messages.length > messages.length) setMessages(d.messages);
        })
        .catch(() => undefined);
    const timer = window.setInterval(tick, 20_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [awaitingOutcome, activeId, messages.length]);

  /**
   * The persisted turn arriving off the stream.
   *
   * This is the RECORD, not the preview — whatever was streamed while it was
   * being written is replaced by it (see lib/loki/stream.ts). Anything derived
   * from a turn therefore has to happen here, never off a delta.
   */
  const handleMessage = useCallback(
    (message: LokiMessage) => {
      setMessages((prev) => [...prev, message]);

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
      void getJson<{ conversations: ConversationSummary[] }>("/api/conversations")
        .then((d) => setConversations(d.conversations))
        .catch(() => {
          /* keep the existing list on a transient failure */
        });
    },
    [projects],
  );

  const stream = useLokiStream({ onMessage: handleMessage });
  const sending = stream.sending;

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
    // Title is omitted — the create route defaults it (SSOT), and the first
    // message auto-titles the thread server-side.
    const res = await postJson("/api/conversations", {
      projectKeys: selectedProjects,
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
    setConversations((prev) => [conversation, ...prev]);
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

  const send = async (
    text: string,
    choice: ModelChoice = {},
    attachments: Attachment[] = [],
    opts: { selectedProjectsOverride?: string[]; dispatchOnly?: boolean; chatOnly?: boolean } = {},
  ) => {
    const scopedProjects = opts.selectedProjectsOverride ?? selectedProjects;
    const dispatchOnly = opts.dispatchOnly ?? false;
    const chatOnly = opts.chatOnly ?? false;
    setError(null);
    setLastSent({ text, choice });

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
          meta: null,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    await stream.send(`/api/conversations/${convoId}/messages`, {
      text,
      selectedProjects: scopedProjects,
      ...(dispatchOnly ? { dispatchOnly: true } : {}),
      ...(chatOnly ? { chatOnly: true } : {}),
      // Model picker — omitted keys mean "Auto" (walk the whole chain).
      ...(choice.agent ? { agent: choice.agent } : {}),
      ...(choice.model ? { model: choice.model } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
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

  const dispatchWithProject = (projectName: string, pendingText: string) => {
    if (!activeId || !pendingText.trim()) return;
    setSelectedProjects([projectName]);
    void send(pendingText, {}, [], { selectedProjectsOverride: [projectName], dispatchOnly: true });
  };

  // "Just answer" — the way out of a needs-project prompt the operator never
  // asked for. dispatchOnly skips the optimistic bubble (their message is
  // already in the transcript); chatOnly forces the answer path server-side.
  const answerWithoutProject = (pendingText: string) => {
    if (!activeId || !pendingText.trim()) return;
    void send(pendingText, {}, [], {
      selectedProjectsOverride: [],
      dispatchOnly: true,
      chatOnly: true,
    });
  };

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

  const chatBody = (
    <>
      {isStart && (
        <StartScreen
          conversations={conversations}
          railVisible={historyPinned}
          loading={convosLoading}
          onResume={(id) => setActiveId(id)}
          onBrowseAll={() => {
            if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
              setHistoryPinned(true);
              return;
            }
            setHistoryOpen(true);
          }}
        />
      )}

      <Thread
        messages={messages}
        live={stream.live}
        loading={transcriptLoading}
        sending={sending}
        stopped={stream.stopped}
        onStop={stream.stop}
        onPickProject={dispatchWithProject}
        onAnswerAnyway={answerWithoutProject}
        onRetry={lastSent ? retryLast : undefined}
      />

      {messages.length > 0 && (
        <SaveContextBar
          projects={projects}
          messages={messages}
          selectedProject={selectedProjects[0] ?? null}
        />
      )}

      {/* A turn that failed says so where the answer would have been, with the
          way out next to it — not as a detached line above the input. */}
      {(error ?? stream.error) && (
        <div className="ui-loki-error" role="alert">
          <span className="min-w-0 flex-1">{error ?? stream.error}</span>
          {stream.error && lastSent && (
            <button
              type="button"
              className="ui-loki-error-retry"
              onClick={() => {
                stream.clearError();
                retryLast();
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <LokiComposer
        // Re-keyed only on a PREFILL, never on the thread id. Keying on
        // `activeId` remounted the composer the moment a first message created
        // the thread — mid-send — silently resetting the model choice and
        // discarding anything still staged.
        key={composerPrefill ? `prefill:${composerPrefill}` : "composer"}
        defaultText={composerPrefill ?? ""}
        selectedProjects={selectedProjects}
        projectCount={projects.length}
        selectedGoal={selectedGoal}
        onRemoveProject={toggleProject}
        onOpenProjects={() => setFilterOpen(true)}
        disabled={false}
        sending={sending}
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
      loading={convosLoading}
      error={convosError}
      onRetry={() => void reloadConversations()}
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
      onNew={() => {
        startNewConversation();
        setHistoryOpen(false);
      }}
      onDelete={(id) => void deleteConversation(id)}
    />
  );

  // History + project-scope slide-overs back the compact toolbar on phones and
  // keep project inventory out of the primary chat on every breakpoint.
  const drawers = (
    <>
      {historyOpen && (
        <Drawer onClose={() => setHistoryOpen(false)} size="md">
          <div className="flex min-h-0 flex-1 flex-col p-3">{historyList}</div>
        </Drawer>
      )}
      {filterOpen && (
        <Drawer onClose={() => setFilterOpen(false)} size="md">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <ProjectFilter
              projects={projects}
              selected={selectedProjects}
              loading={projectsLoading}
              error={projectsError}
              onRetry={() => void reloadProjects()}
              onToggle={toggleProject}
              onSelectMany={selectManyProjects}
              onClear={clearProjects}
            />
          </div>
        </Drawer>
      )}
    </>
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
        {/*
          ONE control, not four.

          This used to be a "Chats" button and a "New" button sitting above the
          transcript, duplicating the rail that was already on screen and the
          global sidebar above that. The rail itself owns "new chat" now, so
          what is left here is the only thing the rail cannot do: reveal itself.
          It is hidden entirely when the rail is already pinned open on a wide
          screen, because a toggle for something you are looking at is noise.
        */}
        <div className="ui-loki-topbar">
          <button
            type="button"
            className="ui-loki-topbar-btn"
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                window.matchMedia("(min-width: 768px)").matches
              ) {
                setHistoryPinned((open) => !open);
                return;
              }
              setHistoryOpen(true);
            }}
            aria-label={historyPinned ? "Hide chats" : "Show chats"}
            aria-pressed={historyPinned}
          >
            <PanelLeft className="h-4 w-4" aria-hidden />
          </button>
          {/* On a phone the rail is a drawer, so starting a chat has to be
              reachable without opening it first. */}
          <button
            type="button"
            className="ui-loki-topbar-btn md:hidden"
            onClick={startNewConversation}
            aria-label="New chat"
          >
            <SquarePen className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <section
          className={
            isStart ? "ui-loki-stage ui-loki-stage-empty" : "ui-loki-stage ui-loki-stage-chat"
          }
        >
          {chatBody}
        </section>

        {drawers}
      </div>
    </div>
  );
}
