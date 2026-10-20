"use client";

import { Headphones, Mic } from "lucide-react";
import {
  NO_SCREEN_COMMANDS,
  NO_SCREEN_OPTIONS,
  NO_SCREEN_VOICES,
  type NoScreenSettings,
} from "@/config/no-screen";
import type { TtsFailure } from "@/lib/voice/tts-failure";
import { Segmented } from "@/components/ui/segmented";
import { OptionRow } from "@/components/terminal/sheet-rows";
import { StudioVoiceNotice } from "@/components/voice/StudioVoiceNotice";

/**
 * The start screen: read once, before the phone goes away. Start, the four
 * choices, and what can be said.
 *
 * Its title is the app top bar's h1 ("Voice", from the nav config) at every
 * width — on a phone drawn in the bar, from md up read but not drawn. So the
 * big "Voice" here is drawn from md up only and is not a second h1: the page
 * had two (Loki's reviewer, 2026-10-20).
 */
export function NoScreenStart({
  settings,
  update,
  studioOff,
  error,
  onStart,
}: {
  settings: NoScreenSettings;
  update: (patch: Partial<NoScreenSettings>) => void;
  studioOff: TtsFailure | null;
  error: string;
  onStart: () => void;
}) {
  return (
    <div className="ui-voice-start">
      <Headphones className="h-10 w-10 text-text-tertiary" aria-hidden />
      <p className="ui-page-title hidden md:block" aria-hidden="true">
        Voice
      </p>
      <p className="ui-page-subtitle max-w-sm">
        Put the headphones in, press Start, and put the phone away. Loki reads your fleet aloud,
        listens for what you say, and tells you when something finishes or needs you.
      </p>
      {error && <p className="ui-error text-center">{error}</p>}
      <button type="button" className="ui-voice-start-btn" onClick={onStart}>
        <Mic className="h-6 w-6" aria-hidden />
        Start
      </button>

      <div className="ui-voice-settings">
        <section className="ui-voice-setting" aria-labelledby="voice-pick-label">
          <h2 id="voice-pick-label" className="ui-voice-setting-label">
            Voice
          </h2>
          {/* Seven names as an even 4 + 3 grid: as one scrolling chip row the
              fifth was cut off at the screen's edge (2026-10-20). */}
          <Segmented
            label="Voice"
            columns={4}
            options={NO_SCREEN_VOICES.map((v) => ({ id: v.id, label: v.label, means: v.note }))}
            value={settings.voice}
            onChange={(id) => update({ voice: id as NoScreenSettings["voice"] })}
          />
          {studioOff && settings.voice !== "phone" && <StudioVoiceNotice failure={studioOff} />}
        </section>
        <section className="ui-voice-setting" aria-labelledby="voice-listen-label">
          <h2 id="voice-listen-label" className="ui-voice-setting-label">
            While you listen
          </h2>
          {/* On/off, one per row, each with the line that says what it does. */}
          <div className="flex flex-col gap-1">
            <OptionRow
              toggle
              title={NO_SCREEN_OPTIONS.music.title}
              detail={NO_SCREEN_OPTIONS.music.note}
              active={settings.music}
              onSelect={() => update({ music: !settings.music })}
            />
            <OptionRow
              toggle
              title={NO_SCREEN_OPTIONS.bargeIn.title}
              detail={NO_SCREEN_OPTIONS.bargeIn.note}
              active={settings.bargeIn}
              onSelect={() => update({ bargeIn: !settings.bargeIn })}
            />
            <OptionRow
              toggle
              title={NO_SCREEN_OPTIONS.important.title}
              detail={NO_SCREEN_OPTIONS.important.note}
              active={settings.mode === "important"}
              onSelect={() =>
                update({ mode: settings.mode === "important" ? "everything" : "important" })
              }
            />
          </div>
        </section>
      </div>

      <section className="mt-6 w-full text-left" aria-labelledby="voice-say-label">
        <h2 id="voice-say-label" className="ui-voice-setting-label">
          What you can say
        </h2>
        <ul className="ui-voice-commands mt-3">
          {NO_SCREEN_COMMANDS.map((c) => (
            <li key={c.kind} className="ui-voice-command">
              <span className="ui-voice-command-say">“{c.say[0]}”</span>
              <span className="ui-voice-command-does">{c.does}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
