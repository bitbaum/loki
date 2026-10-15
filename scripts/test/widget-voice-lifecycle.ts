import assert from "node:assert/strict";
import { createVoiceRecorder } from "../../widget/voice";

async function main() {
  const keys = ["navigator", "MediaRecorder", "fetch"] as const;
  const originals = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let grant: (stream: MediaStream) => void = () => {};
  let stopped = 0,
    created = 0;
  const stream = () =>
    ({
      getTracks: () => [
        {
          stop() {
            stopped++;
          },
        },
      ],
    }) as unknown as MediaStream;
  class Recorder extends EventTarget {
    state = "inactive";
    mimeType = "audio/webm";
    static isTypeSupported() {
      return true;
    }
    constructor(..._args: unknown[]) {
      super();
      created++;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => {
        const event = new Event("dataavailable");
        Object.defineProperty(event, "data", { value: new Blob([new Uint8Array(2000)]) });
        this.dispatchEvent(event);
        this.dispatchEvent(new Event("stop"));
      });
    }
  }
  const transcripts: string[] = [];
  let finishUpload: (response: Response) => void = () => {};
  const recorder = createVoiceRecorder({
    endpoint: "https://loki.test/transcribe",
    token: "fcw_test",
    maxMs: 60000,
    onState() {},
    onTranscript(text) {
      transcripts.push(text);
    },
  });
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: () =>
            new Promise<MediaStream>((resolve) => {
              grant = resolve;
            }),
        },
      },
    });
    Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () =>
        new Promise<Response>((resolve) => {
          finishUpload = resolve;
        }),
    });
    const pending = recorder.start();
    recorder.cancel();
    grant(stream());
    await pending;
    assert.equal(stopped, 1, "Cancel releases a microphone granted after cancellation");
    assert.equal(created, 0, "Late permission never starts recording");
    assert.equal(recorder.state(), "idle");
    const first = recorder.start();
    grant(stream());
    await first;
    recorder.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    recorder.cancel();
    const second = recorder.start();
    grant(stream());
    await second;
    finishUpload(new Response(JSON.stringify({ text: "Old recording" }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      transcripts,
      [],
      "A cancelled upload cannot append stale words to a later note",
    );
    assert.equal(recorder.state(), "recording", "An old upload cannot reset the newer recording");
    recorder.cancel();
    assert.equal(stopped, 3);
    console.log(
      "Voice lifecycle: late permissions, stream release and cancelled transcription isolation passed",
    );
  } finally {
    recorder.cancel();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
