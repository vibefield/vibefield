import type { DeviceInfo } from "@vibefield/contracts";
import { type Corpus, generateCorpus, parseRecipe, recipeName } from "./corpus";
import { decodeCorpusJsonl } from "./corpus-codec";
import type { RecordedFrame } from "./frame-recorder";
import type { ModelReplayClient, ModelReplayStats } from "./model-replay-client";
import { MODEL_STREAM_META_KIND, type ModelStreamMeta } from "./model-stream";
import type { ReplayDoor } from "./replay-door";

// THE PLAYER (MV-0, step 6): a corpus on the recorder's own timeline, in the
// renderer. The Electron lab loads a RECIPE (the page generates the corpus
// itself — the same bytes the oracle generated in Node — so no megabytes cross
// `executeJavaScript`) or pushes a RECORDED corpus's lines, then `start()`s:
// every frame is delivered to the replay door at its `t` offset from the first,
// fold frames as TEXT (the deck's parse + zod path), the rest as parsed frames.
//
// It owns the corpus's roster, and tells the door's roster listeners when a load
// replaces it — the deck's door may be built before the lab has loaded anything.
//
// MV-3c — THE MODEL SOURCE (the B arm). After a corpus is loaded, the lab may
// push that corpus's MODEL STREAM (`pushModel`, `model-stream.ts`): what the
// window's one door answers for it, computed offline by fieldd's own code. A
// start then plays both on one timeline, interleaved by each model frame's
// `after` (the corpus frame it follows on the live wire): model frames go to
// the model replay client as TEXT the page parses, as a socket's message is
// (`model-replay-client.ts`, which `createGodviewMonitorFeed` is handed under
// `godviewReplay=1`), the corpus's fold and mesh frames go to the replay door
// as before, but only while something there still listens — a build whose
// window no longer reads the fold pays nothing for it, as it would pay nothing
// live — and the marks are the stream's, moved to the frame that carries the
// marker's change to the model. With no stream pushed, a start is exactly the
// fold source above, unchanged.

export type ReplayPhase = "empty" | "loaded" | "playing" | "ended" | "stopped";

export type ReplaySource = "fold" | "model";

export interface ReplayState {
  phase: ReplayPhase;
  corpus: string | null;
  total: number;
  delivered: number;
  startedAt: number | null;
  endedAt: number | null;
  marks: { name: string; at: number; seq: number }[];
  /** the fold listeners standing on the door when `start()` was called */
  listeners: { fold: number; mesh: number; devices: number; model?: number } | null;
  /** MV-3c — what this start plays */
  source: ReplaySource;
  /** MV-3c — corpus frames passed over because nothing listened (model source) */
  skipped: number;
  /** MV-3c — the model replay client's counters over this start (model source) */
  model: ModelReplayStats | null;
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
  start(options?: { speed?: number }): ReplayState;
  stop(): ReplayState;
  state(): ReplayState;
  roster(): readonly DeviceInfo[];
  /** The roster changed: the door's roster port re-emits. */
  onRoster(listener: (roster: readonly DeviceInfo[]) => void): () => void;
  /** The door to feed; set by `door-instruments` when the deck builds it. */
  attach(door: ReplayDoor): void;
  onMark(listener: (frame: Extract<RecordedFrame, { kind: "mark" }>, at: number) => void): void;
  /** MV-3c — append the loaded corpus's model stream lines (whole lines, in
   * chunks; the meta header first). Throws for a stream of another corpus. */
  pushModel(text: string): ReplayModelLoaded;
  /** MV-3c — drop the model stream: the next start plays the fold source. */
  clearModel(): void;
  /** MV-3c — the client the model frames go to; set by `door-instruments`. */
  attachModel(client: ModelReplayClient): void;
  /** MV-3c — what the next start plays. */
  source(): ReplaySource;
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
  let lines: (string | null)[] = [];
  let roster: DeviceInfo[] = [];
  let corpusName: string | null = null;
  let marker: Corpus["meta"]["marker"] | null = null;
  let durationMs = 0;
  let door: ReplayDoor | null = null;
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
  let source: ReplaySource = "fold";
  let skipped = 0;
  let modelAtStart: ModelReplayStats | null = null;
  let timeline: TimelineEntry[] = [];

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
    if (source !== "model" || modelClient === null || modelAtStart === null) return null;
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
    total: source === "model" ? timeline.length : frames.length,
    delivered,
    startedAt,
    endedAt,
    marks: [...marks],
    listeners: listenersAtStart,
    source,
    skipped,
    model: modelSince(),
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

  const deliver = (index: number): void => {
    const frame = frames[index];
    if (frame === undefined || door === null) return;
    if (frame.kind === "mark") {
      const at = now();
      marks.push({ name: frame.name, at, seq: frame.seq });
      markListener?.(frame, at);
      door.deliver(frame);
    } else if (frame.kind === "fold") {
      const line = lines[index];
      // the deck's path: JSON text → parse → zod → onFrame
      if (line !== null && line !== undefined) door.deliverText(line);
      else door.deliver(frame);
    } else {
      door.deliver(frame);
    }
    delivered = index + 1;
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

  /** Whether a corpus frame still has a reader on the door (model source). */
  const heard = (frame: RecordedFrame): boolean => {
    if (door === null) return false;
    const standing = door.listeners();
    if (frame.kind === "fold" || frame.kind === "fold-error") return standing.fold > 0;
    if (frame.kind === "mark") return false; // the stream carries the marks
    return standing.mesh > 0;
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

  const startModel = (speed: number): ReplayState => {
    timeline = interleave();
    modelClient?.reset();
    modelAtStart = modelClient?.stats() ?? null;
    skipped = 0;
    const origin = now();
    const first = timeline[0]?.t ?? 0;
    startedAt = origin;
    endedAt = null;
    delivered = 0;
    marks.length = 0;
    phase = "playing";
    const standing = door?.listeners();
    listenersAtStart = {
      fold: standing?.fold ?? 0,
      mesh: standing?.mesh ?? 0,
      devices: standing?.devices ?? 0,
      model: modelClient?.listeners() ?? 0,
    };
    let index = 0;
    const step = (): void => {
      timer = null;
      // a corpus frame nobody reads costs nothing, not even a task
      for (
        let entry = timeline[index];
        entry !== undefined && "corpus" in entry && !heard(frames[entry.corpus] as RecordedFrame);
        entry = timeline[index]
      ) {
        index += 1;
        skipped += 1;
        delivered = index;
      }
      const entry = timeline[index];
      if (entry === undefined) {
        endedAt = now();
        phase = "ended";
        return;
      }
      const dueAt = origin + (entry.t - first) / speed;
      if (dueAt > now()) {
        timer = setTimeout(step, Math.max(0, dueAt - now()));
        return;
      }
      // ONE frame per task, as the fold source delivers them (see `start`)
      if ("corpus" in entry) deliver(entry.corpus);
      else deliverModel(entry.model);
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
      dropModel();
      const recipe = parseRecipe(recipeText);
      const corpus = generateCorpus(recipe);
      frames = corpus.frames;
      // the wire's text for every fold frame, once, so the player never
      // serializes on the timeline it measures
      lines = frames.map((frame) => (frame.kind === "fold" ? JSON.stringify(frame) : null));
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
      lines = [
        ...lines,
        ...decoded.frames.map((frame) => (frame.kind === "fold" ? JSON.stringify(frame) : null)),
      ];
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
      dropModel();
      frames = [];
      lines = [];
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
      source = modelLines.length > 0 ? "model" : "fold";
      if (source === "model") return startModel(speed);
      skipped = 0;
      modelAtStart = null;
      const first = frames[0] as RecordedFrame;
      const origin = now();
      startedAt = origin;
      endedAt = null;
      delivered = 0;
      marks.length = 0;
      phase = "playing";
      listenersAtStart = door?.listeners() ?? null;
      let index = 0;
      const step = (): void => {
        timer = null;
        if (index >= frames.length) {
          endedAt = now();
          phase = "ended";
          return;
        }
        const frame = frames[index] as RecordedFrame;
        const dueAt = origin + (frame.t - first.t) / speed;
        if (dueAt > now()) {
          timer = setTimeout(step, Math.max(0, dueAt - now()));
          return;
        }
        // ONE frame per task, never a catch-up loop: the daemon's socket hands
        // the client one message per task too, so after a stall each late frame
        // is its own render rather than a batch React folds into one — the first
        // trial's list cell rendered 102 times for ~150 fold frames that way.
        deliver(index);
        index += 1;
        timer = setTimeout(step, 0);
      };
      step();
      return state();
    },
    stop() {
      halt();
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
    attach(next) {
      door = next;
    },
    onMark(listener) {
      markListener = listener;
    },
    pushModel(text) {
      halt();
      if (corpusName === null) throw new Error("load the corpus before its model stream");
      const fresh = modelLines.length === 0;
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
      // the fold's text is held only for a window that still reads the fold;
      // dropped here, before any measurement, so its collection is no cell's
      if (fresh && (door?.listeners().fold ?? 0) === 0) lines = lines.map(() => null);
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
    source: () => (modelLines.length > 0 ? "model" : "fold"),
  };
}
