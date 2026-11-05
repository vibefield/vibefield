import { parentPort } from "node:worker_threads";
import { CUE_IDS } from "@vibefield/sound";
import { type RenderAnswer, type RenderAsk, renderWav } from "./sound-worker";

// SD-2 — the render thread (bundled as dist/main/sound-worker.cjs, started by `createSoundRenderer`). It answers each
// ask with its WAV, its buffer transferred rather than copied, or with why it could not.

const port = parentPort;
if (port === null) throw new Error("sound-worker-thread runs only as a worker");
port.on("message", (ask: RenderAsk) => {
  let answer: RenderAnswer;
  try {
    if (!CUE_IDS.includes(ask.cue)) throw new Error(`unknown cue: ${String(ask.cue)}`);
    const bytes = renderWav(ask.cue, ask.options);
    port.postMessage({ id: ask.id, bytes } satisfies RenderAnswer, [bytes.buffer as ArrayBuffer]);
    return;
  } catch (error) {
    answer = { id: ask.id, error: error instanceof Error ? error.message : String(error) };
  }
  port.postMessage(answer);
});
