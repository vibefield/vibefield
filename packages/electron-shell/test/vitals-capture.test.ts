// VT-5 (track VT, 2026-11-24; VT-D12 A) — the armed captures in Electron main and in the two preloads: one capture at a
// time, its length from the list, always stopped (its timer, the window going, a quit, an error), the folder's newest
// ten, a name never a path, the doors answering the Vitals window alone, and the desk window's count in its preload.
// Driven with fakes for `contentTracing`, the timers, the files, fieldd and the frame clock: nothing here starts
// Electron, so no real trace was recorded and no real frame was counted.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VITALS_CAPTURE_CHANNELS, VITALS_CAPTURES } from "@vibefield/contracts/registries";
import { type VitalsCaptureState, vitalsCaptureName } from "@vibefield/contracts/vitals";
import { describe, expect, it } from "vitest";
import {
  type CaptureFiles,
  type CaptureTracing,
  type DeskFramesAnswer,
  VITALS_TRACE_CATEGORIES,
  VitalsCaptures,
} from "../src/main/vitals-capture";
import { installVitalsCaptureIpc } from "../src/main/vitals-capture-ipc";
import {
  createDeskFrameRequester,
  type FrameCountContents,
} from "../src/main/vitals-frame-request";
import { FrameTally, installVitalsFrameCount } from "../src/preload/vitals-frame-count";
import { vitalsCaptureBridge } from "../src/vitals/vitals-capture-preload";

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string): string =>
  readFileSync(join(here, "..", "src", relative), "utf8");

const silent = {
  child: () => silent,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  isLevelEnabled: () => false,
};

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
};

const DIR = "/root/vitals/captures";
const AT = Date.UTC(2026, 10, 24, 14, 7, 0, 0);

class Timers {
  private next = 1;
  readonly pending = new Map<number, { fn: () => void; ms: number }>();
  set = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  };
  clear = (id: unknown): void => {
    this.pending.delete(id as number);
  };
  /** fire every timer now */
  fire(): void {
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, timer] of due) timer.fn();
  }
}

class Files implements CaptureFiles {
  readonly files = new Map<string, { text: string; mode: number }>();
  failWrite = false;
  mkdir = async (): Promise<void> => undefined;
  writeFile = async (path: string, text: string): Promise<void> => {
    if (this.failWrite) throw new Error("disk full");
    this.files.set(path, { text, mode: 0o644 });
  };
  chmod = async (path: string, mode: number): Promise<void> => {
    const file = this.files.get(path);
    if (file === undefined) throw new Error("ENOENT");
    file.mode = mode;
  };
  rename = async (from: string, to: string): Promise<void> => {
    const file = this.files.get(from);
    if (file === undefined) throw new Error("ENOENT");
    this.files.delete(from);
    this.files.set(to, file);
  };
  size = async (path: string): Promise<number> => this.files.get(path)?.text.length ?? 0;
  readdir = async (dir: string): Promise<string[]> =>
    [...this.files.keys()]
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(dir.length + 1));
  unlink = async (path: string): Promise<void> => {
    this.files.delete(path);
  };
  names(): string[] {
    return [...this.files.keys()].map((path) => path.slice(DIR.length + 1)).sort();
  }
}

class Tracing implements CaptureTracing {
  started: unknown[] = [];
  stopped: string[] = [];
  failStart = false;
  constructor(private readonly files: Files) {}
  startRecording = async (options: unknown): Promise<void> => {
    if (this.failStart) throw new Error("a trace is running elsewhere");
    this.started.push(options);
  };
  stopRecording = async (path: string): Promise<string> => {
    this.stopped.push(path);
    this.files.files.set(path, { text: '{"traceEvents":[]}', mode: 0o644 });
    return path;
  };
}

function rig(
  opts: {
    fieldd?: {
      request: (method: string, params?: unknown, o?: unknown) => Promise<unknown>;
    } | null;
    desk?: (seconds: number) => Promise<DeskFramesAnswer>;
    dir?: string | null;
  } = {},
) {
  const files = new Files();
  const tracing = new Tracing(files);
  const timers = new Timers();
  const states: VitalsCaptureState[] = [];
  const captures = new VitalsCaptures({
    dir: () => (opts.dir === undefined ? DIR : opts.dir),
    tracing,
    fieldd: () => (opts.fieldd === undefined ? null : opts.fieldd),
    deskFrames: (seconds) =>
      (opts.desk ?? (async () => ({ ok: false, reason: "no-desk" })))(seconds),
    files,
    onState: (state) => states.push(state),
    logger: silent,
    now: () => AT,
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  return { captures, files, tracing, timers, states };
}

describe("VT-5 — what the window may arm", () => {
  it("takes a kind and a length from the lists, and nothing else", () => {
    for (const raw of [
      { kind: "trace", seconds: 15 },
      { kind: "trace", seconds: 0 },
      { kind: "heap", seconds: 10 },
      { kind: "trace" },
      "trace",
      null,
      { kind: "trace", seconds: "10" },
    ]) {
      const { captures, tracing, states } = rig();
      expect(captures.arm(raw), JSON.stringify(raw)).toEqual({
        accepted: false,
        reason: "not-started",
      });
      expect(tracing.started).toHaveLength(0);
      expect(states).toHaveLength(0);
    }
  });

  it("runs one at a time, whole-app: a second is refused and the first goes on", async () => {
    const { captures, timers, states } = rig();
    expect(captures.arm({ kind: "trace", seconds: 20 })).toEqual({ accepted: true });
    expect(captures.current()).toEqual({
      state: "running",
      kind: "trace",
      seconds: 20,
      endsAt: AT + 20_000,
    });
    for (const kind of ["trace", "profile", "frames"]) {
      expect(captures.arm({ kind, seconds: 10 })).toEqual({ accepted: false, reason: "busy" });
    }
    await settle();
    expect([...timers.pending.values()].map((timer) => timer.ms)).toEqual([20_000]);
    expect(states.map((state) => state.state)).toEqual(["running"]);
  });

  it("shows a capture's own file, by its name joined to the folder, and nothing else", () => {
    const { captures } = rig();
    const name = vitalsCaptureName("trace", AT);
    expect(captures.revealPath({ name })).toBe(`${DIR}/${name}`);
    for (const bad of ["../../etc/passwd", "/tmp/x.json", "notes.txt", `${name}.part`, ""]) {
      expect(captures.revealPath({ name: bad }), bad).toBeNull();
    }
    expect(captures.revealPath("trace.json")).toBeNull();
    expect(rig({ dir: null }).captures.revealPath({ name })).toBeNull();
  });
});

describe("VT-5 — the trace", () => {
  it("records a bounded category set, stops on its timer, and saves it whole and private", async () => {
    const { captures, tracing, timers, files, states } = rig();
    captures.arm({ kind: "trace", seconds: 10 });
    await settle();
    expect(tracing.started).toEqual([
      {
        included_categories: [...VITALS_TRACE_CATEGORIES],
        excluded_categories: ["*"],
        recording_mode: "record-until-full",
        trace_buffer_size_in_kb: VITALS_CAPTURES.TRACE_BUFFER_KB,
      },
    ]);
    expect(VITALS_TRACE_CATEGORIES.length).toBeLessThanOrEqual(24);
    timers.fire();
    await settle();
    const name = vitalsCaptureName("trace", AT);
    expect(tracing.stopped).toEqual([`${DIR}/.${name}.part`]);
    expect(files.names()).toEqual([name]);
    expect(files.files.get(`${DIR}/${name}`)?.mode).toBe(0o600);
    expect(states.at(-1)).toEqual({
      state: "saved",
      kind: "trace",
      seconds: 10,
      name,
      bytes: '{"traceEvents":[]}'.length,
    });
    // free again
    expect(captures.arm({ kind: "trace", seconds: 10 })).toEqual({ accepted: true });
  });

  it("is stopped, and not saved, when the window goes", async () => {
    const { captures, tracing, timers, files, states } = rig();
    captures.arm({ kind: "trace", seconds: 30 });
    await settle();
    captures.cut();
    await settle();
    expect(tracing.stopped).toHaveLength(1);
    expect(timers.pending.size).toBe(0);
    expect(files.names()).toEqual([]);
    expect(states.at(-1)).toEqual({ state: "failed", kind: "trace", reason: "cut-short" });
  });

  it("is stopped at a quit, even one that comes while it is starting", async () => {
    const { captures, tracing, files } = rig();
    captures.arm({ kind: "trace", seconds: 30 });
    captures.dispose(); // before startRecording has answered
    await settle();
    expect(tracing.started).toHaveLength(1);
    expect(tracing.stopped).toHaveLength(1);
    expect(files.names()).toEqual([]);
    expect(captures.arm({ kind: "trace", seconds: 10 }).accepted).toBe(false);
  });

  it("says a trace that would not start, and one it could not keep", async () => {
    const refused = rig();
    refused.tracing.failStart = true;
    refused.captures.arm({ kind: "trace", seconds: 10 });
    await settle();
    expect(refused.states.at(-1)).toEqual({
      state: "failed",
      kind: "trace",
      reason: "not-started",
    });
    expect(refused.tracing.stopped).toHaveLength(0);

    const lost = rig();
    lost.files.rename = async () => {
      throw new Error("EXDEV");
    };
    lost.captures.arm({ kind: "trace", seconds: 10 });
    await settle();
    lost.timers.fire();
    await settle();
    expect(lost.states.at(-1)).toEqual({ state: "failed", kind: "trace", reason: "not-saved" });
    expect(lost.files.names()).toEqual([]);
  });

  it("keeps the folder's newest ten, whoever wrote them, and never a stranger's file", async () => {
    const { captures, files, timers } = rig();
    const older = Array.from({ length: VITALS_CAPTURES.KEEP }, (_, index) =>
      vitalsCaptureName(index % 2 === 0 ? "profile" : "frames", AT - (index + 1) * 60_000),
    );
    for (const name of [...older, "notes.txt"])
      files.files.set(`${DIR}/${name}`, { text: "{}", mode: 0o600 });
    captures.arm({ kind: "trace", seconds: 10 });
    await settle();
    timers.fire();
    await settle();
    const oldest = older.at(-1) ?? "";
    expect(files.names()).toEqual(
      [
        ...older.filter((name) => name !== oldest),
        "notes.txt",
        vitalsCaptureName("trace", AT),
      ].sort(),
    );
  });
});

describe("VT-5 — fieldd's profile, asked for", () => {
  it("asks fieldd's door for the length, bounded in time, and shows what fieldd saved", async () => {
    const calls: unknown[][] = [];
    const name = vitalsCaptureName("profile", AT);
    const fieldd = {
      request: async (...args: unknown[]) => {
        calls.push(args);
        return { name, bytes: 4_096, seconds: 20, samples: 900 };
      },
    };
    const { captures, states } = rig({ fieldd });
    expect(captures.arm({ kind: "profile", seconds: 20 })).toEqual({ accepted: true });
    await settle();
    expect(calls).toEqual([
      [
        "vitals.profile.capture",
        { seconds: 20 },
        { timeoutMs: 20_000 + VITALS_CAPTURES.REPLY_GRACE_MS },
      ],
    ]);
    expect(states.at(-1)).toEqual({
      state: "saved",
      kind: "profile",
      seconds: 20,
      name,
      bytes: 4_096,
      samples: 900,
    });
  });

  it("says fieldd's refusals in the window's words", async () => {
    const cases: Array<[unknown, string]> = [
      [{ kind: "CONFLICT", details: { capture: "busy" } }, "busy"],
      [{ kind: "UNAVAILABLE", details: { capture: "not-started" } }, "not-started"],
      [{ kind: "INTERNAL", details: { capture: "not-saved" } }, "not-saved"],
      [{ kind: "UNAVAILABLE", details: { timeoutMs: 35_000 } }, "no-fieldd"],
      [{ kind: "FORBIDDEN_SCOPE" }, "not-started"],
    ];
    for (const [error, reason] of cases) {
      const { captures, states } = rig({ fieldd: { request: async () => Promise.reject(error) } });
      captures.arm({ kind: "profile", seconds: 10 });
      await settle();
      expect(states.at(-1), reason).toEqual({ state: "failed", kind: "profile", reason });
    }
    const none = rig({ fieldd: null });
    expect(none.captures.arm({ kind: "profile", seconds: 10 })).toEqual({
      accepted: false,
      reason: "no-fieldd",
    });
    const odd = rig({
      fieldd: { request: async () => ({ name: "/etc/passwd", bytes: 1, seconds: 10 }) },
    });
    odd.captures.arm({ kind: "profile", seconds: 10 });
    await settle();
    expect(odd.states.at(-1)).toEqual({ state: "failed", kind: "profile", reason: "not-saved" });
  });

  it("goes on waiting when the window goes, so a window opened again hears it saved", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const fieldd = { request: () => new Promise<unknown>((resolve) => (answer = resolve)) };
    const { captures } = rig({ fieldd });
    captures.arm({ kind: "profile", seconds: 30 });
    await settle();
    captures.cut();
    expect(captures.current()).toMatchObject({ state: "running", kind: "profile" });
    // still one at a time: fieldd's profile is still running
    expect(captures.arm({ kind: "trace", seconds: 10 })).toEqual({
      accepted: false,
      reason: "busy",
    });
    answer({ name: vitalsCaptureName("profile", AT), bytes: 1, seconds: 30 });
    await settle();
    expect(captures.current()).toMatchObject({ state: "saved", kind: "profile", bytes: 1 });
  });

  it("stops waiting at a quit, and a late answer says nothing", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const fieldd = { request: () => new Promise<unknown>((resolve) => (answer = resolve)) };
    const { captures, states } = rig({ fieldd });
    captures.arm({ kind: "profile", seconds: 30 });
    await settle();
    const told = states.length;
    captures.dispose();
    expect(captures.current()).toEqual({ state: "idle" });
    answer({ name: vitalsCaptureName("profile", AT), bytes: 1, seconds: 30 });
    await settle();
    // a leaving main tells no window
    expect(states).toHaveLength(told);
    expect(captures.current()).toEqual({ state: "idle" });
  });
});

describe("VT-5 — the desk's frames", () => {
  const count = {
    frames: 581,
    seconds: 10.02,
    meanFps: 58,
    longestMs: 41.2,
    slowFrames: 12,
    longFrames: 0,
    gaps: 0,
  };

  it("saves what the desk counted as a small json, and shows it", async () => {
    const { captures, files, states } = rig({ desk: async () => ({ ok: true, count }) });
    captures.arm({ kind: "frames", seconds: 10 });
    await settle();
    const name = vitalsCaptureName("frames", AT);
    expect(files.names()).toEqual([name]);
    expect(JSON.parse(files.files.get(`${DIR}/${name}`)?.text ?? "")).toEqual({
      v: 1,
      kind: "frames",
      at: AT,
      ...count,
    });
    expect(files.files.get(`${DIR}/${name}`)?.mode).toBe(0o600);
    expect(states.at(-1)).toMatchObject({ state: "saved", kind: "frames", name, frames: count });
  });

  it("says a desk that is not open, a count cut short, and one that does not parse", async () => {
    for (const [answer, reason] of [
      [{ ok: false, reason: "no-desk" }, "no-desk"],
      [{ ok: false, reason: "cut-short" }, "cut-short"],
      [{ ok: true, count: { frames: -1 } }, "not-saved"],
    ] as const) {
      const { captures, states, files } = rig({ desk: async () => answer as DeskFramesAnswer });
      captures.arm({ kind: "frames", seconds: 10 });
      await settle();
      expect(states.at(-1)).toEqual({ state: "failed", kind: "frames", reason });
      expect(files.names()).toEqual([]);
    }
  });
});

describe("VT-5 — main asks the desk window, and hears it alone", () => {
  class Contents implements FrameCountContents {
    sent: Array<[string, unknown]> = [];
    destroyed = false;
    private gone: (() => void) | null = null;
    send(channel: string, payload: unknown): void {
      this.sent.push([channel, payload]);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    once(_event: "destroyed", listener: () => void): void {
      this.gone = listener;
    }
    off(): void {
      this.gone = null;
    }
    die(): void {
      this.destroyed = true;
      this.gone?.();
    }
  }
  const ipcRig = () => {
    const listeners = new Set<(event: { sender: unknown }, raw: unknown) => void>();
    return {
      listeners,
      ipc: {
        on: (_channel: string, listener: (event: { sender: unknown }, raw: unknown) => void) =>
          listeners.add(listener),
        off: (_channel: string, listener: (event: { sender: unknown }, raw: unknown) => void) =>
          listeners.delete(listener),
      },
      reply: (sender: unknown, raw: unknown) => {
        for (const listener of [...listeners]) listener({ sender }, raw);
      },
    };
  };

  it("takes the count from that window's own answer to that request", async () => {
    const desk = new Contents();
    const { ipc, reply, listeners } = ipcRig();
    const timers = new Timers();
    const ask = createDeskFrameRequester({
      desk: () => desk,
      ipc,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    const answer = ask(10);
    expect(desk.sent).toEqual([
      [VITALS_CAPTURE_CHANNELS.frameCount, { requestId: "vitals-frames:1", seconds: 10 }],
    ]);
    const count = { frames: 3, seconds: 10, slowFrames: 0, longFrames: 0, gaps: 0, meanFps: 60 };
    reply({}, { requestId: "vitals-frames:1", count }); // another sender
    reply(desk, { requestId: "vitals-frames:9", count }); // another request
    reply(desk, { requestId: "vitals-frames:1", count: { frames: "many" } }); // not a count
    expect(listeners.size).toBe(1);
    reply(desk, { requestId: "vitals-frames:1", count });
    expect(await answer).toEqual({ ok: true, count });
    expect(listeners.size).toBe(0);
    expect(timers.pending.size).toBe(0);
  });

  it("says no desk, a desk that went, and one that never answered", async () => {
    const { ipc } = ipcRig();
    expect(await createDeskFrameRequester({ desk: () => null, ipc })(10)).toEqual({
      ok: false,
      reason: "no-desk",
    });
    const desk = new Contents();
    const timers = new Timers();
    const ask = createDeskFrameRequester({
      desk: () => desk,
      ipc,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    const gone = ask(10);
    desk.die();
    expect(await gone).toEqual({ ok: false, reason: "cut-short" });
    const quiet = new Contents();
    const silentAsk = createDeskFrameRequester({
      desk: () => quiet,
      ipc,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    const never = silentAsk(30);
    expect([...timers.pending.values()].map((timer) => timer.ms)).toEqual([
      30_000 + VITALS_CAPTURES.REPLY_GRACE_MS,
    ]);
    timers.fire();
    expect(await never).toEqual({ ok: false, reason: "cut-short" });
  });
});

describe("VT-5 — the desk window counts its own frames, only while armed", () => {
  it("counts frames, the longest, those over a 60 Hz frame and over 50 ms, and a gap apart", () => {
    const tally = new FrameTally();
    let at = 1_000;
    tally.frame(at);
    for (const interval of [16, 17, 16, 33, 16, 60, 16, 2_500, 16]) {
      at += interval;
      tally.frame(at);
    }
    expect(tally.count()).toEqual({
      frames: 8,
      seconds: 2.69,
      meanFps: Math.round((8 * 1_000 * 10) / (16 + 17 + 16 + 33 + 16 + 60 + 16 + 16)) / 10,
      longestMs: 60,
      slowFrames: 3,
      longFrames: 1,
      gaps: 1,
    });
    expect(new FrameTally().count()).toEqual({
      frames: 0,
      seconds: 0,
      slowFrames: 0,
      longFrames: 0,
      gaps: 0,
    });
  });

  function preloadRig() {
    const callbacks = new Map<number, (at: number) => void>();
    const timers = new Timers();
    const replies: unknown[] = [];
    let request: ((raw: unknown) => void) | null = null;
    let next = 1;
    installVitalsFrameCount({
      requestFrame: (callback) => {
        const id = next++;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: (id) => callbacks.delete(id),
      setTimer: timers.set,
      clearTimer: timers.clear,
      onRequest: (listener) => {
        request = listener;
      },
      reply: (payload) => replies.push(payload),
    });
    const draw = (at: number): void => {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) callback(at);
    };
    return { callbacks, timers, replies, ask: (raw: unknown) => request?.(raw), draw };
  }

  it("asks for frames only once armed, ends by itself at its length, and asks for none after", () => {
    const page = preloadRig();
    expect(page.callbacks.size).toBe(0); // at rest: no frame callback at all
    page.ask({ requestId: "r1", seconds: 10 });
    expect(page.callbacks.size).toBe(1);
    // a frame every 16 ms: ten seconds is 625 of them, and the count ends on the frame that reaches its length
    for (let frame = 0; frame <= 700; frame++) page.draw(5_000 + frame * 16);
    expect(page.replies).toEqual([
      {
        requestId: "r1",
        count: {
          frames: 625,
          seconds: 10,
          meanFps: 62.5,
          longestMs: 16,
          slowFrames: 0,
          longFrames: 0,
          gaps: 0,
        },
      },
    ]);
    expect(page.callbacks.size).toBe(0);
    expect(page.timers.pending.size).toBe(0);
  });

  it("answers a window that draws nothing by its timer, refuses a second, and ignores a bad ask", () => {
    const page = preloadRig();
    for (const bad of [
      null,
      { requestId: "r", seconds: 15 },
      { requestId: "", seconds: 10 },
      { seconds: 10 },
    ]) {
      page.ask(bad);
    }
    expect(page.callbacks.size).toBe(0);
    page.ask({ requestId: "r2", seconds: 20 });
    page.ask({ requestId: "r3", seconds: 10 });
    expect(page.replies).toEqual([{ requestId: "r3", refused: "busy" }]);
    expect([...page.timers.pending.values()].map((timer) => timer.ms)).toEqual([
      20_000 + VITALS_CAPTURES.FRAME_GAP_MS,
    ]);
    page.timers.fire();
    expect(page.replies.at(-1)).toEqual({
      requestId: "r2",
      count: { frames: 0, seconds: 0, slowFrames: 0, longFrames: 0, gaps: 0 },
    });
    expect(page.callbacks.size).toBe(0);
  });

  it("is wired into the desk's preload on contracts' channels, with no page code and no injected script", () => {
    const preload = source("preload/index.ts");
    expect(preload).toContain("installVitalsFrameCountInPreload(ipcRenderer);");
    const counter = source("preload/vitals-frame-count.ts");
    expect(counter).toContain("ipc.on(VITALS_CAPTURE_CHANNELS.frameCount,");
    expect(counter).toContain("ipc.send(VITALS_CAPTURE_CHANNELS.frameCountResult, payload)");
    expect(counter).not.toContain("exposeInMainWorld");
    for (const file of [
      "main/vitals-capture.ts",
      "main/vitals-capture-host.ts",
      "main/vitals-frame-request.ts",
    ]) {
      expect(source(file), file).not.toContain("executeJavaScript");
    }
  });
});

describe("VT-5 — the captures' doors answer the Vitals window alone", () => {
  it("arms, reads and shows for the window's own frame, and nothing for anyone else", () => {
    const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>();
    const removed: string[] = [];
    const vitalsFrame = { sender: "vitals" };
    const armed: unknown[] = [];
    const shown: string[] = [];
    const stop = installVitalsCaptureIpc({
      ipc: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => removed.push(channel),
      },
      isVitalsWindow: (event) => event === vitalsFrame,
      captures: {
        arm: (raw) => {
          armed.push(raw);
          return { accepted: true };
        },
        current: () => ({ state: "running", kind: "trace", seconds: 10, endsAt: 1 }),
        revealPath: (raw) =>
          (raw as { name?: string }).name === "trace-20261124T140700000Z.json" ? "/x/t.json" : null,
      },
      reveal: (path) => shown.push(path),
    });
    const call = (channel: string, event: unknown, raw?: unknown) =>
      handlers.get(channel)?.(event, raw);
    const stranger = { sender: "desk" };
    expect(call(VITALS_CAPTURE_CHANNELS.arm, stranger, { kind: "trace", seconds: 10 })).toEqual({
      accepted: false,
      reason: "not-started",
    });
    expect(call(VITALS_CAPTURE_CHANNELS.current, stranger)).toEqual({ state: "idle" });
    expect(
      call(VITALS_CAPTURE_CHANNELS.reveal, stranger, { name: "trace-20261124T140700000Z.json" }),
    ).toEqual({
      revealed: false,
    });
    expect(armed).toEqual([]);
    expect(shown).toEqual([]);

    expect(call(VITALS_CAPTURE_CHANNELS.arm, vitalsFrame, { kind: "trace", seconds: 10 })).toEqual({
      accepted: true,
    });
    expect(call(VITALS_CAPTURE_CHANNELS.current, vitalsFrame)).toMatchObject({ state: "running" });
    expect(call(VITALS_CAPTURE_CHANNELS.reveal, vitalsFrame, { name: "../x" })).toEqual({
      revealed: false,
    });
    expect(
      call(VITALS_CAPTURE_CHANNELS.reveal, vitalsFrame, { name: "trace-20261124T140700000Z.json" }),
    ).toEqual({
      revealed: true,
    });
    expect(shown).toEqual(["/x/t.json"]);
    stop();
    expect(removed.sort()).toEqual(
      [
        VITALS_CAPTURE_CHANNELS.arm,
        VITALS_CAPTURE_CHANNELS.current,
        VITALS_CAPTURE_CHANNELS.reveal,
      ].sort(),
    );
  });

  it("checks the sender is the Vitals window's main frame, never a frame inside it", () => {
    const host = source("main/vitals-capture-host.ts");
    expect(host).toContain("sent.sender === contents && sent.senderFrame?.parent === null");
    expect(host).toContain("shell.showItemInFolder(path)");
    expect(source("main/vitals.ts")).toContain(
      "if (windowHost.rendererPid() === null) captures.cut();",
    );
    expect(source("main/vitals.ts")).toContain("captures.dispose();");
  });

  it("hands the page three asks and a stream, passing a string and a number and nothing else", async () => {
    const invoked: unknown[][] = [];
    const listeners = new Map<string, (event: unknown, raw: unknown) => void>();
    const bridge = vitalsCaptureBridge({
      invoke: async (...args: unknown[]) => {
        invoked.push(args);
        return null;
      },
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel) => listeners.delete(channel),
    });
    await bridge.arm("trace", 10);
    await bridge.arm({ evil: true } as unknown as string, Number.NaN);
    await bridge.reveal("frames-20261124T140700000Z.json");
    await bridge.current();
    expect(invoked).toEqual([
      [VITALS_CAPTURE_CHANNELS.arm, { kind: "trace", seconds: 10 }],
      [VITALS_CAPTURE_CHANNELS.arm, { kind: "", seconds: Number.NaN }],
      [VITALS_CAPTURE_CHANNELS.reveal, { name: "frames-20261124T140700000Z.json" }],
      [VITALS_CAPTURE_CHANNELS.current],
    ]);
    const heard: unknown[] = [];
    const stop = bridge.onState((state) => heard.push(state));
    listeners.get(VITALS_CAPTURE_CHANNELS.state)?.({}, { state: "idle" });
    expect(heard).toEqual([{ state: "idle" }]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
