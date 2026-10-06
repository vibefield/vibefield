import type { DeviceInfo } from "@vibefield/contracts";
import { type Corpus, generateCorpus, parseRecipe, recipeName } from "./corpus";
import { decodeCorpusJsonl } from "./corpus-codec";
import type { RecordedFrame } from "./corpus-frames";
import type { ModelReplayClient, ModelReplayStats } from "./model-replay-client";
import { MODEL_STREAM_META_KIND, type ModelStreamMeta } from "./model-stream";
import { restoreWallClock, shiftWallClock } from "./wall-clock";

// The renderer's model player. Corpus frames still establish the deterministic
// clock, roster and ordering used by the offline backend. Only model frames
// enter the window: MV-8 retired the fold and desk-board replay doors.
// Deliver one model frame per task, including late frames, so the harness
// measures the same socket-to-render work as the shipping window.

export type ReplayPhase = "empty" | "loaded" | "playing" | "ended" | "stopped";

export type ReplaySource = "model";

export type ReplayClock = "real" | "corpus";

/** Per-delivery work, ms: the handler and the microtasks it queued. */
export interface ReplayWork {
  count: number;
  totalMs: number;
  p50: number;
  p95: number;
  max: number;
}

export interface ReplayState {
  phase: ReplayPhase;
  corpus: string | null;
  total: number;
  delivered: number;
  startedAt: number | null;
  endedAt: number | null;
  marks: { name: string; at: number; seq: number }[];
  /** Readers at start; retired fold/mesh entries remain zero for report compatibility. */
  listeners: { fold: number; mesh: number; devices: number; model?: number } | null;
  /** MV-3c — what this start plays */
  source: ReplaySource;
  /** MV-3c — corpus frames passed over because nothing listened (model source) */
  skipped: number;
  /** MV-3c — the model replay client's counters over this start (model source) */
  model: ModelReplayStats | null;
  /** MV-3c — what the page's wall clock read off for this start */
  clock: ReplayClock;
  /** MV-3c — each delivered frame's work over this start */
  work: ReplayWork;
}

export interface ReplayModelLoaded {
  corpus: string;
  frames: number;
  marks: number;
  /** the corpus frame count the stream was computed against */
  corpusFrames: number;
}

export interface ReplayLoaded {
  corpus: string;
  frames: number;
  durationMs: number;
  marker: Corpus["meta"]["marker"] | null;
  roster: number;
}

export interface ReplayPlayer {
  /** Generate a corpus in the page from a recipe (`n=10,duration=8000,seed=1`). */
  load(recipeText: string): ReplayLoaded;
  /** Append recorded JSONL lines (a corpus file's text, in chunks). */
  push(text: string): ReplayLoaded;
  clear(): void;
  /** `untilT` (MV-3c): deliver only frames at or before this corpus time, then
   * end — a capture's fixed frame. */
  start(options?: { speed?: number; untilT?: number }): ReplayState;
  stop(): ReplayState;
  state(): ReplayState;
  roster(): readonly DeviceInfo[];
  /** The roster changed: the door's roster port re-emits. */
  onRoster(listener: (roster: readonly DeviceInfo[]) => void): () => void;
  onMark(listener: (frame: Extract<RecordedFrame, { kind: "mark" }>, at: number) => void): void;
  /** MV-3c — append the loaded corpus's model stream lines (whole lines, in
   * chunks; the meta header first). Throws for a stream of another corpus. */
  pushModel(text: string): ReplayModelLoaded;
  /** Drop the model stream; load a new one before the next start. */
  clearModel(): void;
  /** MV-3c — the client the model frames go to; set by `door-instruments`. */
  attachModel(client: ModelReplayClient): void;
  /** MV-3c — what the next start plays. */
  source(): ReplaySource;
  /** MV-3c — whether a start shifts the page's wall clock to the corpus's (M31;
   * `corpus`, the default) or keeps the machine's (`real`). */
  setClock(clock: ReplayClock): void;
  /** MV-3c — the corpus's wall time `t` ms after its first frame (the same
   * `t` as a start's `untilT`; null with nothing loaded): what a capture
   * freezes the page's clock at for its fixed frame. */
  wallAt(t: number): number | null;
}

/** One model stream line, held as TEXT and parsed when delivered (a socket's
 * message is parsed in the page too); `t`, `after` and `kind` are read once. */
interface ModelLine {
  t: number;
  after: number;
  kind: "model-open" | "model-frame" | "mark";
  line: string;
}

type TimelineEntry = { t: number; corpus: number } | { t: number; model: number };

export function createReplayPlayer(options: { now?: () => number } = {}): ReplayPlayer {
  const now = options.now ?? (() => performance.now());
  let frames: RecordedFrame[] = [];
  let roster: DeviceInfo[] = [];
  let corpusName: string | null = null;
  let marker: Corpus["meta"]["marker"] | null = null;
  let durationMs = 0;
  let phase: ReplayPhase = "empty";
  let delivered = 0;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listenersAtStart: ReplayState["listeners"] = null;
  const marks: ReplayState["marks"] = [];
  const rosterListeners = new Set<(roster: readonly DeviceInfo[]) => void>();
  let markListener: ((frame: Extract<RecordedFrame, { kind: "mark" }>, at: number) => void) | null =
    null;
  // MV-3c — the model source
  let modelMeta: Partial<ModelStreamMeta> | null = null;
  let modelLines: ModelLine[] = [];
  let modelClient: ModelReplayClient | null = null;
  let skipped = 0;
  let modelAtStart: ModelReplayStats | null = null;
  let timeline: TimelineEntry[] = [];
  let clock: ReplayClock = "corpus";
  let shifted = false;
  let works: number[] = [];

  /** Time one delivery: the handler, then the microtasks it queued (they run
   * first-in first-out, ahead of this one). */
  const timed = (deliverOne: () => void): void => {
    const begun = now();
    deliverOne();
    queueMicrotask(() => {
      works.push(now() - begun);
    });
  };

  const work = (): ReplayWork => {
    const sorted = [...works].sort((a, b) => a - b);
    const at = (q: number): number =>
      sorted.length === 0
        ? 0
        : (sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0);
    return {
      count: sorted.length,
      totalMs: sorted.reduce((total, value) => total + value, 0),
      p50: at(0.5),
      p95: at(0.95),
      max: sorted.at(-1) ?? 0,
    };
  };

  /** The corpus's wall at corpus time `t`: its first frame's stamp, moved on. */
  const corpusWall = (t: number): number => {
    const first = frames[0];
    return first === undefined ? Date.now() : first.wall - first.t + t;
  };

  const startClock = (firstT: number): void => {
    if (clock !== "corpus" || frames.length === 0) return;
    shiftWallClock(corpusWall(firstT));
    shifted = true;
  };

  const stopClock = (): void => {
    if (!shifted) return;
    shifted = false;
    restoreWallClock();
  };

  const loaded = (): ReplayLoaded => ({
    corpus: corpusName ?? "recorded",
    frames: frames.length,
    durationMs,
    marker,
    roster: roster.length,
  });

  const setRoster = (next: DeviceInfo[]): void => {
    roster = next;
    for (const listener of [...rosterListeners]) listener(roster);
  };

  const modelSince = (): ModelReplayStats | null => {
    if (modelClient === null || modelAtStart === null) return null;
    const now = modelClient.stats();
    return {
      subscribes: now.subscribes - modelAtStart.subscribes,
      opens: now.opens - modelAtStart.opens,
      frames: now.frames - modelAtStart.frames,
      reports: now.reports - modelAtStart.reports,
    };
  };

  const state = (): ReplayState => ({
    phase,
    corpus: corpusName,
    total: timeline.length,
    delivered,
    startedAt,
    endedAt,
    marks: [...marks],
    listeners: listenersAtStart,
    source: "model",
    skipped,
    model: modelSince(),
    clock,
    work: work(),
  });

  const dropModel = (): void => {
    modelMeta = null;
    modelLines = [];
    timeline = [];
  };

  const halt = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  /** The model source's delivery: one timeline entry (`startModel`). */
  const deliverModel = (index: number): void => {
    const held = modelLines[index];
    if (held === undefined) return;
    const frame = JSON.parse(held.line) as {
      kind: string;
      seq: number;
      t: number;
      wall: number;
      name?: string;
      detail?: Record<string, unknown>;
      open?: unknown;
      frame?: unknown;
    };
    if (frame.kind === "mark") {
      const at = now();
      marks.push({ name: frame.name ?? "mark", at, seq: frame.seq });
      markListener?.(frame as Extract<RecordedFrame, { kind: "mark" }>, at);
    } else if (frame.kind === "model-open") {
      modelClient?.deliverOpen(frame.open as Parameters<ModelReplayClient["deliverOpen"]>[0]);
    } else {
      modelClient?.deliverFrame(frame.frame as Parameters<ModelReplayClient["deliverFrame"]>[0]);
    }
  };

  /** The two streams on one timeline, by each model frame's `after`. */
  const interleave = (): TimelineEntry[] => {
    const entries: TimelineEntry[] = [];
    let next = 0;
    const takeModel = (upTo: number): void => {
      for (
        let line = modelLines[next];
        line !== undefined && line.after <= upTo;
        line = modelLines[next]
      ) {
        entries.push({ t: line.t, model: next });
        next += 1;
      }
    };
    takeModel(0);
    for (const [index, frame] of frames.entries()) {
      entries.push({ t: frame.t, corpus: index });
      takeModel(frame.seq);
    }
    takeModel(Number.POSITIVE_INFINITY);
    return entries;
  };

  const startModel = (speed: number, untilT: number): ReplayState => {
    timeline = interleave();
    modelClient?.reset();
    modelAtStart = modelClient?.stats() ?? null;
    skipped = 0;
    works = [];
    const first = timeline[0]?.t ?? 0;
    startClock(first);
    const origin = now();
    startedAt = origin;
    endedAt = null;
    delivered = 0;
    marks.length = 0;
    phase = "playing";
    listenersAtStart = {
      fold: 0,
      mesh: 0,
      devices: rosterListeners.size,
      model: modelClient?.listeners() ?? 0,
    };
    let index = 0;
    const step = (): void => {
      timer = null;
      // a corpus frame nobody reads costs nothing, not even a task
      for (
        let entry = timeline[index];
        entry !== undefined && "corpus" in entry;
        entry = timeline[index]
      ) {
        index += 1;
        skipped += 1;
        delivered = index;
      }
      const entry = timeline[index];
      if (entry === undefined || entry.t - first > untilT) {
        endedAt = now();
        phase = "ended";
        return;
      }
      const dueAt = origin + (entry.t - first) / speed;
      if (dueAt > now()) {
        timer = setTimeout(step, Math.max(0, dueAt - now()));
        return;
      }
      // ONE model frame per task, matching the shipping socket deliveries.
      timed(() => {
        if ("model" in entry) deliverModel(entry.model);
      });
      index += 1;
      delivered = index;
      timer = setTimeout(step, 0);
    };
    step();
    return state();
  };

  return {
    load(recipeText) {
      halt();
      stopClock();
      dropModel();
      const recipe = parseRecipe(recipeText);
      const corpus = generateCorpus(recipe);
      frames = corpus.frames;
      corpusName = recipeName(recipe);
      marker = corpus.meta.marker;
      durationMs = corpus.meta.recipe.durationMs;
      delivered = 0;
      startedAt = null;
      endedAt = null;
      marks.length = 0;
      phase = "loaded";
      setRoster(corpus.roster);
      return loaded();
    },
    push(text) {
      halt();
      const decoded = decodeCorpusJsonl(text);
      const start = frames.length;
      frames = [...frames, ...decoded.frames];
      if (decoded.roster.length > 0) setRoster(decoded.roster);
      const first = frames[0];
      const last = frames.at(-1);
      durationMs = first !== undefined && last !== undefined ? last.t - first.t : 0;
      if (corpusName === null)
        corpusName = typeof decoded.meta.corpus === "string" ? decoded.meta.corpus : "recorded";
      if (decoded.meta.marker !== undefined && typeof decoded.meta.marker === "object") {
        marker = decoded.meta.marker as Corpus["meta"]["marker"];
      }
      phase = frames.length > 0 ? "loaded" : "empty";
      if (start === 0) {
        delivered = 0;
        startedAt = null;
        endedAt = null;
        marks.length = 0;
      }
      return loaded();
    },
    clear() {
      halt();
      stopClock();
      dropModel();
      frames = [];
      corpusName = null;
      marker = null;
      durationMs = 0;
      delivered = 0;
      startedAt = null;
      endedAt = null;
      marks.length = 0;
      phase = "empty";
      setRoster([]);
    },
    start(startOptions = {}) {
      halt();
      if (frames.length === 0) return state();
      const speed = startOptions.speed ?? 1;
      const untilT = startOptions.untilT ?? Number.POSITIVE_INFINITY;
      if (modelLines.length === 0 || modelMeta?.corpusFrames !== frames.length) {
        throw new Error("load this corpus's model stream before starting the replay");
      }
      if (modelClient === null || modelClient.listeners() === 0) {
        throw new Error("the model replay has no window listening");
      }
      return startModel(speed, untilT);
    },
    stop() {
      halt();
      stopClock();
      if (phase === "playing") {
        phase = "stopped";
        endedAt = now();
      }
      return state();
    },
    state,
    roster: () => roster,
    onRoster(listener) {
      rosterListeners.add(listener);
      return () => {
        rosterListeners.delete(listener);
      };
    },
    onMark(listener) {
      markListener = listener;
    },
    pushModel(text) {
      halt();
      if (corpusName === null) throw new Error("load the corpus before its model stream");
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line === "") continue;
        const record = JSON.parse(line) as Record<string, unknown>;
        if (record["kind"] === MODEL_STREAM_META_KIND) {
          const { kind: _kind, ...meta } = record;
          modelMeta = meta as Partial<ModelStreamMeta>;
          if (modelMeta.corpus !== corpusName || modelMeta.corpusFrames !== frames.length) {
            const wanted = `${String(modelMeta.corpus)} (${String(modelMeta.corpusFrames)} frames)`;
            dropModel();
            throw new Error(
              `a model stream for ${wanted} does not belong to the loaded ${corpusName} (${frames.length} frames)`,
            );
          }
          continue;
        }
        const kind = record["kind"];
        if (kind !== "model-open" && kind !== "model-frame" && kind !== "mark") continue;
        if (modelMeta === null) throw new Error("a model stream starts with its meta header");
        modelLines.push({ t: record["t"] as number, after: record["after"] as number, kind, line });
      }
      phase = "loaded";
      return {
        corpus: modelMeta?.corpus ?? corpusName,
        frames: modelLines.length,
        marks: modelLines.filter((held) => held.kind === "mark").length,
        corpusFrames: modelMeta?.corpusFrames ?? frames.length,
      };
    },
    clearModel() {
      halt();
      dropModel();
    },
    attachModel(client) {
      modelClient = client;
    },
    source: () => "model",
    setClock(next) {
      clock = next;
    },
    wallAt: (t) => {
      const first = frames[0];
      return first === undefined ? null : first.wall + t;
    },
  };
}
