/**
 * What voice mode knows about ITSELF: which voices it has, how to change
 * one, what the switches do, what can be said. Pure; pinned by
 * scripts/test/voice-self.ts.
 *
 * Two uses, one source. The voice command ("use Troy", "other voice",
 * "change your voice") is answered here on the phone, and a question that
 * reaches Loki carries `voiceModeContext` ahead of it — so "can I change your
 * voice?" is never again answered with how "most voice-enabled AI chat apps"
 * work (owner, 2026-10-20). Every fact is read from config/no-screen.ts,
 * never retyped, so a voice or a command added there is known here at once.
 */
import {
  NO_SCREEN_COMMANDS,
  NO_SCREEN_DEFAULT_VOICE,
  NO_SCREEN_OPTIONS,
  NO_SCREEN_VOICES,
  type NoScreenSettings,
  type NoScreenVoice,
} from "@/config/no-screen";
import { list } from "@/lib/voice/briefing";
import type { VoiceChoice } from "@/lib/voice/commands";

const STUDIO = NO_SCREEN_VOICES.filter((v) => v.id !== "phone");

export function voiceLabel(id: NoScreenVoice): string {
  return NO_SCREEN_VOICES.find((v) => v.id === id)?.label ?? id;
}

/** "Other voice": the next studio voice, round the list. From the phone's
 *  own voice it goes to the default studio one. */
export function nextVoice(current: NoScreenVoice): NoScreenVoice {
  const i = STUDIO.findIndex((v) => v.id === current);
  if (i < 0) return NO_SCREEN_DEFAULT_VOICE;
  return STUDIO[(i + 1) % STUDIO.length].id;
}

/** Which voice a choice lands on; null means "list them", which changes nothing. */
export function resolveVoiceChoice(
  choice: VoiceChoice,
  current: NoScreenVoice,
): NoScreenVoice | null {
  if (choice === null) return null;
  return choice === "next" ? nextVoice(current) : choice;
}

function studioNames(): string {
  return list(STUDIO.map((v) => v.label)).replace(/ and ([^,]+)$/, " or $1");
}

/** "Change your voice" with no name: what there is, which is on, how to pick. */
export function composeVoiceList(current: NoScreenVoice): string {
  const now = current === "phone" ? "your phone's own voice" : voiceLabel(current);
  const example = STUDIO.find((v) => v.id !== current)?.label ?? STUDIO[0].label;
  return `I can read with ${studioNames()}, or with your phone's own voice. Right now it's ${now}. Say "use" and a name, like "use ${example}", or "other voice" to hear the next one.`;
}

/**
 * The first words in the NEW voice, so the person hears what they chose.
 * When studio voices are off it says so: a switch that changes nothing you
 * can hear must not pretend otherwise.
 */
export function composeVoiceSwitched(voice: NoScreenVoice, studioOff: string | null): string {
  if (voice === "phone")
    return `This is your phone's own voice. Say "use ${voiceLabel(NO_SCREEN_DEFAULT_VOICE)}" to go back to a studio voice.`;
  if (studioOff)
    return `Switched to ${voiceLabel(voice)}, but you will still hear your phone's voice. ${studioOff}`;
  return `${voiceLabel(voice)} here. Say "other voice" to hear the next one.`;
}

/** What the page knows right now that a question about it may need. */
export type VoiceModeState = Pick<NoScreenSettings, "voice" | "music" | "bargeIn" | "mode"> & {
  /** Set when studio voices are off: the sentence the screen shows. */
  studioOff?: string | null;
};

const onOff = (on: boolean) => (on ? "on" : "off");

/**
 * Put ahead of a question asked in voice mode, the way /api/loki puts what
 * is on the screen ahead of a question asked from a page. It describes this
 * screen truthfully; the model is told to use it only when the question is
 * about the screen, and to answer briefly, because the answer is read aloud.
 */
export function voiceModeContext(state: VoiceModeState | null): string {
  const voice = state
    ? state.voice === "phone"
      ? "the phone's own voice"
      : voiceLabel(state.voice)
    : null;
  const lines = [
    `This question was SPOKEN in Loki's voice mode (the Voice page, also called no-screen mode). The person may be wearing headphones with the screen off, and your answer is read aloud: answer in a few plain spoken sentences, with no lists, headings or markdown.`,
    `If the question is about this mode or about you (your voice, the music, interrupting, what can be said), answer from these facts, which are true of this screen. Never describe how other apps or "most assistants" work, and never send them to a settings page that is not listed here.`,
    `- Voices: Loki reads with ${studioNames()} (studio voices), or with the phone's own voice.${voice ? ` Right now: ${voice}.` : ""} To change it they say "use" and a name, for example "use ${(STUDIO.find((v) => v.id !== state?.voice) ?? STUDIO[0]).label}"; "other voice" tries the next one; "change your voice" lists them. The voice can also be picked on the Voice page before pressing Start. The choice is remembered on this phone.`,
    ...(state?.studioOff ? [`- ${state.studioOff}`] : []),
    `- ${NO_SCREEN_OPTIONS.music.title}${state ? ` (now ${onOff(state.music)})` : ""}: ${NO_SCREEN_OPTIONS.music.note} It is switched on or off on the Voice page before Start.`,
    `- ${NO_SCREEN_OPTIONS.bargeIn.title}${state ? ` (now ${onOff(state.bargeIn)})` : ""}: ${NO_SCREEN_OPTIONS.bargeIn.note}`,
    `- ${NO_SCREEN_OPTIONS.important.title}${state ? ` (now ${onOff(state.mode === "important")})` : ""}: ${NO_SCREEN_OPTIONS.important.note}`,
    `- What they can say: ${NO_SCREEN_COMMANDS.map((c) => `"${c.say[0]}" — ${c.does}`).join(" ")} Anything else is a question for you.`,
  ];
  return lines.join("\n");
}

/** The question as Loki receives it in voice mode: the facts, then the words. */
export function askInVoiceMode(question: string, state: VoiceModeState | null): string {
  return `${voiceModeContext(state)}\n\n---\n\n${question}`;
}
