import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";

// THE RECORDER'S SINK (MV-0). The renderer's frame recorder
// (`field-app/src/godview/monitor/perf/frame-recorder.ts`) holds a bounded
// buffer and cannot write a file; this is the main-process half that drains it
// over `executeJavaScript` and streams the JSONL through gzip into
// `VF_GODVIEW_RECORD=<dir>`. Dormant unless that variable is set: no interval,
// no stream, no file.
//
// One file per window per app life, drained every few seconds so the renderer's
// buffer never nears its bound under a busy board, and once more as the window
// closes. The first line is a header the frame decoder skips (it has no `kind`
// it knows), carrying what a reader of the corpus wants to know about the
// machine that wrote it.

export const GODVIEW_RECORD_ENV = "VF_GODVIEW_RECORD";
export const GODVIEW_RECORD_DRAIN_MS = 5_000;

export function godviewRecordDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env[GODVIEW_RECORD_ENV];
  return dir === undefined || dir === "" ? undefined : dir;
}

/** The slice of a BrowserWindow this needs, so a test can hand in a stub. */
export interface RecordableWindow {
  webContents: { executeJavaScript(code: string, userGesture?: boolean): Promise<unknown> };
  on(event: "close", listener: () => void): unknown;
  isDestroyed(): boolean;
}

export interface GodviewRecording {
  readonly path: string;
  /** Drain once now; resolves when the bytes reached the stream. */
  drain(): Promise<number>;
  /** Final drain, then the stream is ended. Idempotent. */
  stop(): Promise<void>;
}

const DRAIN_EXPRESSION =
  'globalThis.__vfGodviewRecorder ? globalThis.__vfGodviewRecorder.drain() : ""';

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export function attachGodviewRecording(
  win: RecordableWindow,
  dir: string,
  options: { drainMs?: number; now?: () => Date; header?: Record<string, unknown> } = {},
): GodviewRecording {
  const now = options.now ?? (() => new Date());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `godview-frames-${stamp(now())}.jsonl.gz`);
  const gzip = createGzip();
  const file = createWriteStream(path);
  gzip.pipe(file);
  const finished = new Promise<void>((resolve) => {
    file.on("finish", resolve);
    file.on("error", () => resolve());
  });
  gzip.write(
    `${JSON.stringify({
      kind: "meta",
      recorder: "vibefield-godview-frame-recorder",
      version: 1,
      startedWall: now().getTime(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions["electron"] ?? null,
      ...options.header,
    })}\n`,
  );

  let inFlight: Promise<number> | null = null;
  let stopping: Promise<void> | null = null;

  /** The ask is DISPATCHED synchronously (the window may be mid-close: at the
   * `close` event it still answers, a microtask later it may not), and the
   * answer is written in one piece so lines never interleave. */
  const drainNow = (): Promise<number> => {
    if (win.isDestroyed()) return Promise.resolve(0);
    let asked: Promise<unknown>;
    try {
      asked = win.webContents.executeJavaScript(DRAIN_EXPRESSION, true);
    } catch {
      return Promise.resolve(0);
    }
    return asked.then(
      (text) => {
        if (typeof text !== "string" || text === "") return 0;
        return new Promise<number>((resolve) => {
          gzip.write(text, () => resolve(text.length));
        });
      },
      // the window is going away, or the page has not reached its scripts
      () => 0,
    );
  };
  /** Drains are serialized: a second ask waits for the first's bytes. */
  const drain = (): Promise<number> => {
    const run = inFlight === null ? drainNow() : inFlight.then(drainNow, drainNow);
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  };

  const interval = setInterval(() => {
    void drain();
  }, options.drainMs ?? GODVIEW_RECORD_DRAIN_MS);

  /** One stop, however many ask for it: the close listener and a harness
   * both await the same final drain and the same ended stream. */
  const stop = (): Promise<void> => {
    if (stopping !== null) return stopping;
    clearInterval(interval);
    stopping = drain().then(async () => {
      gzip.end();
      await finished;
    });
    return stopping;
  };
  win.on("close", () => {
    void stop();
  });
  return { path, drain, stop };
}
