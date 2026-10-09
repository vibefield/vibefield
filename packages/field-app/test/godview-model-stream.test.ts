/**
 * THE MODEL STREAM (MV-3c): what the window's one door answers for a corpus,
 * computed by fieldd's own code on a virtual clock — deterministic, pinned, and
 * read by the window adapter without a gap.
 *
 * The committed fixtures ARE what the computation writes today: a change to
 * fieldd's backend, its model board, the relay or the corpus moves them, and
 * moving them is a deliberate regeneration (`perf:godview:model`), never a
 * quiet drift under the B arm of a paired run.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { AGENT_FIELD, AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { computeModelStream } from "../perf/lib/model-stream";
import { withVirtualTime } from "../perf/lib/virtual-time";
import { ModelBoardFold } from "../src/godview/monitor/model-board";
import {
  type CorpusTick,
  generateCorpus,
  recipeName,
  resolveRecipe,
} from "../src/godview/monitor/perf/corpus";
import { encodeCorpusJsonl } from "../src/godview/monitor/perf/corpus-codec";
import {
  decodeModelStreamJsonl,
  encodeModelStreamJsonl,
  MODEL_STREAM_GENERATOR,
  type ModelStream,
  type ModelStreamFrame,
  modelStreamFileName,
} from "../src/godview/monitor/perf/model-stream";

const FIXTURES = join(import.meta.dirname, "fixtures", "godview-model-streams");
const RECIPE = { n: 10, durationMs: 2_000, seed: 1 };

async function streamOf(recipe: typeof RECIPE) {
  return withVirtualTime(resolveRecipe(recipe).baseWall, (time) =>
    computeModelStream(recipe, time),
  );
}

type ModelFrame = Extract<ModelStreamFrame, { kind: "model-frame" }>;
const modelFrames = (stream: ModelStream): ModelFrame[] =>
  stream.frames.filter((frame): frame is ModelFrame => frame.kind === "model-frame");

describe("the corpus observer", () => {
  it("changes nothing the corpus writes, and hands out the fold frames' own rows", () => {
    const ticks: CorpusTick[] = [];
    const observed = generateCorpus(RECIPE, (tick) => ticks.push(tick));
    expect(encodeCorpusJsonl(observed)).toBe(encodeCorpusJsonl(generateCorpus(RECIPE)));
    const folds = observed.frames.filter((frame) => frame.kind === "fold");
    const withRows = ticks.filter((tick) => tick.here !== undefined);
    expect(withRows).toHaveLength(folds.length);
    for (const [index, tick] of withRows.entries()) {
      const fold = folds[index] as Extract<(typeof folds)[number], { kind: "fold" }>;
      expect(tick.tMs).toBe(fold.t);
      expect(tick.here).toBe(fold.rows);
    }
    // the peer advances on every tick but the marker's and the quiet window's
    expect(ticks.filter((tick) => tick.peer !== undefined)).toHaveLength(withRows.length - 1);
    expect(ticks.filter((tick) => tick.mark !== undefined)).toHaveLength(1);
  });
});

// Each case computes a corpus through fieldd's own code on a virtual clock: ~3 s alone, past
// vitest's 5 s default under a loaded gate — and a timed-out case keeps running with its clock
// installed, so the cases after it read the wrong time (2026-10-08: red in 4 of 7 loaded gates).
describe("the model stream", { timeout: 30_000 }, () => {
  it("is a pure function of its recipe: the same bytes twice, other bytes for another seed", async () => {
    const one = encodeModelStreamJsonl((await streamOf(RECIPE)).stream);
    const two = encodeModelStreamJsonl((await streamOf(RECIPE)).stream);
    expect(two).toBe(one);
    const other = encodeModelStreamJsonl((await streamOf({ ...RECIPE, seed: 2 })).stream);
    expect(other).not.toBe(one);
  });

  it("every frame reads with the contract the window adapter reads with", async () => {
    const { stream } = await streamOf(RECIPE);
    expect(stream.meta.generator).toBe(MODEL_STREAM_GENERATOR);
    for (const frame of stream.frames) {
      if (frame.kind === "model-open")
        expect(AgentModelMeshOpen.safeParse(frame.open).success).toBe(true);
      if (frame.kind === "model-frame")
        expect(AgentModelMeshFrame.safeParse(frame.frame).success, `frame ${frame.seq}`).toBe(true);
    }
  });

  it("opens with this desktop's model board first, the peer's desk cut beside it", async () => {
    const { corpus, stream } = await streamOf(RECIPE);
    const recipe = corpus.meta.recipe;
    const first = stream.frames[0];
    expect(first?.kind).toBe("model-open");
    if (first?.kind !== "model-open") return;
    const [self, peer] = first.open.devices;
    expect(self?.device).toBe(corpus.meta.here);
    expect(self?.state).toBe("live");
    expect(peer?.device).toBe(corpus.meta.peer);
    expect(peer?.state).toBe("live");
    const selfRows = self?.snapshot?.rows ?? [];
    const terminals = selfRows.filter((row) => row.kind === "terminal");
    // every agent, and the bare shells as rows of their own kind (L8); the
    // agents' PTYs are claimed by their runs, never drawn twice
    expect(selfRows).toHaveLength(recipe.n + recipe.bareTerminals);
    expect(terminals.map((row) => row.runtimeRunId).sort()).toEqual(["shell-1", "shell-2"]);
    for (const row of selfRows) expect(row.monitorRow?.device.id).toBe(corpus.meta.here);
    const agents = selfRows.filter((row) => row.kind !== "terminal");
    // this desktop's window gets the colour sequence; a peer's cut never does (M16)
    for (const row of agents) expect(row.monitorRow?.project.seq).toBeTypeOf("number");
    const peerRows = peer?.snapshot?.rows ?? [];
    expect(peerRows).toHaveLength(recipe.peerAgents);
    for (const row of peerRows) {
      expect(row.kind).not.toBe("terminal");
      expect(row.monitorRow).toBeDefined();
      expect(row.monitorRow?.project.seq).toBeUndefined();
    }
  });

  it("keeps the corpus's timeline: ordered, each frame placed after a corpus frame, at the floors", async () => {
    const { corpus, stream } = await streamOf(RECIPE);
    const lastCorpusSeq = corpus.frames.at(-1)?.seq ?? 0;
    let previous: ModelStreamFrame | undefined;
    for (const [index, frame] of stream.frames.entries()) {
      expect(frame.seq).toBe(index + 1);
      expect(frame.wall).toBe(corpus.meta.recipe.baseWall + frame.t);
      if (previous !== undefined) {
        expect(frame.t).toBeGreaterThanOrEqual(previous.t);
        expect(frame.after).toBeGreaterThanOrEqual(previous.after);
      }
      expect(frame.after).toBeLessThanOrEqual(lastCorpusSeq);
      previous = frame;
    }
    // this desktop's model board: one frame per floor at most, but for the
    // urgent leading edge after a quiet spell
    const selfTimes = modelFrames(stream)
      .filter((frame) => frame.frame.device === corpus.meta.here)
      .map((frame) => frame.t);
    const gaps = selfTimes.slice(1).map((t, index) => t - (selfTimes[index] as number));
    expect(gaps.filter((gap) => gap < AGENT_FIELD.FULL_TICK_MS)).toEqual([]);
    // the peer's desk cut at its own floor (L12: peers keep the desk's 100 ms)
    const peerTimes = modelFrames(stream)
      .filter((frame) => frame.frame.device === corpus.meta.peer)
      .map((frame) => frame.t);
    expect(peerTimes.length).toBeGreaterThan(5);
    const peerGaps = peerTimes.slice(1).map((t, index) => t - (peerTimes[index] as number));
    expect(peerGaps.filter((gap) => gap < AGENT_FIELD.DESK_MIN_INTERVAL_MS)).toEqual([]);
  });

  it("moves the mark to the first frame whose model row carries the marker's change, on the leading edge", async () => {
    const { corpus, stream } = await streamOf(RECIPE);
    const marker = corpus.meta.marker;
    const marks = stream.frames.filter((frame) => frame.kind === "mark");
    expect(marks).toHaveLength(1);
    const at = stream.frames.findIndex((frame) => frame.kind === "mark");
    const mark = stream.frames[at] as ModelStreamFrame;
    const next = stream.frames[at + 1] as ModelFrame;
    // the urgent change leaves at the marker's own tick: the floor had long
    // elapsed in the quiet window (L12's leading edge)
    expect(mark.t).toBe(marker.atMs);
    expect(next.kind).toBe("model-frame");
    expect(next.t).toBe(mark.t);
    expect(next.after).toBe(mark.after);
    const carries = (frame: ModelFrame): boolean =>
      "delta" in frame.frame &&
      frame.frame.delta.upserts.some(
        (row) => row.runtimeRunId === marker.runtimeRunId && row.monitorRow?.status === marker.to,
      );
    expect(carries(next)).toBe(true);
    for (const frame of stream.frames.slice(0, at)) {
      if (frame.kind === "model-frame") expect(carries(frame), `frame ${frame.seq}`).toBe(false);
    }
    // and it is placed BEFORE the corpus's own fold frame of that tick: the
    // backend hears the runtime's state before the fold publishes
    const fold = corpus.frames.find((frame) => frame.kind === "fold" && frame.t === marker.atMs);
    expect(fold).toBeDefined();
    expect(mark.after).toBeLessThan(fold?.seq ?? 0);
  });

  it("opens the window's screen with its board, so a turn that ends unseen marks its row unread (M51)", async () => {
    // A real window's model board IS its screen: fieldd opens it with the
    // subscription and an empty report (M20), and marks accrue from there. A
    // stream computed with no screen never marks a row, and the lab's B arm
    // drew "idle" where A drew "reply unseen" (build-mv M51).
    // eight seconds: the two-second recipe's only flip falls in the marker's
    // quiet window, on the marker agent, so no turn ends after the screen opens
    const { stream } = await streamOf({ n: 10, durationMs: 8_000, seed: 1 });
    const unread = modelFrames(stream).some(
      (frame) =>
        "delta" in frame.frame &&
        frame.frame.device === stream.meta.here &&
        frame.frame.delta.upserts.some((row) => row.monitorRow?.unread === true),
    );
    expect(unread).toBe(true);
  });

  it("the window adapter folds it whole: no gap, every desktop's rows held at the end", async () => {
    const { corpus, stream } = await streamOf(RECIPE);
    const recipe = corpus.meta.recipe;
    const fold = new ModelBoardFold();
    let rows = 0;
    for (const frame of stream.frames) {
      if (frame.kind === "model-open") rows = fold.open(frame.open).rows.length;
      if (frame.kind === "model-frame")
        expect(fold.frame(frame.frame), `frame ${frame.seq}`).not.toBe("gap");
    }
    expect(rows).toBe(recipe.n + recipe.bareTerminals + recipe.peerAgents);
    expect(fold.here).toBe(corpus.meta.here);
  });

  it("the committed fixtures are byte-for-byte what the computation writes", async () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".model.jsonl.gz"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) {
      const text = gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8");
      const stored = decodeModelStreamJsonl(text);
      const recipe = stored.meta.recipe;
      expect(recipe, name).toBeDefined();
      if (recipe === undefined) continue;
      expect(modelStreamFileName(recipeName(recipe)), name).toBe(name);
      const { corpus, stream } = await streamOf(recipe);
      expect(stored.meta.corpusFrames, name).toBe(corpus.frames.length);
      expect(encodeModelStreamJsonl(stream), name).toBe(text);
    }
  }, 60_000);
});
