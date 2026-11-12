"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { SettingRow, SettingRows } from "@/components/ui/setting-rows";

type View = {
  available: boolean;
  bot: string | null;
  linked: boolean;
  username: string | null;
  legacyChat: boolean;
  categories: { id: string; label: string; note: string; on: boolean }[];
};

/**
 * Settings → Notifications → Telegram. Every person connects their own
 * Telegram in one tap (it opens Loki's bot; they press Start) and chooses which
 * kinds of message reach them there. Nothing to copy, no chat ids, no code.
 */
export function TelegramSettings({ operator }: { operator: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const waiting = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/telegram/link")
      .then((r) => (r.ok ? (r.json() as Promise<View>) : null))
      .then((v) => {
        if (!cancelled && v) setView(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (waiting.current) clearInterval(waiting.current);
    };
  }, []);

  async function connect() {
    setBusy("connect");
    setNote(null);
    const res = await fetch("/api/telegram/link", { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { url?: string; error?: string };
    setBusy(null);
    if (!res?.ok || !data.url) {
      setNote(data.error ?? "Telegram did not answer. Try again in a minute.");
      return;
    }
    window.open(data.url, "_blank", "noopener");
    setNote("Telegram opened. Press Start there — this page updates by itself.");
    // Watch for the link for two minutes: the person comes back to a page that
    // already says "Connected", with nothing to refresh.
    let tries = 0;
    if (waiting.current) clearInterval(waiting.current);
    waiting.current = setInterval(async () => {
      tries += 1;
      const r = await fetch("/api/telegram/link").catch(() => null);
      const v = (await r?.json().catch(() => null)) as View | null;
      if (v) setView(v);
      if (v?.linked || tries > 40) {
        if (waiting.current) clearInterval(waiting.current);
        if (v?.linked) setNote("Connected.");
      }
    }, 3000);
  }

  async function disconnect() {
    setBusy("disconnect");
    const res = await fetch("/api/telegram/link", { method: "DELETE" }).catch(() => null);
    if (res?.ok) setView((await res.json()) as View);
    setBusy(null);
    setNote(null);
  }

  async function toggle(id: string, on: boolean) {
    setBusy(id);
    const res = await fetch("/api/telegram/link", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: id, on }),
    }).catch(() => null);
    if (res?.ok) setView((await res.json()) as View);
    setBusy(null);
  }

  if (!view) {
    return (
      <section className="ui-settings-section">
        <Loader2 className="ui-spinner-sm" aria-label="Loading" />
      </section>
    );
  }

  const status = view.linked
    ? `Connected${view.username ? ` as @${view.username}` : ""}. Only what needs one tap from you, and nothing between 22:00 and 07:00.`
    : view.legacyChat
      ? // Promise connecting only where the Connect button is drawn: with no
        // bot set up, "Connect here" pointed at a button that was not there.
        view.available
        ? "Your messages go to your existing Telegram chat. Connect below to choose what you get and to use Loki's own bot."
        : "Your messages go to your Telegram chat."
      : view.available
        ? "Get what needs you on Telegram: one tap to open it, nothing to type, and nothing at night."
        : operator
          ? "Telegram is not set up on this Loki yet: create a bot with @BotFather, then set TELEGRAM_NOTIFY_BOT_TOKEN and TELEGRAM_NOTIFY_BOT_USERNAME on the app. Everyone can then connect in one tap."
          : "Telegram is not available on this Loki yet. Your notifications arrive on this phone and in Loki.";

  return (
    <section className="ui-settings-section">
      <div className="flex items-start gap-3">
        <Send className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold text-text-primary">Telegram</h2>
          <p className="text-sm text-text-secondary">{status}</p>
        </div>
      </div>

      {view.available && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {view.linked ? (
            <button
              type="button"
              className="ui-btn-secondary min-h-11"
              disabled={busy !== null}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect" && <Loader2 className="ui-spinner-xs" />}
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="ui-btn-primary min-h-11 gap-1.5"
              disabled={busy !== null}
              onClick={() => void connect()}
            >
              {busy === "connect" && <Loader2 className="ui-spinner-xs" />}
              Connect Telegram
            </button>
          )}
        </div>
      )}

      {note && (
        <p className="mt-3 text-sm text-text-secondary" role="status">
          {note}
        </p>
      )}

      {(view.linked || view.legacyChat) && (
        <div className="mt-4">
          <SettingRows>
            {view.categories.map((c) => (
              <SettingRow key={c.id} title={c.label} note={c.note}>
                {/* A switch, like every other on/off in Settings. It was a
                    solid primary button reading "On" — six primary buttons on
                    one screen, each naming a state rather than an action. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.on}
                  aria-label={c.label}
                  className={c.on ? "ui-switch ui-switch-on" : "ui-switch"}
                  disabled={busy !== null}
                  onClick={() => void toggle(c.id, !c.on)}
                >
                  <span className="ui-switch-knob" />
                </button>
              </SettingRow>
            ))}
          </SettingRows>
        </div>
      )}
    </section>
  );
}
