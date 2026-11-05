import { Worker } from "node:worker_threads";
import { CUE_IDS, type CueId, encodeWav, type RenderOptions, render } from "@vibefield/sound";

// SD-2 — the renders, off main's thread. A sound takes 100–360 ms to render on an M-class Mac (measured 2026-11-05),
// too long for the thread that answers every window, so main hands each to one worker (`sound-worker-thread.ts`,
// bundled beside main as `sound-worker.cjs`, which Electron starts from inside app.asar). A render is a pure function
// of its cue and options (@vibefield/sound), so the worker holds no state but its own isolate: it is started on the
// first ask and ended after a minute with none.

/** One render as the worker's thread does it: the sound, encoded as the 24-bit WAV the system plays. */
export function renderWav(cue: CueId, options: RenderOptions): Uint8Array {
  return encodeWav(render(cue, options).channels);
}

/** What main sends the thread, and what it answers. */
export interface RenderAsk {
  readonly id: number;
  readonly cue: CueId;
  readonly options: RenderOptions;
}
export type RenderAnswer =
  | { readonly id: number; readonly bytes: Uint8Array }
  | { readonly id: number; readonly error: string };

/** A worker as main uses it; `node:worker_threads`' Worker, or a test's. */
export interface RenderThread {
  postMessage(ask: RenderAsk): void;
  on(event: "message", listener: (answer: RenderAnswer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  unref(): void;
  terminate(): Promise<number>;
}

/** A minute with no ask, and the thread is ended; the next ask starts another. */
export const RENDER_IDLE_MS = 60_000;

export interface SoundRenderer {
  render(cue: CueId, options: RenderOptions): Promise<Uint8Array>;
  dispose(): void;
}

export function createSoundRenderer(options: {
  /** The thread's bundle: beside main's own (`join(__dirname, "sound-worker.cjs")`). */
  readonly path: string;
  readonly start?: (path: string) => RenderThread;
  readonly idleMs?: number;
}): SoundRenderer {
  const start = options.start ?? ((path: string) => new Worker(path) as unknown as RenderThread);
  const idleMs = options.idleMs ?? RENDER_IDLE_MS;
  const pending = new Map<
    number,
    { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
  >();
  let thread: RenderThread | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  let nextId = 1;

  const failAll = (error: Error): void => {
    for (const ask of pending.values()) ask.reject(error);
    pending.clear();
  };
  const end = (): void => {
    if (idle !== null) clearTimeout(idle);
    idle = null;
    const was = thread;
    thread = null;
    if (was !== null) void was.terminate();
  };
  const settleIdle = (): void => {
    if (idle !== null) clearTimeout(idle);
    idle = pending.size === 0 ? setTimeout(end, idleMs) : null;
    idle?.unref?.();
  };
  const ensure = (): RenderThread => {
    if (thread !== null) return thread;
    const made = start(options.path);
    made.unref();
    made.on("message", (answer) => {
      const ask = pending.get(answer.id);
      if (ask === undefined) return;
      pending.delete(answer.id);
      if ("bytes" in answer) ask.resolve(answer.bytes);
      else ask.reject(new Error(answer.error));
      settleIdle();
    });
    made.on("error", (error) => {
      if (thread === made) thread = null;
      failAll(error);
    });
    made.on("exit", (code) => {
      if (thread === made) thread = null;
      failAll(new Error(`the sound worker exited (${code})`));
    });
    thread = made;
    return made;
  };

  return {
    render(cue, renderOptions) {
      if (!CUE_IDS.includes(cue)) return Promise.reject(new Error(`unknown cue: ${cue}`));
      const id = nextId++;
      return new Promise<Uint8Array>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        if (idle !== null) clearTimeout(idle);
        idle = null;
        try {
          ensure().postMessage({ id, cue, options: renderOptions });
        } catch (error) {
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    dispose() {
      failAll(new Error("the sound renderer was disposed"));
      end();
    },
  };
}
