import type { DeviceInfo } from "@vibefield/contracts";
import { type Corpus, generateCorpus, parseRecipe, recipeName } from "./corpus";
import { decodeCorpusJsonl } from "./corpus-codec";
import type { RecordedFrame } from "./frame-recorder";
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

export type ReplayPhase = "empty" | "loaded" | "playing" | "ended" | "stopped";

export interface ReplayState {
  phase: ReplayPhase;
  corpus: string | null;
  total: number;
  delivered: number;
  startedAt: number | null;
  endedAt: number | null;
  marks: { name: string; at: number; seq: number }[];
  /** the fold listeners standing on the door when `start()` was called */
  listeners: { fold: number; mesh: number; devices: number } | null;
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
}

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

  const state = (): ReplayState => ({
    phase,
    corpus: corpusName,
    total: frames.length,
    delivered,
    startedAt,
    endedAt,
    marks: [...marks],
    listeners: listenersAtStart,
  });

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

  return {
    load(recipeText) {
      halt();
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
  };
}
