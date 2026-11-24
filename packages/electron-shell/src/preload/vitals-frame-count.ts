import { VITALS_CAPTURE_CHANNELS, VITALS_CAPTURES } from "@vibefield/contracts/registries";

// VT-5 (track VT, 2026-11-24; VT-D9; DESIGN.md §8 "Vitals", "Captures") — THE DESK WINDOW COUNTS ITS OWN FRAMES, in its
// preload, while a count is armed and not a frame longer. This is the one place a frame callback runs on purpose: a
// callback every frame keeps a page awake, so frames are never counted at rest, and a count ends by itself at its
// length (a timer backs the frame clock, so a hidden window that draws nothing still answers).
//
// Main asks (`VITALS_CAPTURE_CHANNELS.frameCount`, a request id and a length) and hears the count back
// (`.frameCountResult`). The preload's own frame callbacks fire with the page's frames, so it measures the desk's
// window without a line of page code and without a script injected; the page can neither start a count nor answer
// one. The wire's shape is held in main (`VitalsFrameCountReply`); this file reads only the registry's bounds, so the
// desk's preload carries none of the vitals schemas.

export interface FrameCount {
  frames: number;
  seconds: number;
  meanFps?: number;
  longestMs?: number;
  slowFrames: number;
  longFrames: number;
  gaps: number;
}

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** The count's arithmetic, pure: frame timestamps in (the frame callback's own clock), a count out. An interval of
 * `FRAME_GAP_MS` or more is a window that was not drawing: a gap, never a frame. */
export class FrameTally {
  private first: number | null = null;
  private last: number | null = null;
  private frames = 0;
  private drawnMs = 0;
  private longestMs = 0;
  private slowFrames = 0;
  private longFrames = 0;
  private gaps = 0;

  frame(at: number): void {
    if (this.last === null) {
      this.first = at;
      this.last = at;
      return;
    }
    const interval = at - this.last;
    this.last = at;
    if (!(interval > 0)) return;
    if (interval >= VITALS_CAPTURES.FRAME_GAP_MS) {
      this.gaps += 1;
      return;
    }
    if (this.frames >= VITALS_CAPTURES.FRAMES_MAX) return;
    this.frames += 1;
    this.drawnMs += interval;
    if (interval > this.longestMs) this.longestMs = interval;
    if (interval > VITALS_CAPTURES.FRAME_BUDGET_MS) this.slowFrames += 1;
    if (interval > VITALS_CAPTURES.FRAME_LONG_MS) this.longFrames += 1;
  }

  /** The span the frames were counted over, from the first frame to the last. */
  elapsedMs(): number {
    return this.first === null || this.last === null ? 0 : this.last - this.first;
  }

  count(): FrameCount {
    return {
      frames: this.frames,
      seconds: round(this.elapsedMs() / 1_000, 2),
      ...(this.frames > 0
        ? {
            meanFps: round((this.frames * 1_000) / this.drawnMs, 1),
            longestMs: round(this.longestMs, 1),
          }
        : {}),
      slowFrames: this.slowFrames,
      longFrames: this.longFrames,
      gaps: this.gaps,
    };
  }
}

export interface FrameCountHost {
  /** the page's frame callback, its id and its cancel */
  requestFrame(callback: (at: number) => void): number;
  cancelFrame(id: number): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  /** hear main's requests */
  onRequest(listener: (raw: unknown) => void): void;
  /** answer main */
  reply(payload: unknown): void;
}

function requestOf(raw: unknown): { requestId: string; seconds: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { requestId, seconds } = raw as { requestId?: unknown; seconds?: unknown };
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  if (requestId.length > VITALS_CAPTURES.REQUEST_ID_MAX) return null;
  if (
    typeof seconds !== "number" ||
    !(VITALS_CAPTURES.SECONDS as readonly number[]).includes(seconds)
  )
    return null;
  return { requestId, seconds };
}

/** Count when main asks, one count at a time; a second ask while one runs is answered `refused: "busy"`. */
export function installVitalsFrameCount(host: FrameCountHost): void {
  let busy = false;
  host.onRequest((raw) => {
    const request = requestOf(raw);
    if (request === null) return;
    if (busy) {
      host.reply({ requestId: request.requestId, refused: "busy" });
      return;
    }
    busy = true;
    const tally = new FrameTally();
    const lengthMs = request.seconds * 1_000;
    let frame: number | null = null;
    let timer: unknown = null;
    let done = false;
    const end = (): void => {
      if (done) return;
      done = true;
      busy = false;
      host.clearTimer(timer);
      if (frame !== null) host.cancelFrame(frame);
      frame = null;
      host.reply({ requestId: request.requestId, count: tally.count() });
    };
    const onFrame = (at: number): void => {
      frame = null;
      if (done) return;
      tally.frame(at);
      if (tally.elapsedMs() >= lengthMs) end();
      else frame = host.requestFrame(onFrame);
    };
    // the frame clock ends a count that draws; this ends one that does not (a hidden or minimised window)
    timer = host.setTimer(end, lengthMs + VITALS_CAPTURES.FRAME_GAP_MS);
    frame = host.requestFrame(onFrame);
  });
}

/** The desk window's preload wires the counter to its own frames and to main. */
export function installVitalsFrameCountInPreload(ipc: {
  on(channel: string, listener: (event: unknown, raw: unknown) => void): void;
  send(channel: string, payload: unknown): void;
}): void {
  // the preload's isolated world shares the page's frame clock; main's tsconfig carries no DOM types
  const frames = globalThis as unknown as {
    requestAnimationFrame(callback: (at: number) => void): number;
    cancelAnimationFrame(id: number): void;
  };
  installVitalsFrameCount({
    requestFrame: (callback) => frames.requestAnimationFrame(callback),
    cancelFrame: (id) => frames.cancelAnimationFrame(id),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    onRequest: (listener) =>
      ipc.on(VITALS_CAPTURE_CHANNELS.frameCount, (_event, raw) => listener(raw)),
    reply: (payload) => ipc.send(VITALS_CAPTURE_CHANNELS.frameCountResult, payload),
  });
}
