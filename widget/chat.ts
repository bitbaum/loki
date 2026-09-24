/**
 * Chat mode: talk to Loki (development agent) or Cat (economic agent) on the
 * host page. A conversation surface in the shape people already know from the
 * big chat apps — one agent switcher on top, a centred greeting with starters
 * when empty, the visitor's turns as bubbles, the agent's as plain prose, and
 * one rounded composer pinned to the bottom.
 *
 * What is ours: Loki can hand the whole conversation to Loki Implement as a
 * build brief (the same /api/feedback ingest the Report form uses), and Cat
 * hands off to the visitor's own Cat on OrangeCat for anything that moves
 * money. Nothing here is stored server-side; each turn sends the transcript.
 */
import { h, NEW_CHAT_SVG, SEND_SVG, STOP_SVG } from "./dom";
import {
  clampHistory,
  conversationBrief,
  defaultWidgetAgent,
  handoffHref,
  WIDGET_AGENT_IDS,
  WIDGET_AGENTS,
  type ChatTurn,
  type WidgetAgentId,
} from "./agents";
import { createVoiceControl } from "./voice-control";
import { mergeTranscript } from "./voice";

const MAX_INPUT = 4000;
const BRIEF_MAX = 2000;
/** Control bytes the chat route uses in its text stream. */
const RESET = "\u0000";
const FAILED = "\u0001";

export type ChatView = {
  el: HTMLElement;
  /** Header controls the panel places next to its close button. */
  headerControls: HTMLElement;
  focus(): void;
  /** The panel owns the keyboard (see main.ts onKeydown); it forwards here. */
  handleKey(e: KeyboardEvent): boolean;
  /** Stop a recording or an in-flight answer — the panel is closing. */
  abandon(): void;
};

export function createChat(opts: {
  root: ShadowRoot;
  apiBase: string;
  token: string;
  voiceMaxMs: number;
  /** Where each "link" agent hands off; served by boot. */
  getHandoff(agent: WidgetAgentId): string | null;
}): ChatView {
  const { root, apiBase, token } = opts;
  const transcripts: Record<WidgetAgentId, ChatTurn[]> = { loki: [], cat: [], solon: [] };
  let agent: WidgetAgentId = defaultWidgetAgent();
  let inflight: AbortController | null = null;

  const el = h("div", "chat");

  // ---- agent switcher (header) ----
  const headerControls = h("div", "chat-hdr");
  const switcher = h("div", "agents");
  switcher.setAttribute("role", "tablist");
  switcher.setAttribute("aria-label", "Choose an agent");
  const agentBtns = new Map<WidgetAgentId, HTMLButtonElement>();
  for (const id of WIDGET_AGENT_IDS) {
    const btn = h("button", "agent", WIDGET_AGENTS[id].label);
    btn.setAttribute("role", "tab");
    btn.title = WIDGET_AGENTS[id].role;
    btn.addEventListener("click", () => switchAgent(id));
    agentBtns.set(id, btn);
    switcher.appendChild(btn);
  }
  const newBtn = h("button", "icon-btn");
  newBtn.innerHTML = NEW_CHAT_SVG;
  newBtn.setAttribute("aria-label", "New chat");
  newBtn.title = "New chat";
  newBtn.addEventListener("click", () => {
    stopAnswer();
    transcripts[agent] = [];
    render();
    input.focus();
  });
  headerControls.append(switcher, newBtn);

  // ---- transcript ----
  const scroller = h("div", "thread");
  scroller.setAttribute("aria-live", "polite");

  // ---- composer ----
  const composer = h("div", "composer");
  const input = h("textarea", "composer-input");
  input.rows = 1;
  input.maxLength = MAX_INPUT;
  const tools = h("div", "composer-tools");
  const role = h("span", "composer-role");
  const sendBtn = h("button", "send");
  sendBtn.setAttribute("aria-label", "Send");
  const errEl = h("div", "chat-err");
  const voice = createVoiceControl({
    endpoint: `${apiBase}/api/widget/transcribe`,
    token,
    maxMs: opts.voiceMaxMs,
    compact: true,
    onTranscript: (text) => {
      input.value = mergeTranscript(input.value, text, MAX_INPUT);
      autosize();
      syncSend();
      input.focus();
    },
    onError: (message) => {
      errEl.textContent = message;
    },
  });
  tools.append(role);
  if (voice) tools.append(voice.button);
  tools.append(sendBtn);
  composer.append(input, tools);
  el.append(scroller, errEl, composer);

  input.addEventListener("input", () => {
    autosize();
    syncSend();
  });
  sendBtn.addEventListener("click", () => {
    if (inflight) stopAnswer();
    else void send(input.value);
  });

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }
  function syncSend() {
    sendBtn.replaceChildren();
    const icon = h("span");
    icon.innerHTML = inflight ? STOP_SVG : SEND_SVG;
    sendBtn.append(icon);
    sendBtn.setAttribute("aria-label", inflight ? "Stop" : "Send");
    sendBtn.disabled = !inflight && !input.value.trim();
  }

  function switchAgent(id: WidgetAgentId) {
    if (id === agent) return;
    stopAnswer();
    agent = id;
    errEl.textContent = "";
    render();
    input.focus();
  }

  // ---- rendering ----
  function render() {
    const meta = WIDGET_AGENTS[agent];
    for (const [id, btn] of agentBtns) {
      btn.classList.toggle("on", id === agent);
      btn.setAttribute("aria-selected", id === agent ? "true" : "false");
    }
    input.placeholder = meta.placeholder;
    role.textContent = meta.role;
    scroller.replaceChildren();
    const turns = transcripts[agent];
    if (turns.length === 0) {
      const empty = h("div", "empty");
      empty.append(h("div", "empty-mark", meta.label), h("h2", "greeting", meta.greeting));
      const starters = h("div", "starters");
      for (const s of meta.starters) {
        const b = h("button", "starter", s);
        b.addEventListener("click", () => void send(s));
        starters.appendChild(b);
      }
      empty.appendChild(starters);
      scroller.appendChild(empty);
    } else {
      for (const t of turns) scroller.appendChild(bubble(t));
      const last = turns[turns.length - 1]!;
      if (!inflight && last.role === "assistant") scroller.appendChild(actions());
    }
    syncSend();
    scrollDown();
  }

  function bubble(t: ChatTurn): HTMLElement {
    if (t.role === "user") {
      const row = h("div", "msg user");
      row.appendChild(h("div", "bubble", t.content));
      return row;
    }
    const row = h("div", "msg bot");
    row.appendChild(h("div", "who", WIDGET_AGENTS[agent].label));
    const body = h("div", "prose");
    if (t.content) renderProse(body, t.content);
    else body.appendChild(typing());
    row.appendChild(body);
    return row;
  }

  function typing(): HTMLElement {
    const t = h("span", "typing");
    t.setAttribute("aria-label", "Thinking");
    t.append(h("i"), h("i"), h("i"));
    return t;
  }

  /** The agent's one action on the conversation: Loki builds, Cat and Solon hand off. */
  function actions(): HTMLElement {
    const row = h("div", "next");
    const meta = WIDGET_AGENTS[agent];
    const action = meta.action;
    if (action.kind === "build") {
      const build = h("button", "build", action.label);
      build.addEventListener("click", () => void handToBuild(build, row));
      row.appendChild(build);
    } else {
      const base = opts.getHandoff(agent);
      if (base) {
        const a = h("a", "handoff", action.label) as HTMLAnchorElement;
        a.href = handoffHref(base, action.prefill, transcripts[agent], meta.label);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        row.appendChild(a);
      }
    }
    return row;
  }

  function scrollDown() {
    scroller.scrollTop = scroller.scrollHeight;
  }

  // ---- sending ----
  async function send(raw: string) {
    const text = raw.trim();
    if (!text || inflight) return;
    const turns = transcripts[agent];
    turns.push({ role: "user", content: text });
    const reply: ChatTurn = { role: "assistant", content: "" };
    turns.push(reply);
    input.value = "";
    autosize();
    errEl.textContent = "";
    const controller = new AbortController();
    inflight = controller;
    const forAgent = agent;
    render();
    // Re-render only the live answer as it streams, not the whole thread.
    const liveProse = scroller.querySelector(".msg.bot:last-child .prose") as HTMLElement | null;

    try {
      const res = await fetch(`${apiBase}/api/widget/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          token,
          agent: forAgent,
          messages: clampHistory(turns.slice(0, -1)),
          url: location.href.slice(0, 1000),
          pageTitle: document.title.slice(0, 300) || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let failed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let chunk = decoder.decode(value, { stream: true });
        if (chunk.includes(FAILED)) failed = true;
        const resetAt = chunk.lastIndexOf(RESET);
        if (resetAt >= 0) {
          reply.content = "";
          chunk = chunk.slice(resetAt + 1);
        }
        reply.content += chunk.replace(FAILED, "");
        if (liveProse && forAgent === agent) {
          liveProse.replaceChildren();
          if (reply.content) renderProse(liveProse, reply.content);
          else liveProse.appendChild(typing());
          scrollDown();
        }
      }
      if (failed || !reply.content.trim()) throw new Error("No answer right now — try again");
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!reply.content.trim()) {
        // Drop the empty answer and give the visitor their words back.
        turns.splice(turns.indexOf(reply), 1);
        const mine = turns.pop();
        if (mine && forAgent === agent && !input.value) input.value = mine.content;
      }
      if (!aborted && forAgent === agent) {
        errEl.textContent = err instanceof Error ? err.message : "Could not reach Loki";
      }
    } finally {
      if (inflight === controller) inflight = null;
      if (forAgent === agent) {
        render();
        autosize();
      }
    }
  }

  function stopAnswer() {
    inflight?.abort();
    inflight = null;
  }

  async function handToBuild(btn: HTMLButtonElement, row: HTMLElement) {
    btn.disabled = true;
    btn.textContent = "Sending…";
    errEl.textContent = "";
    try {
      const res = await fetch(`${apiBase}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          suggestion: conversationBrief(transcripts.loki, BRIEF_MAX),
          page: location.pathname.slice(0, 300),
          url: location.href.slice(0, 1000),
          pageTitle: document.title.slice(0, 300) || undefined,
          scope: "page",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const body = (await res.json()) as { claimUrl?: string };
      row.replaceChildren(h("span", "sent", "✓ Sent to Loki's build queue"));
      if (body.claimUrl) {
        const a = h("a", "handoff", "Track it ↗") as HTMLAnchorElement;
        a.href = body.claimUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        row.appendChild(a);
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = WIDGET_AGENTS.loki.action.label;
      errEl.textContent = err instanceof Error ? err.message : "Could not send, try again";
    }
  }

  render();

  return {
    el,
    headerControls,
    focus: () => input.focus(),
    handleKey(e) {
      if (root.activeElement !== input) return false;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void send(input.value);
        return true;
      }
      return false;
    },
    abandon() {
      voice?.recorder.cancel();
      stopAnswer();
    },
  };
}

const URL_RE = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;

/**
 * Agent prose as DOM, never innerHTML: the text comes from a model answering a
 * stranger, on someone else's site. Paragraphs, "- " bullets, **bold** and
 * bare links are enough for chat answers; everything else stays literal.
 */
function renderProse(target: HTMLElement, text: string) {
  const blocks = text.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      const ul = h("ul");
      for (const l of lines) {
        const li = h("li");
        inline(li, l.replace(/^\s*[-*•]\s+/, ""));
        ul.appendChild(li);
      }
      target.appendChild(ul);
    } else {
      const p = h("p");
      inline(p, block);
      target.appendChild(p);
    }
  }
}

function inline(target: HTMLElement, text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      target.appendChild(h("strong", undefined, part.slice(2, -2)));
      continue;
    }
    let last = 0;
    for (const m of part.matchAll(URL_RE)) {
      const at = m.index ?? 0;
      if (at > last) target.appendChild(document.createTextNode(part.slice(last, at)));
      const a = h("a", undefined, m[0]) as HTMLAnchorElement;
      a.href = m[0];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      target.appendChild(a);
      last = at + m[0].length;
    }
    if (last < part.length) target.appendChild(document.createTextNode(part.slice(last)));
  }
}
