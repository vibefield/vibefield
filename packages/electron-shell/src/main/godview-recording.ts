import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// THE RECORDER'S SINK (MV-0). The renderer's frame recorder
// (`field-app/src/godview/monitor/perf/frame-recorder.ts`) holds a bounded
// buffer and cannot write a file; this is the main-process half that drains it
// over `executeJavaScript` and writes the JSONL, gzipped, into
// `VF_GODVIEW_RECORD=<dir>`. Dormant unless that variable is set: no interval,
// no file.
//
// One file per window per app life, drained every few seconds so the renderer's
// buffer never nears its bound under a busy board, and once more as the window
// closes. The first line is a header the frame decoder skips (it has no `kind`
// it knows), carrying what a reader of the corpus wants to know about the
// machine that wrote it.
//
// EVERY DRAIN IS ITS OWN GZIP MEMBER. gzip files concatenate (`gunzip` reads
// the members in turn as one stream), so compressing each drain's text whole
// and appending it leaves a file that is complete after every drain. The first
// draft streamed one member through `createGzip`, and a harness that exits the
// app without closing its window (the smokes do) left a 10-byte header on disk
// with every frame still in the compressor; a sync flush per drain then raced
// the file's own write. Whole members cost a little ratio across drains and
// buy a file that is never half-written.

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
  /** Drain once now; resolves with the bytes of JSONL written, on disk. */
  drain(): Promise<number>;
  /** Final drain, then the file is closed. Idempotent: one shared promise. */
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
  const file = createWriteStream(path);
  const finished = new Promise<void>((resolve) => {
    file.on("finish", resolve);
    file.on("error", () => resolve());
  });
  /** One gzip member, on disk before the promise resolves. */
  const append = (text: string): Promise<void> =>
    new Promise<void>((resolve) => {
      file.write(gzipSync(Buffer.from(text, "utf8")), () => resolve());
    });
  const header = append(
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

  /** asks (and the header) whose bytes have not landed yet */
  let active = 1;
  let chain: Promise<number> = header
    .then(() => 0)
    .finally(() => {
      active -= 1;
    });
  let stopping: Promise<void> | null = null;

  /** The ask is DISPATCHED synchronously (the window may be mid-close: at the
   * `close` event it still answers, a microtask later it may not). */
  const drainNow = (): Promise<number> => {
    if (win.isDestroyed()) return Promise.resolve(0);
    let asked: Promise<unknown>;
    try {
      asked = win.webContents.executeJavaScript(DRAIN_EXPRESSION, true);
    } catch {
      return Promise.resolve(0);
    }
    return asked.then(
      async (text) => {
        if (typeof text !== "string" || text === "") return 0;
        await append(text);
        return text.length;
      },
      // the window is going away, or the page has not reached its scripts
      () => 0,
    );
  };
  /** Drains are serialized: a second ask waits for the first's bytes. With
   * nothing in flight the ask goes out NOW, synchronously — the `close`
   * listener's drain must reach the page before the window is destroyed, and a
   * `.then` would run a microtask too late. */
  const drain = (): Promise<number> => {
    const run = active === 0 ? drainNow() : chain.then(drainNow, drainNow);
    active += 1;
    const tracked = run.finally(() => {
      active -= 1;
    });
    chain = tracked;
    return tracked;
  };

  const interval = setInterval(() => {
    void drain();
  }, options.drainMs ?? GODVIEW_RECORD_DRAIN_MS);

  /** One stop, however many ask for it: the close listener and a harness
   * both await the same final drain and the same closed file. */
  const stop = (): Promise<void> => {
    if (stopping !== null) return stopping;
    clearInterval(interval);
    stopping = drain().then(async () => {
      file.end();
      await finished;
    });
    return stopping;
  };
  win.on("close", () => {
    void stop();
  });
  return { path, drain, stop };
}
