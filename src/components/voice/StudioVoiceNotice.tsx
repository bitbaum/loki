import { ArrowUpRight } from "lucide-react";
import { studioVoiceOffSentence, type TtsFailure } from "@/lib/voice/tts-failure";

/**
 * "Studio voices are off", said where the voice is chosen and under the
 * circle while it talks: why, what it means (every voice sounds the same),
 * and — when there is one — the link that fixes it with the steps to take
 * there. It replaced a silent fall-back to the phone's voice that left the
 * owner comparing Troy and Diana and hearing one voice.
 */
export function StudioVoiceNotice({ failure }: { failure: TtsFailure }) {
  return (
    <div className="ui-callout-warning ui-voice-notice" role="status">
      <p>{studioVoiceOffSentence(failure)}</p>
      {failure.fix && (
        <>
          <p>{failure.fix.steps}</p>
          <a
            href={failure.fix.url}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary min-h-11 self-start"
          >
            {failure.fix.label}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        </>
      )}
    </div>
  );
}
