/**
 * SYNTHETIC CORPORA (MV-0): deterministic, on the wire's own shapes, and pinned.
 *
 * Four properties hold here. The generator is a pure function of its recipe
 * (the same bytes in Node and in a renderer, which is what lets the Electron
 * lab generate in the page and the oracle generate in Node and trust they saw
 * one corpus). Every frame parses with the contract the real door parses with.
 * The peer's desk rows are fieldd's own projection, field by field. And the
 * committed fixtures ARE what the generator writes today — a change to the
 * generator is a deliberate regeneration, never a quiet drift.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { AgentListResult, AgentMeshFrame, AgentMeshOpen, DeviceInfo } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { projectDeskRow } from "../../fieldd/src/agent-field";
import {
  CORPUS_HERE,
  CORPUS_MARK,
  CORPUS_PEER,
  deskRowOf,
  foldRowOf,
  generateCorpus,
  parseRecipe,
  recipeName,
  resolveRecipe,
} from "../src/godview/monitor/perf/corpus";
import {
  asGeneratedCorpus,
  decodeCorpusJsonl,
  encodeCorpusJsonl,
} from "../src/godview/monitor/perf/corpus-codec";
import {
  decodeFramesJsonl,
  encodeFramesJsonl,
  type RecordedFrame,
} from "../src/godview/monitor/perf/corpus-frames";

const FIXTURES = join(import.meta.dirname, "fixtures", "godview-corpora");

const fold = (frames: readonly RecordedFrame[]) =>
  frames.filter((frame) => frame.kind === "fold") as Extract<RecordedFrame, { kind: "fold" }>[];

describe("the recipe", () => {
  it("resolves defaults on the fold's and the desk's own ticks and names itself", () => {
    const resolved = resolveRecipe({ n: 10, durationMs: 2_000 });
    expect(resolved).toMatchObject({
      n: 10,
      durationMs: 2_000,
      seed: 1,
      peerAgents: 3,
      bareTerminals: 2,
      foldTickMs: 16,
      deskTickMs: 100,
      markerAtMs: 992, // halfway, on a fold tick
      markerTo: "blocked",
    });
    expect(recipeName({ n: 10, durationMs: 2_000 })).toBe("n10-2s-s1");
    expect(recipeName({ n: 60, durationMs: 1_000, seed: 3 })).toBe("n60-1s-s3");
  });

  it("parses the lab's spelling", () => {
    expect(parseRecipe("n=20, duration=8000, seed=4, peers=6")).toEqual({
      n: 20,
      durationMs: 8_000,
      seed: 4,
      peerAgents: 6,
    });
    expect(() => parseRecipe("seed=1")).toThrow(/names n and duration/);
  });

  it("is the membership the proof audit expects (scripts/perf-godview-proof.mjs keeps a copy)", async () => {
    const url = pathToFileURL(
      join(import.meta.dirname, "..", "..", "..", "scripts", "perf-godview-proof.mjs"),
    ).href;
    const { declaredMembership } = (await import(/* @vite-ignore */ url)) as {
      declaredMembership(recipe: string, viewId: string): Record<string, number | string>;
    };
    for (const text of [
      "n=10,duration=8000,seed=1,markerAgent=3,bareTerminals=0",
      "n=20,duration=8000,seed=1",
      "n=60,duration=8000,seed=1,peers=4,bareTerminals=5",
      "n=2,duration=8000,peerAgents=0",
      "n=3.7,duration=2000",
    ]) {
      const { n, bareTerminals, peerAgents } = resolveRecipe(parseRecipe(text));
      expect(declaredMembership(text, "list"), text).toEqual({
        viewId: "list",
        agents: n + bareTerminals + peerAgents,
        localAgents: n,
        terminals: bareTerminals,
        remoteSessions: peerAgents,
        remoteHosts: peerAgents > 0 ? 1 : 0,
        shownAgents: n + bareTerminals + peerAgents,
      });
    }
  });
});

describe("the generator", () => {
  const corpus = generateCorpus({ n: 10, durationMs: 2_000, seed: 1 });

  it("is deterministic: the same recipe is the same bytes", () => {
    const again = generateCorpus({ n: 10, durationMs: 2_000, seed: 1 });
    expect(encodeCorpusJsonl(again)).toBe(encodeCorpusJsonl(corpus));
    const other = generateCorpus({ n: 10, durationMs: 2_000, seed: 2 });
    expect(encodeCorpusJsonl(other)).not.toBe(encodeCorpusJsonl(corpus));
  });

  it("emits a fold frame on every tick but the quiet window, and the mesh at the desk's floor", () => {
    const { recipe, counts } = corpus.meta;
    const ticks = recipe.durationMs / recipe.foldTickMs; // 125
    const quietTicks = Math.floor((2 * recipe.markerQuietMs) / recipe.foldTickMs); // 37
    // t = 0 plus every tick outside the window, plus the marker's own frame
    expect(counts.fold).toBeGreaterThanOrEqual(ticks - quietTicks);
    expect(counts.fold).toBeLessThanOrEqual(ticks + 1 - quietTicks + 2);
    expect(counts.meshOpen).toBe(1);
    expect(counts.meshFrames).toBeGreaterThan(0);
    expect(counts.marks).toBe(1);
    const frames = corpus.frames;
    expect(frames[0]).toMatchObject({ kind: "fold", seq: 1, t: 0 });
    expect(frames[1]).toMatchObject({ kind: "mesh-open", seq: 2, t: 0 });
    // stamps are monotonic and the wall clock rides the recipe's base
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1] as RecordedFrame;
      const frame = frames[index] as RecordedFrame;
      expect(frame.seq).toBe(previous.seq + 1);
      expect(frame.t).toBeGreaterThanOrEqual(previous.t);
      expect(frame.wall).toBe(recipe.baseWall + frame.t);
    }
    // the desk's floor: a device's frames are never closer than `deskTickMs`,
    // and land on fold ticks (the first at or after each due time)
    const lastDeskAt = new Map<string, number>();
    for (const frame of frames) {
      if (frame.kind !== "mesh-frame") continue;
      const held = lastDeskAt.get(frame.frame.device);
      if (held !== undefined) expect(frame.t - held).toBeGreaterThanOrEqual(recipe.deskTickMs);
      lastDeskAt.set(frame.frame.device, frame.t);
      expect(frame.t % recipe.foldTickMs).toBe(0);
    }
    expect(lastDeskAt.size).toBe(2); // both desktops sent frames
  });

  it("moves what the recipe says moves: usage every tick, flips, replies, waits", () => {
    const boards = fold(corpus.frames);
    const first = boards[0] as (typeof boards)[number];
    const working = first.rows.filter((row) => row.status === "working");
    expect(working.length).toBeGreaterThan(0);
    // a working agent's tokens and revision tick on the very next frame
    const second = boards[1] as (typeof boards)[number];
    for (const row of working) {
      const next = second.rows.find((candidate) => candidate.runtimeRunId === row.runtimeRunId);
      expect(next?.monitor?.usage?.cumulativeTokens).toBeGreaterThan(
        row.monitor?.usage?.cumulativeTokens ?? Number.POSITIVE_INFINITY,
      );
      expect(next?.monitor?.revision).toBeGreaterThan(row.monitor?.revision ?? Number.NaN);
    }
    // an idle agent does not
    const idle = first.rows.find((row) => row.status === "idle");
    if (idle !== undefined) {
      const next = second.rows.find((candidate) => candidate.runtimeRunId === idle.runtimeRunId);
      expect(next?.monitor?.revision).toBe(idle.monitor?.revision);
    }
    const statuses = new Set<string>();
    const replies = new Set<string>();
    const replyText = (row: (typeof first.rows)[number]): string | undefined =>
      (row.monitor?.lastAssistantMessage as { text?: string } | undefined)?.text;
    const openingReplies = new Set(first.rows.map(replyText));
    let blockedSeen = 0;
    for (const board of boards) {
      for (const row of board.rows) {
        statuses.add(`${row.runtimeRunId}:${row.status}`);
        const text = replyText(row);
        if (text !== undefined) replies.add(text);
        if (row.status === "blocked") blockedSeen += 1;
      }
    }
    expect(statuses.size).toBeGreaterThan(first.rows.length); // somebody flipped
    expect(replies.size).toBeGreaterThan(openingReplies.size); // somebody replied anew
    expect(blockedSeen).toBeGreaterThan(0); // somebody waited
  });

  it("marks one status flip inside a quiet window where nothing else moves", () => {
    const frames = corpus.frames;
    const markIndex = frames.findIndex((frame) => frame.kind === "mark");
    const mark = frames[markIndex] as Extract<RecordedFrame, { kind: "mark" }>;
    expect(mark.name).toBe(CORPUS_MARK);
    expect(mark.detail).toMatchObject({
      runtimeRunId: corpus.meta.marker.runtimeRunId,
      device: CORPUS_HERE,
      to: "blocked",
    });
    expect(mark.t).toBe(corpus.meta.recipe.markerAtMs);
    // the frame right after the mark carries the flip, and the frame before the
    // quiet window is at least `markerQuietMs` earlier
    const after = frames[markIndex + 1] as Extract<RecordedFrame, { kind: "fold" }>;
    expect(after.kind).toBe("fold");
    expect(after.t).toBe(mark.t);
    const flipped = after.rows.find((row) => row.runtimeRunId === corpus.meta.marker.runtimeRunId);
    expect(flipped?.status).toBe("blocked");
    expect(flipped?.monitor?.blockers).toHaveLength(1);
    const before = frames[markIndex - 1] as RecordedFrame;
    expect(mark.t - before.t).toBeGreaterThanOrEqual(corpus.meta.recipe.markerQuietMs);
    const next = frames[markIndex + 2] as RecordedFrame;
    expect(next.t - mark.t).toBeGreaterThan(corpus.meta.recipe.markerQuietMs);
  });

  it("parses with the contracts the real door parses with", () => {
    let folds = 0;
    let meshFrames = 0;
    for (const frame of corpus.frames) {
      switch (frame.kind) {
        case "fold": {
          const parsed = AgentListResult.safeParse(
            JSON.parse(JSON.stringify({ sessions: frame.rows })),
          );
          expect(
            parsed.success,
            JSON.stringify(parsed.success ? null : parsed.error.issues[0]),
          ).toBe(true);
          folds += 1;
          break;
        }
        case "mesh-open": {
          const parsed = AgentMeshOpen.safeParse(JSON.parse(JSON.stringify(frame.open)));
          expect(
            parsed.success,
            JSON.stringify(parsed.success ? null : parsed.error.issues[0]),
          ).toBe(true);
          expect(frame.open.devices.map((device) => device.device)).toEqual([
            CORPUS_HERE,
            CORPUS_PEER,
          ]);
          break;
        }
        case "mesh-frame": {
          const parsed = AgentMeshFrame.safeParse(JSON.parse(JSON.stringify(frame.frame)));
          expect(
            parsed.success,
            JSON.stringify(parsed.success ? null : parsed.error.issues[0]),
          ).toBe(true);
          meshFrames += 1;
          break;
        }
        default:
          break;
      }
    }
    expect(folds).toBe(corpus.meta.counts.fold);
    expect(meshFrames).toBe(corpus.meta.counts.meshFrames);
    for (const device of corpus.roster) {
      expect(DeviceInfo.safeParse(JSON.parse(JSON.stringify(device))).success).toBe(true);
    }
    expect(corpus.panes.sessionIds).toHaveLength(10 + 2);
  });

  it("projects desk rows exactly as fieldd does", () => {
    const boards = fold(corpus.frames);
    for (const board of [boards[0], boards[Math.floor(boards.length / 2)], boards.at(-1)]) {
      for (const row of board?.rows ?? []) {
        const { revision: _ours, ...ours } = deskRowOf(row, 1);
        const { revision: _theirs, ...theirs } = projectDeskRow(row);
        expect(ours).toEqual(theirs);
      }
    }
  });

  it("bumps a desk row's revision only when its projection changed", () => {
    const deltas = corpus.frames.filter(
      (frame): frame is Extract<RecordedFrame, { kind: "mesh-frame" }> =>
        frame.kind === "mesh-frame",
    );
    const seen = new Map<string, { revision: number; body: string }>();
    for (const open of corpus.frames.filter(
      (frame): frame is Extract<RecordedFrame, { kind: "mesh-open" }> => frame.kind === "mesh-open",
    )) {
      for (const device of open.open.devices) {
        for (const row of device.snapshot?.rows ?? []) {
          const { revision, ...body } = row;
          seen.set(`${device.device}/${row.runtimeRunId}`, {
            revision,
            body: JSON.stringify(body),
          });
        }
      }
    }
    let upserts = 0;
    for (const frame of deltas) {
      if (!("delta" in frame.frame)) continue;
      for (const row of frame.frame.delta.upserts) {
        upserts += 1;
        const { revision, ...body } = row;
        const key = `${frame.frame.device}/${row.runtimeRunId}`;
        const held = seen.get(key);
        expect(held).toBeDefined();
        expect(revision).toBe((held?.revision ?? 0) + 1);
        expect(JSON.stringify(body)).not.toBe(held?.body);
        seen.set(key, { revision, body: JSON.stringify(body) });
      }
    }
    expect(upserts).toBeGreaterThan(0);
  });
});

describe("the codec", () => {
  it("round-trips a corpus through JSONL and reads a recorded file without our headers", () => {
    const corpus = generateCorpus({ n: 3, durationMs: 500, seed: 7 });
    const text = encodeCorpusJsonl(corpus);
    const decoded = asGeneratedCorpus(decodeCorpusJsonl(text));
    expect(decoded.meta).toEqual(JSON.parse(JSON.stringify(corpus.meta)));
    expect(decoded.roster).toEqual(JSON.parse(JSON.stringify(corpus.roster)));
    expect(decoded.panes).toEqual(JSON.parse(JSON.stringify(corpus.panes)));
    expect(decoded.frames).toEqual(JSON.parse(JSON.stringify(corpus.frames)));
    const recorded = `${JSON.stringify({ kind: "meta", recorder: "x", version: 1 })}\n${text
      .split("\n")
      .filter((line) => line.includes('"kind":"fold"'))
      .join("\n")}\n`;
    const partial = decodeCorpusJsonl(recorded);
    expect(partial.meta).toEqual({ recorder: "x", version: 1 });
    expect(partial.roster).toEqual([]);
    expect(partial.frames).toHaveLength(corpus.meta.counts.fold);
    expect(() => asGeneratedCorpus(partial)).toThrow(/not a generated corpus/);
  });
});

describe("the corpus frame codec", () => {
  it("round-trips stamps and payloads while skipping headers and unreadable lines", () => {
    const { frames } = generateCorpus({ n: 3, durationMs: 500, seed: 7 });
    const text = `${JSON.stringify({ kind: "meta", version: 1 })}\nnot json\n${encodeFramesJsonl(frames)}\n{"kind":"fold"}\n`;
    expect(decodeFramesJsonl(text)).toEqual(JSON.parse(JSON.stringify(frames)));
    expect(encodeFramesJsonl([])).toBe("");
  });
});

describe("the committed fixtures", () => {
  it("are exactly what the generator writes for their recipes", () => {
    const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".jsonl.gz"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) {
      const text = gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8");
      const stored = asGeneratedCorpus(decodeCorpusJsonl(text));
      expect(`${recipeName(stored.meta.recipe)}.jsonl.gz`).toBe(name);
      const regenerated = generateCorpus(stored.meta.recipe);
      expect(encodeCorpusJsonl(regenerated)).toBe(text);
    }
  });
});

describe("foldRowOf", () => {
  it("is exported for the oracle's and the bench's own use and reads as a managed row", () => {
    const corpus = generateCorpus({ n: 2, durationMs: 100 });
    const row = (corpus.frames[0] as Extract<RecordedFrame, { kind: "fold" }>).rows[0];
    expect(row?.tier).toBe("managed");
    expect(row?.terminal).toMatchObject({ hosted: "local" });
    expect(typeof foldRowOf).toBe("function");
  });
});
