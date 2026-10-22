"use client";

import { BellDot, Headphones, Mic, Music, type LucideIcon } from "lucide-react";
import {
  NO_SCREEN_COMMANDS,
  NO_SCREEN_OPTIONS,
  NO_SCREEN_VOICES,
  type NoScreenSettings,
} from "@/config/no-screen";
import type { TtsFailure } from "@/lib/voice/tts-failure";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { StudioVoiceNotice } from "@/components/voice/StudioVoiceNotice";

/**
 * The start screen: read once, before the phone goes away. Start, the
 * choices, and what can be said.
 *
 * Its title is the app top bar's h1 ("Voice", from the nav config). It is
 * built from the same pieces as every other page (design reset, 2026-10-21):
 * one line and the one button, then titled sections of rows — each switch a
 * row with its one line under it — not a paragraph of instructions, capital
 * letter labels and boxed check marks.
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
  const toggle = (
    key: keyof typeof NO_SCREEN_OPTIONS,
    on: boolean,
    flip: () => void,
    icon: LucideIcon,
  ) => (
    <ListRow
      icon={icon}
      title={NO_SCREEN_OPTIONS[key].title}
      secondary={NO_SCREEN_OPTIONS[key].note}
      onClick={flip}
      label={`${NO_SCREEN_OPTIONS[key].title}: ${on ? "on" : "off"}`}
      trailing={<span className={on ? "ui-switch ui-switch-on" : "ui-switch"} aria-hidden />}
    />
  );
  return (
    <div className="ui-voice-start">
      <div className="ui-voice-start-head">
        <Headphones className="h-10 w-10 text-text-tertiary" aria-hidden />
        <p className="ui-voice-start-line">Loki reads your fleet aloud and listens.</p>
        {error && <p className="ui-error text-center">{error}</p>}
        <button type="button" className="ui-voice-start-btn" onClick={onStart}>
          <Mic className="h-6 w-6" aria-hidden />
          Start
        </button>
      </div>

      <Section
        title="Voice"
        right={
          <ChoiceMenu
            bare
            label="Voice"
            value={settings.voice}
            options={NO_SCREEN_VOICES.map((v) => ({ value: v.id, label: v.label }))}
            onChange={(id) => update({ voice: id as NoScreenSettings["voice"] })}
          />
        }
      >
        {/* Seven names are a menu, not a grid: 4 + 3 never lines up, and one
            scrolling chip row cut the fifth off at the screen's edge. */}
        <p className="ui-settings-lede">
          {NO_SCREEN_VOICES.find((v) => v.id === settings.voice)?.note}
        </p>
        {studioOff && settings.voice !== "phone" && <StudioVoiceNotice failure={studioOff} />}
      </Section>

      <Section title="While you listen">
        <List>
          {toggle("music", settings.music, () => update({ music: !settings.music }), Music)}
          {toggle("bargeIn", settings.bargeIn, () => update({ bargeIn: !settings.bargeIn }), Mic)}
          {toggle(
            "important",
            settings.mode === "important",
            () => update({ mode: settings.mode === "important" ? "everything" : "important" }),
            BellDot,
          )}
        </List>
      </Section>

      <Section title="What you can say">
        <ul className="ui-voice-commands">
          {NO_SCREEN_COMMANDS.map((c) => (
            <li key={c.kind} className="ui-voice-command">
              <span className="ui-voice-command-say">“{c.say[0]}”</span>
              <span className="ui-voice-command-does">{c.does}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
